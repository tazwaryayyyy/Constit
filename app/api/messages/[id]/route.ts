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
        if (error.message.toLowerCase().includes("row-level security")) {
            return NextResponse.json({ error: "Unauthorized for this message operation." }, { status: 403 });
        }
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
}
