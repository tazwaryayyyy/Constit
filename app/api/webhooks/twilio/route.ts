// app/api/webhooks/twilio/route.ts
// Receives Twilio status callbacks for outbound messages AND inbound replies.
//
// Outbound status: POST with MessageSid + MessageStatus → update deliveries table
// Inbound reply:   POST with From + Body → create replies table entry + AI classify
//
// Security: Twilio signs every webhook request. We validate the signature to prevent
// spoofed delivery status updates. Set TWILIO_AUTH_TOKEN in env.
//
// FIX #3: Every received webhook is persisted to webhook_events (dead-letter queue)
// BEFORE business-logic processing. If the DB write fails, the raw payload survives
// for manual retry. Provider retries are idempotent via the UNIQUE constraint.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { waitUntil } from "@vercel/functions";
import { logger } from "@/lib/logger";

// ── Twilio signature validation ────────────────────────────────────────────────
// Twilio signs webhook POSTs with HMAC-SHA1. Without validation, anyone can
// forge delivery confirmations or inject fake replies.
async function validateTwilioSignature(
    req: NextRequest,
    rawBody: string
): Promise<boolean> {
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    if (!authToken) return false;

    const signature = req.headers.get("x-twilio-signature") ?? "";
    const url = process.env.NEXT_PUBLIC_APP_URL
        ? `${process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/twilio`
        : req.url;

    // Build the string to sign: URL + sorted params
    const params = new URLSearchParams(rawBody);
    const sortedKeys = Array.from(params.keys()).sort();
    let toSign = url;
    for (const key of sortedKeys) {
        toSign += key + (params.get(key) ?? "");
    }

    // HMAC-SHA1 using Web Crypto API (Edge runtime compatible)
    const encoder = new TextEncoder();
    const keyData = encoder.encode(authToken);
    const messageData = encoder.encode(toSign);

    const cryptoKey = await crypto.subtle.importKey(
        "raw",
        keyData,
        { name: "HMAC", hash: "SHA-1" },
        false,
        ["sign"]
    );

    const signatureBuffer = await crypto.subtle.sign("HMAC", cryptoKey, messageData);
    const computed = Buffer.from(signatureBuffer).toString("base64");

    return computed === signature;
}

// ── Service role Supabase client (bypasses RLS for webhook writes) ─────────────
// Webhooks run as Twilio's server, not an authenticated user. We use the service
// role key so we can write to deliveries/replies without a JWT.
function getServiceDb() {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY not configured");
    return createClient(url, key);
}

// ── Simple AI classification for replies (reuses existing Groq setup) ──────────
async function classifyReply(body: string): Promise<{
    intent: "positive" | "negative" | "question" | "opt_out" | "unclassified";
    summary: string;
}> {
    const apiKey = process.env.GROQ_API_KEY ?? process.env.OPENAI_API_KEY;
    if (!apiKey) return { intent: "unclassified", summary: "" };

    // Fast opt-out detection without AI
    const lower = body.toLowerCase().trim();
    if (["stop", "stopall", "unsubscribe", "cancel", "end", "quit"].includes(lower)) {
        return { intent: "opt_out", summary: "Requested opt-out" };
    }

    try {
        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model: "llama-3.1-8b-instant",
                messages: [
                    {
                        role: "user",
                        content: `Classify this SMS reply from a civic campaign contact. Reply with JSON only.
SMS: "${body.slice(0, 300)}"

Return: {"intent": "positive"|"negative"|"question"|"opt_out"|"unclassified", "summary": "one sentence"}
- positive: supportive, will vote, will attend, pledging action
- negative: disagrees, complaints, hostile
- question: asking for info
- opt_out: wants to stop receiving texts (STOP, unsubscribe, etc.)
- unclassified: unclear`,
                    },
                ],
                max_tokens: 100,
                temperature: 0.1,
            }),
        });

        const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
        const content = data.choices?.[0]?.message?.content ?? "{}";
        const parsed = JSON.parse(content.replace(/```json|```/g, "").trim()) as {
            intent?: string;
            summary?: string;
        };
        const validIntents = ["positive", "negative", "question", "opt_out", "unclassified"];
        const intent = validIntents.includes(parsed.intent ?? "")
            ? (parsed.intent as "positive" | "negative" | "question" | "opt_out" | "unclassified")
            : "unclassified";
        return { intent, summary: (parsed.summary ?? "").slice(0, 200) };
    } catch {
        return { intent: "unclassified", summary: "" };
    }
}

