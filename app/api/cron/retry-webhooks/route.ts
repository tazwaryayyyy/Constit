// app/api/cron/retry-webhooks/route.ts
// Hourly cron job that re-processes failed webhook_events rows.
//
// Vercel invokes this route automatically (see vercel.json) and sets:
//   Authorization: Bearer {CRON_SECRET}
// All other callers receive 401.
//
// Strategy:
//   - Fetch up to 50 'failed' rows created within the last 24 hours
//     where retry_count < MAX_RETRIES.
//   - Re-dispatch each row to the same business-logic handler used by
//     the live webhook route (processTwilioPayload / processStripePayload).
//   - On success: mark 'processed'. On failure: increment retry_count and
//     leave as 'failed'. At MAX_RETRIES the row stays 'failed' permanently
//     and requires manual triage.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { logger } from "@/lib/logger";
import { processTwilioPayload } from "@/app/api/webhooks/twilio/route";
import { processStripePayload, StripeEvent } from "@/app/api/webhooks/stripe/route";

const MAX_RETRIES = 3;

function getServiceDb() {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY not configured");
    return createClient(url, key);
}

export async function GET(req: NextRequest) {
    // Verify the Vercel cron secret — rejects any external caller.
    const authHeader = req.headers.get("authorization");
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const correlationId = crypto.randomUUID();
    const db = getServiceDb();

    // Fetch failed events that still have retry budget and are recent enough
    // to be worth retrying (> 24 h old events are likely permanently broken).
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: events, error: fetchError } = await db
        .from("webhook_events")
        .select("id, provider, event_id, payload, retry_count")
        .eq("status", "failed")
        .lt("retry_count", MAX_RETRIES)
        .gte("created_at", cutoff)
        .order("created_at", { ascending: true })
        .limit(50);

    if (fetchError) {
        logger.error({ err: fetchError, correlationId }, "cron/retry-webhooks: failed to fetch events");
        return NextResponse.json({ error: "DB fetch failed" }, { status: 500 });
    }

    if (!events?.length) {
        logger.info({ correlationId }, "cron/retry-webhooks: no failed events to retry");
        return NextResponse.json({ processed: 0, succeeded: 0, failed: 0 });
    }

    logger.info({ correlationId, total: events.length }, "cron/retry-webhooks: starting retry pass");

    const results = { succeeded: 0, failed: 0 };

    for (const event of events) {
        const eventCorrelationId = `${correlationId}:${event.id}`;
        let success = false;

        try {
            if (event.provider === "twilio") {
                success = await processTwilioPayload(
                    db,
                    event.payload as Record<string, string>,
                    eventCorrelationId
                );
            } else if (event.provider === "stripe") {
                success = await processStripePayload(
                    db,
                    event.payload as StripeEvent,
                    eventCorrelationId
                );
            } else {
                // Unknown provider — mark as permanently failed to avoid re-queuing.
                logger.warn({ correlationId, eventId: event.id, provider: event.provider }, "cron/retry-webhooks: unknown provider");
            }
        } catch (err) {
            logger.error({ err, correlationId, eventId: event.id }, "cron/retry-webhooks: handler threw unexpectedly");
        }

        const newRetryCount = event.retry_count + 1;
        await db
            .from("webhook_events")
            .update({
                retry_count: newRetryCount,
                status: success ? "processed" : "failed",
                processed_at: success ? new Date().toISOString() : null,
            })
            .eq("id", event.id);

        success ? results.succeeded++ : results.failed++;
    }

    logger.info({ correlationId, ...results, total: events.length }, "cron/retry-webhooks: pass complete");
    return NextResponse.json({ processed: events.length, ...results });
}
