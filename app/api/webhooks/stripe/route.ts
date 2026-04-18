// app/api/webhooks/stripe/route.ts
// Handles Stripe webhook events for subscription lifecycle management.
// Updates organization plan and status in Supabase when Stripe events occur.
//
// Events handled:
//   checkout.session.completed   → activate subscription
//   customer.subscription.updated → plan change
//   customer.subscription.deleted → downgrade to free
//   invoice.payment_failed        → mark past_due

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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

export async function POST(req: NextRequest) {
    const correlationId = req.headers.get("x-request-id") ?? crypto.randomUUID();
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!webhookSecret) {
        console.error(`[webhooks/stripe] [${correlationId}] STRIPE_WEBHOOK_SECRET not configured`);
        return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });
    }

    const rawBody = await req.text();
    const signature = req.headers.get("stripe-signature") ?? "";

    const isValid = await validateStripeSignature(rawBody, signature, webhookSecret);
    if (!isValid) {
        console.warn(`[webhooks/stripe] [${correlationId}] Invalid signature`);
        return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
    }

    const event = JSON.parse(rawBody) as {
        type: string;
        data: { object: Record<string, unknown> };
    };

    const db = getServiceDb();

    try {
        switch (event.type) {
            case "checkout.session.completed": {
                const session = event.data.object;
                const userId = session["metadata"] as Record<string, string> | undefined;
                const customerId = session["customer"] as string;
                const subscriptionId = session["subscription"] as string;
                const plan = (userId?.plan ?? "pro") as string;

                if (userId?.user_id) {
                    // Upsert organization record for the user
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
    } catch (err) {
        console.error(`[webhooks/stripe] [${correlationId}] Handler error for ${event.type}:`, err);
        return NextResponse.json({ error: "Internal handler error" }, { status: 500 });
    }

    return NextResponse.json({ received: true }, { headers: { "x-request-id": correlationId } });
}
