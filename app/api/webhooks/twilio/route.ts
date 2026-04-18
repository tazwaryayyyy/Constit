// app/api/webhooks/twilio/route.ts
// Receives Twilio status callbacks for outbound messages AND inbound replies.
//
// Outbound status: POST with MessageSid + MessageStatus → update deliveries table
// Inbound reply:   POST with From + Body → create replies table entry + AI classify
//
// Security: Twilio signs every webhook request. We validate the signature to prevent
// spoofed delivery status updates. Set TWILIO_AUTH_TOKEN in env.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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

export async function POST(req: NextRequest) {
    const correlationId = req.headers.get("x-request-id") ?? crypto.randomUUID();
    const rawBody = await req.text();

    // ── Validate Twilio signature ──────────────────────────────────────────
    const isValid = await validateTwilioSignature(req, rawBody);
    if (!isValid && process.env.NODE_ENV === "production") {
        console.warn(`[webhooks/twilio] [${correlationId}] Invalid signature — rejected`);
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

    // ── Outbound status callback ───────────────────────────────────────────
    // Triggered when an outbound message status changes (sent → delivered, failed, etc.)
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
            console.error(`[webhooks/twilio] [${correlationId}] delivery update error:`, error.message);
        }

        return NextResponse.json({ ok: true });
    }

    // ── Inbound reply ──────────────────────────────────────────────────────
    // Triggered when a contact replies to a campaign SMS.
    if (fromPhone && bodyText) {
        // Find the campaign by matching the "To" number (our Twilio number)
        // and find the contact by their "From" phone number.
        const { data: contactRow } = await db
            .from("contacts")
            .select("id, campaign_id, status")
            .eq("phone", fromPhone)
            .limit(1)
            .single();

        // Classify reply intent via AI
        const { intent, summary } = await classifyReply(bodyText);

        // If opt-out: immediately update contact status to opted_out
        if (intent === "opt_out" && contactRow) {
            await db
                .from("contacts")
                .update({ status: "opted_out" })
                .eq("id", contactRow.id);
        } else if (contactRow && contactRow.status === "contacted") {
            // Mark contact as replied
            await db
                .from("contacts")
                .update({ status: "replied" })
                .eq("id", contactRow.id);
        }

        // Store the reply
        const { error: replyError } = await db.from("replies").insert({
            campaign_id: contactRow?.campaign_id ?? null,
            contact_id: contactRow?.id ?? null,
            from_phone: fromPhone,
            body: bodyText.slice(0, 1600), // SMS max 1600 chars
            twilio_sid: messageSid,
            intent,
            ai_summary: summary,
        });

        if (replyError) {
            console.error(`[webhooks/twilio] [${correlationId}] reply insert error:`, replyError.message);
        }

        // Auto-send STOP confirmation if opt-out (TCPA compliance)
        if (intent === "opt_out" && toPhone) {
            const accountSid = process.env.TWILIO_ACCOUNT_SID;
            const authToken = process.env.TWILIO_AUTH_TOKEN;
            if (accountSid && authToken) {
                const stopConfirmation = "You have been unsubscribed and will receive no further messages.";
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
                            Body: stopConfirmation,
                        }).toString(),
                    }
                );
            }
        }

        // Log activity for campaign
        if (contactRow?.campaign_id) {
            await db.from("activity_log").insert({
                campaign_id: contactRow.campaign_id,
                event: "Reply received",
                details: `${fromPhone}: ${intent} — "${bodyText.slice(0, 80)}"`,
            });
        }

        // Respond with TwiML to prevent Twilio from sending an error reply
        return new NextResponse(
            `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`,
            { headers: { "Content-Type": "text/xml" } }
        );
    }

    return NextResponse.json({ ok: true });
}