// ── DLQ finalization helper ────────────────────────────────────────────────────
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
export async function processTwilioPayload(
    db: ReturnType<typeof getServiceDb>,
    params: Record<string, string>,
    correlationId: string
): Promise<boolean> {
    const messageSid = params["MessageSid"] ?? "";
    const messageStatus = params["MessageStatus"];
    const fromPhone = params["From"] ?? "";
    const toPhone = params["To"] ?? "";
    const bodyText = params["Body"] ?? "";
    const errorCode = params["ErrorCode"];
    const numSegments = params["NumSegments"];

    // ── Outbound status callback ───────────────────────────────────────────
    if (messageStatus) {
        const validStatuses = ["queued", "sending", "sent", "delivered", "failed", "undelivered"];
        const status = validStatuses.includes(messageStatus) ? messageStatus : "undelivered";

        const updateData: Record<string, unknown> = { status };
        if (status === "delivered") updateData.delivered_at = new Date().toISOString();
        if (errorCode) updateData.error_code = errorCode;
        if (numSegments) updateData.segments_billed = parseInt(numSegments, 10);

        const { error } = await db
            .from("deliveries")
            .update(updateData)
            .eq("twilio_sid", messageSid);

        if (error) {
            logger.error({ err: error, correlationId, messageSid, status }, "webhooks/twilio: delivery status update failed");
            return false;
        }
        return true;
    }

    // ── Inbound reply ──────────────────────────────────────────────────────
    if (fromPhone && bodyText) {
        const { data: contactRow } = await db
            .from("contacts")
            .select("id, campaign_id, status")
            .eq("phone", fromPhone)
            .limit(1)
            .single();

        const { intent, summary } = await classifyReply(bodyText);

        if (intent === "opt_out" && contactRow) {
            await db
                .from("contacts")
                .update({ status: "opted_out" })
                .eq("id", contactRow.id);
        } else if (contactRow && contactRow.status === "contacted") {
            await db
                .from("contacts")
                .update({ status: "replied" })
                .eq("id", contactRow.id);
        }

        const { error: replyError } = await db.from("replies").insert({
            campaign_id: contactRow?.campaign_id ?? null,
            contact_id: contactRow?.id ?? null,
            from_phone: fromPhone,
            body: bodyText.slice(0, 1600),
            twilio_sid: messageSid,
            intent,
            ai_summary: summary,
        });

        if (replyError) {
            logger.error({ err: replyError, correlationId, fromPhone }, "webhooks/twilio: reply insert failed");
            return false;
        }

        // Auto-send STOP confirmation for opt-outs (TCPA compliance)
        if (intent === "opt_out" && toPhone) {
            const accountSid = process.env.TWILIO_ACCOUNT_SID;
            const authToken = process.env.TWILIO_AUTH_TOKEN;
            if (accountSid && authToken) {
                await fetch(
                    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
                    {
                        method: "POST",
                        headers: {
                            Authorization: "Basic " + Buffer.from(`${accountSid}:${authToken}`).toString("base64"),
                            "Content-Type": "application/x-www-form-urlencoded",
                        },
                        body: new URLSearchParams({
                            To: fromPhone,
                            From: toPhone,
                            Body: "You have been unsubscribed and will receive no further messages.",
                        }).toString(),
                    }
                );
            }
        }

        if (contactRow?.campaign_id) {
            await db.from("activity_log").insert({
                campaign_id: contactRow.campaign_id,
                event: "Reply received",
                details: `${fromPhone}: ${intent} — "${bodyText.slice(0, 80)}"`,
            });
        }

        return true;
    }

    return true; // unknown payload shape — nothing to process
}

