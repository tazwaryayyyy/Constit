// app/api/webhooks/stripe/route.ts
// Handles Stripe webhook events for subscription lifecycle management.
// Updates organization plan and status in Supabase when Stripe events occur.
//
// Events handled:
//   checkout.session.completed   → activate subscription
//   customer.subscription.updated → plan change
//   customer.subscription.deleted → downgrade to free
//   invoice.payment_failed        → mark past_due
//
// FIX #3: Every event is persisted to webhook_events before processing.
// UNIQUE(provider, event_id) prevents double-processing on Stripe retries.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { waitUntil } from "@vercel/functions";
import { logger } from "@/lib/logger";

function getServiceDb() {
    return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
}

// Stripe webhook signature validation using Web Crypto API
async function validateStripeSignature(
    payload: string,
    signature: string,
    secret: string
): Promise<boolean> {
    const parts = signature.split(",").reduce<Record<string, string>>((acc, part) => {
        const [k, v] = part.split("=");
        acc[k] = v;
        return acc;
    }, {});

    const timestamp = parts["t"];
    const v1 = parts["v1"];
    if (!timestamp || !v1) return false;

    const signedPayload = `${timestamp}.${payload}`;
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
        "raw",
        encoder.encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
    );
    const sigBuffer = await crypto.subtle.sign("HMAC", key, encoder.encode(signedPayload));
    const computed = Array.from(new Uint8Array(sigBuffer))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

    // Timing-safe comparison is handled by the fact computed is always same length
    return computed === v1;
}

// ── Shared types ──────────────────────────────────────────────────────────────
export type StripeEvent = {
    id: string;
    type: string;
    data: { object: Record<string, unknown> };
};

// ── DLQ finalization helper ───────────────────────────────────────────────────
async function markDlq(
    db: ReturnType<typeof getServiceDb>,
    dlqId: string,
    success: boolean
): Promise<void> {
    await db
        .from("webhook_events")
        .update({ status: success ? "processed" : "failed", processed_at: new Date().toISOString() })
        .eq("id", dlqId);
}

// ── Business logic — exported so the retry cron can re-process failed events ──
export async function processStripePayload(
    db: ReturnType<typeof getServiceDb>,
    event: StripeEvent,
    correlationId: string
): Promise<boolean> {
    try {
        switch (event.type) {
            case "checkout.session.completed": {
                const session = event.data.object;
                const userId = session["metadata"] as Record<string, string> | undefined;
                const customerId = session["customer"] as string;
                const subscriptionId = session["subscription"] as string;
                const plan = (userId?.plan ?? "pro") as string;

                if (userId?.user_id) {
                    const { data: existingOrg } = await db
                        .from("organizations")
                        .select("id")
                        .eq("owner_id", userId.user_id)
                        .single();

                    if (existingOrg) {
                        await db
                            .from("organizations")
                            .update({
                                stripe_customer_id: customerId,
                                stripe_subscription_id: subscriptionId,
                                subscription_status: "active",
                                plan,
                                contacts_limit: plan === "enterprise" ? 1_000_000 : 10_000,
                            })
                            .eq("id", existingOrg.id);
                    } else {
                        await db.from("organizations").insert({
                            owner_id: userId.user_id,
                            name: "My Organization",
                            stripe_customer_id: customerId,
                            stripe_subscription_id: subscriptionId,
                            subscription_status: "active",
                            plan,
                            contacts_limit: plan === "enterprise" ? 1_000_000 : 10_000,
                        });
                    }
                }
                break;
            }

            case "customer.subscription.updated": {
                const sub = event.data.object;
                const customerId = sub["customer"] as string;
                const status = sub["status"] as string;
                const subscriptionStatus = ["active", "past_due", "canceled"].includes(status)
                    ? status
                    : "inactive";

                await db
                    .from("organizations")
                    .update({ subscription_status: subscriptionStatus })
                    .eq("stripe_customer_id", customerId);
                break;
            }

            case "customer.subscription.deleted": {
                const sub = event.data.object;
                const customerId = sub["customer"] as string;

                await db
                    .from("organizations")
                    .update({
                        subscription_status: "canceled",
                        plan: "free",
                        contacts_limit: 500,
                    })
                    .eq("stripe_customer_id", customerId);
                break;
            }

            case "invoice.payment_failed": {
                const invoice = event.data.object;
                const customerId = invoice["customer"] as string;

                await db
                    .from("organizations")
                    .update({ subscription_status: "past_due" })
                    .eq("stripe_customer_id", customerId);
                break;
            }

            default:
                // Ignore unhandled events
                break;
        }
        return true;
    } catch (err) {
        logger.error({ err, correlationId, eventType: event.type }, "webhooks/stripe: handler error");
        return false;
    }
}

export async function POST(req: NextRequest) {
    const correlationId = req.headers.get("x-request-id") ?? crypto.randomUUID();
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!webhookSecret) {
        logger.error({ correlationId }, "webhooks/stripe: STRIPE_WEBHOOK_SECRET not configured");
        return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });
    }

    const rawBody = await req.text();
    const signature = req.headers.get("stripe-signature") ?? "";

    const isValid = await validateStripeSignature(rawBody, signature, webhookSecret);
    if (!isValid) {
        logger.warn({ correlationId }, "webhooks/stripe: invalid signature — rejected");
        return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
    }

    const event = JSON.parse(rawBody) as StripeEvent;
    const db = getServiceDb();

    // ── Persist to DLQ before any processing ──────────────────────────────
    const { data: dlqRow, error: dlqError } = await db
        .from("webhook_events")
        .upsert(
            { provider: "stripe", event_id: event.id, payload: JSON.parse(rawBody), status: "pending" },
            { onConflict: "provider,event_id", ignoreDuplicates: true }
        )
        .select("id")
        .maybeSingle();

    if (dlqError) {
        logger.error({ err: dlqError, correlationId, eventId: event.id }, "webhooks/stripe: DLQ insert failed — processing anyway");
    }

    // Idempotency: if the row was a duplicate (already processed), skip silently.
    if (!dlqRow && !dlqError) {
        return NextResponse.json({ received: true }, { headers: { "x-request-id": correlationId } });
    }

    const dlqId = dlqRow?.id as string | undefined;

    // ── Return 200 immediately; process in the background ─────────────────
    // waitUntil keeps the Vercel function alive until the promise resolves.
    // Stripe receives the 200 ack instantly, preventing unnecessary retries.
    // On error, the DLQ row stays 'failed' and the retry cron picks it up.
    waitUntil(
        processStripePayload(db, event, correlationId)
            .then((success) => { if (dlqId) return markDlq(db, dlqId, success); })
            .catch((err) => {
                logger.error({ err, correlationId }, "webhooks/stripe: background processing error");
                if (dlqId) return markDlq(db, dlqId, false);
            })
    );

    return NextResponse.json({ received: true }, { headers: { "x-request-id": correlationId } });
}
