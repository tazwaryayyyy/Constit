// app/api/messages/[id]/route.ts
// PATCH: update SMS text of a message (inline editing before selection).
// RLS on the messages table ensures users can only edit their own campaign messages.

import { NextRequest, NextResponse } from "next/server";
import { analyzeSMS } from "@/lib/sms";
import { getRouteSupabaseAndUser } from "@/lib/supabaseRouteAuth";

export async function PATCH(
    req: NextRequest,
    { params }: { params: { id: string } }
) {
    const correlationId = req.headers.get("x-request-id") ?? crypto.randomUUID();
    const { user, db } = await getRouteSupabaseAndUser(req);

    if (!user || !db) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = params;
    const body = await req.json();
    const sms = typeof body?.sms === "string" ? body.sms.trim() : null;

    if (!sms) {
        return NextResponse.json({ error: "sms is required" }, { status: 400 });
    }
    if (sms.length < 10) {
        return NextResponse.json({ error: "SMS must be at least 10 characters" }, { status: 400 });
    }

    // ── Ownership check: verify message exists before updating ─────────────
    const { data: existing, error: lookupError } = await db
        .from("messages")
        .select("id, campaign_id")
        .eq("id", id)
        .single();

    if (lookupError || !existing) {
        console.warn(`[messages PATCH] [${correlationId}] message ${id} not found for user ${user.id}`);
        return NextResponse.json({ error: "Message not found" }, { status: 404 });
    }

    // Validate at the API boundary — don't silently accept over-limit messages.
    const analysis = analyzeSMS(sms);
    if (analysis.isOverSingleSegment) {
        return NextResponse.json(
            {
                error: `SMS is ${analysis.encoding === "GSM" ? analysis.gsmUnits : analysis.charCount} characters — exceeds ${analysis.maxSingleSegment} limit for ${analysis.encoding} encoding.`,
                encoding: analysis.encoding,
                segments: analysis.segments,
            },
            { status: 422 }
        );
    }

    const { error } = await db
        .from("messages")
        .update({ sms })
        .eq("id", id);

    if (error) {
        console.error(`[messages PATCH] [${correlationId}] DB error:`, error.message);
        if (error.message.toLowerCase().includes("row-level security")) {
            return NextResponse.json({ error: "Unauthorized for this message operation." }, { status: 403 });
        }
        return NextResponse.json({ error: "Failed to update message" }, { status: 500 });
    }

    return NextResponse.json({ ok: true }, { headers: { "x-request-id": correlationId } });
}