export async function POST(req: NextRequest) {
    const correlationId = req.headers.get("x-request-id") ?? crypto.randomUUID();
    const rawBody = await req.text();

    // ── Validate Twilio signature ──────────────────────────────────────────
    const isValid = await validateTwilioSignature(req, rawBody);
    if (!isValid && process.env.NODE_ENV === "production") {
        logger.warn({ correlationId }, "webhooks/twilio: invalid signature — rejected");
        return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
    }

    const params = new URLSearchParams(rawBody);
    const db = getServiceDb();

    const messageSid = params.get("MessageSid") ?? "";
    const messageStatus = params.get("MessageStatus");
    const fromPhone = params.get("From") ?? "";
    const bodyText = params.get("Body") ?? "";
    const rawPayload = Object.fromEntries(params.entries());

    // ── Persist to DLQ before any processing ──────────────────────────────
    const dlqEventId = messageStatus
        ? `${messageSid}:${messageStatus}`
        : `${messageSid}:inbound`;

    const { data: dlqRow, error: dlqError } = await db
        .from("webhook_events")
        .upsert(
            { provider: "twilio", event_id: dlqEventId, payload: rawPayload, status: "pending" },
            { onConflict: "provider,event_id", ignoreDuplicates: true }
        )
        .select("id")
        .maybeSingle();

    if (dlqError) {
        logger.error({ err: dlqError, correlationId, eventId: dlqEventId }, "webhooks/twilio: DLQ insert failed — processing anyway");
    }

    const dlqId = dlqRow?.id as string | undefined;

    // ── Return 200 immediately; process in the background ─────────────────
    // waitUntil keeps the Vercel function alive until the promise resolves
    // but allows the HTTP response to reach Twilio without delay, preventing
    // the 15-second timeout that triggers unwanted retries.
    waitUntil(
        processTwilioPayload(db, rawPayload, correlationId)
            .then((success) => { if (dlqId) return markDlq(db, dlqId, success); })
            .catch((err) => {
                logger.error({ err, correlationId }, "webhooks/twilio: background processing error");
                if (dlqId) return markDlq(db, dlqId, false);
            })
    );

    // Twilio parses the response body as TwiML for inbound messages.
    // Empty <Response/> means "do nothing further" — no auto-reply needed.
    const isInbound = !messageStatus && fromPhone && bodyText;
    if (isInbound) {
        return new NextResponse(
            `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`,
            { headers: { "Content-Type": "text/xml" } }
        );
    }
    return NextResponse.json({ ok: true });
}

logger.warn({ correlationId }, "webhooks/twilio: invalid signature — rejected");
return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
    }

const params = new URLSearchParams(rawBody);
const db = getServiceDb();

const messageSid = params.get("MessageSid") ?? "";
const messageStatus = params.get("MessageStatus");
const fromPhone = params.get("From") ?? "";
const toPhone = params.get("To") ?? "";
const bodyText = params.get("Body") ?? "";
const errorCode = params.get("ErrorCode");
const numSegments = params.get("NumSegments");

// ── FIX #3: Persist payload to DLQ before any processing ──────────────
// event_id combines MessageSid + type so re-deliveries of the same status
// are idempotent while distinct status transitions are separately tracked.
const dlqEventId = messageStatus
    ? `${messageSid}:${messageStatus}`
    : `${messageSid}:inbound`;

const rawPayload = Object.fromEntries(params.entries());

const { data: dlqRow, error: dlqError } = await db
    .from("webhook_events")
    .upsert(
        { provider: "twilio", event_id: dlqEventId, payload: rawPayload, status: "pending" },
        { onConflict: "provider,event_id", ignoreDuplicates: true }
    )
    .select("id")
    .maybeSingle();

