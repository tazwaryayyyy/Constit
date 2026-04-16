// app/api/activity/route.ts
// Simple activity log: import, generate, export events per campaign.

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";

export async function GET(req: NextRequest) {
    const campaign_id = req.nextUrl.searchParams.get("campaign_id");
    if (!campaign_id) {
        return NextResponse.json({ error: "campaign_id required" }, { status: 400 });
    }

    const { data, error } = await supabase
        .from("activity_log")
        .select("id, event, details, created_at")
        .eq("campaign_id", campaign_id)
        .order("created_at", { ascending: false })
        .limit(10);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ events: data ?? [] });
}

export async function POST(req: NextRequest) {
    const body = await req.json();
    const { campaign_id, event, details } = body as {
        campaign_id: string;
        event: string;
        details?: string;
    };

    if (!campaign_id || !event) {
        return NextResponse.json({ error: "campaign_id and event are required" }, { status: 400 });
    }

    const { error } = await supabase
        .from("activity_log")
        .insert({ campaign_id, event, details: details ?? null });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
}
