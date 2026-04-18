// app/api/replies/route.ts
// GET: returns replies for a campaign with pagination
// Used by the campaign page inbox tab

import { NextRequest, NextResponse } from "next/server";
import { getRouteSupabaseAndUser } from "@/lib/supabaseRouteAuth";

export async function GET(req: NextRequest) {
    const correlationId = req.headers.get("x-request-id") ?? crypto.randomUUID();
    const { user, db } = await getRouteSupabaseAndUser(req);

    if (!user || !db) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const campaign_id = req.nextUrl.searchParams.get("campaign_id");
    const intent = req.nextUrl.searchParams.get("intent"); // filter by intent
    const page = parseInt(req.nextUrl.searchParams.get("page") ?? "1", 10);
    const perPage = 25;

    if (!campaign_id) {
        return NextResponse.json({ error: "campaign_id is required" }, { status: 400 });
    }

    // Verify ownership
    const { data: campaign } = await db
        .from("campaigns")
        .select("id")
        .eq("id", campaign_id)
        .single();

    if (!campaign) {
        return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    let query = db
        .from("replies")
        .select("id, from_phone, body, intent, ai_summary, received_at, contact_id", { count: "exact" })
        .eq("campaign_id", campaign_id)
        .order("received_at", { ascending: false })
        .range((page - 1) * perPage, page * perPage - 1);

    if (intent && intent !== "all") {
        query = query.eq("intent", intent);
    }

    const { data: replies, count, error } = await query;

    if (error) {
        console.error(`[replies GET] [${correlationId}] DB error:`, error.message);
        return NextResponse.json({ error: "Failed to load replies" }, { status: 500 });
    }

    // Mask phone numbers in response (privacy)
    const masked = (replies ?? []).map((r) => ({
        ...r,
        from_phone: r.from_phone.replace(/(\+?\d{1,3})(\d{3})(\d{3})(\d{4})/, "$1***$3$4"),
    }));

    return NextResponse.json(
        {
            replies: masked,
            total: count ?? 0,
            page,
            per_page: perPage,
            total_pages: Math.ceil((count ?? 0) / perPage),
        },
        { headers: { "x-request-id": correlationId } }
    );
}
