// app/api/activity/route.ts
// Simple activity log: import, generate, export events per campaign.

import { NextRequest, NextResponse } from "next/server";
import { getRouteSupabaseAndUser } from "@/lib/supabaseRouteAuth";

export async function GET(req: NextRequest) {
    const correlationId = req.headers.get("x-request-id") ?? crypto.randomUUID();
    const { user, db } = await getRouteSupabaseAndUser(req);

    if (!user || !db) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const campaign_id = req.nextUrl.searchParams.get("campaign_id");
    if (!campaign_id) {
        return NextResponse.json({ error: "campaign_id required" }, { status: 400 });
    }

    const { data, error } = await db
        .from("activity_log")
        .select("id, event, details, created_at")
        .eq("campaign_id", campaign_id)
        .order("created_at", { ascending: false })
        .limit(20);

    if (error) {
        console.error(`[activity GET] [${correlationId}] DB error:`, error.message);
        return NextResponse.json({ error: "Failed to load activity" }, { status: 500 });
    }
    return NextResponse.json({ events: data ?? [] }, { headers: { "x-request-id": correlationId } });
}

export async function POST(req: NextRequest) {
    const correlationId = req.headers.get("x-request-id") ?? crypto.randomUUID();
    const { user, db } = await getRouteSupabaseAndUser(req);

    if (!user || !db) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { campaign_id, event, details } = body as {
        campaign_id: string;
        event: string;
        details?: string;
    };

    if (!campaign_id || !event) {
        return NextResponse.json({ error: "campaign_id and event are required" }, { status: 400 });
    }
    if (typeof event !== "string" || event.length > 200) {
        return NextResponse.json({ error: "event must be a string under 200 chars" }, { status: 400 });
    }

    const { error } = await db
        .from("activity_log")
        .insert({ campaign_id, event, details: details ? String(details).slice(0, 500) : null });

    if (error) {
        console.error(`[activity POST] [${correlationId}] DB error:`, error.message);
        return NextResponse.json({ error: "Failed to log activity" }, { status: 500 });
    }
    return NextResponse.json({ ok: true }, { headers: { "x-request-id": correlationId } });
}
