// app/api/send/route.ts
// Sends personalized SMS to all pending contacts in a campaign via Twilio.
// Creates delivery records for each contact and returns a job summary.
// Twilio callbacks update delivery status via /api/webhooks/twilio.

import { NextRequest, NextResponse } from "next/server";
import { getRouteSupabaseAndUser } from "@/lib/supabaseRouteAuth";
import { renderMessage } from "@/lib/sms";

const MAX_CONTACTS_PER_SEND = 10_000;

function getTwilioClient() {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    if (!accountSid || !authToken) {
        throw new Error("Twilio credentials not configured. Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN.");
    }
    return { accountSid, authToken };
}

async function sendOneTwilioSMS(
    to: string,
    body: string,
    from: string,
    accountSid: string,
    authToken: string,
    statusCallbackUrl: string
): Promise<{ sid: string; status: string } | { error: string }> {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
    const params = new URLSearchParams({
        To: to,
        From: from,
        Body: body,
        StatusCallback: statusCallbackUrl,
    });

    const response = await fetch(url, {
        method: "POST",
        headers: {
            Authorization: "Basic " + Buffer.from(`${accountSid}:${authToken}`).toString("base64"),
            "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params.toString(),
    });

    const data = await response.json() as { sid?: string; status?: string; message?: string };
    if (!response.ok) {
        return { error: data.message ?? `Twilio error ${response.status}` };
    }
    return { sid: data.sid!, status: data.status! };
}

export async function POST(req: NextRequest) {
    const correlationId = req.headers.get("x-request-id") ?? crypto.randomUUID();
    const { user, db } = await getRouteSupabaseAndUser(req);

    if (!user || !db) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { campaign_id, include_opt_out = true } = body as {
        campaign_id: string;
        include_opt_out?: boolean;
    };

    if (!campaign_id) {
        return NextResponse.json({ error: "campaign_id is required" }, { status: 400 });
    }

    // ── Verify campaign ownership ──────────────────────────────────────────
    const { data: campaign, error: campError } = await db
        .from("campaigns")
        .select("id, name")
        .eq("id", campaign_id)
        .single();

    if (campError || !campaign) {
        return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    // ── Get selected message ───────────────────────────────────────────────
    const { data: message, error: msgError } = await db
        .from("messages")
        .select("id, sms, tone")
        .eq("campaign_id", campaign_id)
        .eq("selected", true)
        .single();

    if (msgError || !message) {
        return NextResponse.json(
            { error: "No message selected. Select a message variant before sending." },
            { status: 422 }
        );
    }

    // ── Get pending contacts ───────────────────────────────────────────────
    const { data: contacts, error: contactsError } = await db
        .from("contacts")
        .select("id, name, phone")
        .eq("campaign_id", campaign_id)
        .eq("status", "pending")
        .not("phone", "is", null)
        .limit(MAX_CONTACTS_PER_SEND);

    if (contactsError) {
        console.error(`[send] [${correlationId}] contacts fetch error:`, contactsError.message);
        return NextResponse.json({ error: "Failed to load contacts" }, { status: 500 });
    }

    if (!contacts || contacts.length === 0) {
        return NextResponse.json(
            { error: "No pending contacts with phone numbers to send to." },
            { status: 422 }
        );
    }

    // ── Twilio setup ───────────────────────────────────────────────────────
    let twilioClient: { accountSid: string; authToken: string };
    try {
        twilioClient = getTwilioClient();
    } catch (err) {
        return NextResponse.json(
            { error: (err as Error).message },
            { status: 503 }
        );
    }

    const fromNumber = process.env.TWILIO_FROM_NUMBER;
    if (!fromNumber) {
        return NextResponse.json(
            { error: "TWILIO_FROM_NUMBER not configured." },
            { status: 503 }
        );
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://your-app.vercel.app";
    const statusCallbackUrl = `${baseUrl}/api/webhooks/twilio`;

    // ── Send loop: create delivery records then send ───────────────────────
    const results = {
        total: contacts.length,
        queued: 0,
        failed: 0,
        errors: [] as Array<{ phone: string; error: string }>,
    };

    // Batch create queued delivery records first
    const deliveryRows = contacts.map((c) => ({
        campaign_id,
        contact_id: c.id,
        message_id: message.id,
        status: "queued" as const,
    }));

    const { data: deliveries, error: deliveriesError } = await db
        .from("deliveries")
        .insert(deliveryRows)
        .select("id, contact_id");

    if (deliveriesError) {
        console.error(`[send] [${correlationId}] delivery insert error:`, deliveriesError.message);
        return NextResponse.json({ error: "Failed to create delivery records" }, { status: 500 });
    }

    const deliveryMap = new Map(deliveries!.map((d) => [d.contact_id as string, d.id as string]));

    // Send in batches of 50 to respect Twilio rate limits (~100 msg/sec on trial)
    const BATCH_SIZE = 50;
    for (let i = 0; i < contacts.length; i += BATCH_SIZE) {
        const batch = contacts.slice(i, i + BATCH_SIZE);

        await Promise.all(
            batch.map(async (contact) => {
                const { text: smsBody } = renderMessage(
                    { name: contact.name },
                    message.sms,
                    { optOut: include_opt_out }
                );

                const deliveryId = deliveryMap.get(contact.id);
                const result = await sendOneTwilioSMS(
                    contact.phone!,
                    smsBody,
                    fromNumber,
                    twilioClient.accountSid,
                    twilioClient.authToken,
                    statusCallbackUrl
                );

                if ("error" in result) {
                    results.failed++;
                    results.errors.push({ phone: contact.phone!, error: result.error });

                    // Update delivery record to failed
                    if (deliveryId) {
                        await db
                            .from("deliveries")
                            .update({ status: "failed", error_message: result.error })
                            .eq("id", deliveryId);
                    }

                    console.warn(`[send] [${correlationId}] failed to send to ${contact.phone}: ${result.error}`);
                } else {
                    results.queued++;

                    // Update delivery record with Twilio SID
                    if (deliveryId) {
                        await db
                            .from("deliveries")
                            .update({ status: "sending", twilio_sid: result.sid })
                            .eq("id", deliveryId);
                    }

                    // Mark contact as contacted
                    await db
                        .from("contacts")
                        .update({ status: "contacted", last_contacted_at: new Date().toISOString() })
                        .eq("id", contact.id);
                }
            })
        );
    }

    // ── Activity log ──────────────────────────────────────────────────────
    await db.from("activity_log").insert({
        campaign_id,
        event: "SMS sent via Twilio",
        details: `${results.queued} sent, ${results.failed} failed out of ${results.total} contacts`,
    });

    return NextResponse.json(
        { ok: true, ...results },
        { headers: { "x-request-id": correlationId } }
    );
}