if (dlqError) {
    // DLQ write failed — log and continue processing. The provider got the
    // request; losing the DLQ row is better than dropping the webhook entirely.
    logger.error({ err: dlqError, correlationId, eventId: dlqEventId }, "webhooks/twilio: DLQ insert failed — processing anyway");
}

const dlqId = dlqRow?.id as string | undefined;

// Helper to mark the DLQ row processed or failed after we attempt to handle it.
async function finalizeDlq(success: boolean) {
    if (!dlqId) return;
    await db
        .from("webhook_events")
        .update({ status: success ? "processed" : "failed", processed_at: new Date().toISOString() })
        .eq("id", dlqId);
}

// ── Outbound status callback ───────────────────────────────────────────
if (messageStatus) {
    const validStatuses = ["queued", "sending", "sent", "delivered", "failed", "undelivered"];
    const status = validStatuses.includes(messageStatus) ? messageStatus : "undelivered";

    const updateData: Record<string, unknown> = { status };
    if (status === "delivered") updateData.delivered_at = new Date().toISOString();
    if (errorCode) updateData.error_code = errorCode;
    if (numSegments) updateData.segments_billed = parseInt(numSegments, 10);

    const { error } = await db
        .from("deliveries")
        .update(updateData)
        .eq("twilio_sid", messageSid);

    if (error) {
        logger.error({ err: error, correlationId, messageSid, status }, "webhooks/twilio: delivery status update failed");
        await finalizeDlq(false);
    } else {
        await finalizeDlq(true);
    }

    return NextResponse.json({ ok: true });
}

// ── Inbound reply ──────────────────────────────────────────────────────
if (fromPhone && bodyText) {
    const { data: contactRow } = await db
        .from("contacts")
        .select("id, campaign_id, status")
        .eq("phone", fromPhone)
        .limit(1)
        .single();

    const { intent, summary } = await classifyReply(bodyText);

    if (intent === "opt_out" && contactRow) {
        await db
            .from("contacts")
            .update({ status: "opted_out" })
            .eq("id", contactRow.id);
    } else if (contactRow && contactRow.status === "contacted") {
        await db
            .from("contacts")
            .update({ status: "replied" })
            .eq("id", contactRow.id);
    }

    const { error: replyError } = await db.from("replies").insert({
        campaign_id: contactRow?.campaign_id ?? null,
        contact_id: contactRow?.id ?? null,
        from_phone: fromPhone,
        body: bodyText.slice(0, 1600),
        twilio_sid: messageSid,
        intent,
        ai_summary: summary,
    });

    if (replyError) {
        logger.error({ err: replyError, correlationId, fromPhone }, "webhooks/twilio: reply insert failed");
        await finalizeDlq(false);
    } else {
        await finalizeDlq(true);
    }

    // Auto-send STOP confirmation for opt-outs (TCPA compliance)
    if (intent === "opt_out" && toPhone) {
        const accountSid = process.env.TWILIO_ACCOUNT_SID;
        const authToken = process.env.TWILIO_AUTH_TOKEN;
        if (accountSid && authToken) {
            await fetch(
                `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
                {
                    method: "POST",
                    headers: {
                        Authorization: "Basic " + Buffer.from(`${accountSid}:${authToken}`).toString("base64"),
                        "Content-Type": "application/x-www-form-urlencoded",
                    },
                    body: new URLSearchParams({
                        To: fromPhone,
                        From: toPhone,
                        Body: "You have been unsubscribed and will receive no further messages.",
                    }).toString(),
                }
            );
        }
    }

    if (contactRow?.campaign_id) {
        await db.from("activity_log").insert({
            campaign_id: contactRow.campaign_id,
            event: "Reply received",
            details: `${fromPhone}: ${intent} — "${bodyText.slice(0, 80)}"`,
        });
    }

    return new NextResponse(
        `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`,
        { headers: { "Content-Type": "text/xml" } }
    );
}

return NextResponse.json({ ok: true });
}
