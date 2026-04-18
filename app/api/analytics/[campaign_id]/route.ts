// app/api/analytics/[campaign_id]/route.ts
// Returns campaign analytics: delivery stats, reply breakdown, A/B variant performance.
// Used by the campaign analytics dashboard tab.

import { NextRequest, NextResponse } from "next/server";
import { getRouteSupabaseAndUser } from "@/lib/supabaseRouteAuth";

export async function GET(
    req: NextRequest,
    { params }: { params: { campaign_id: string } }
) {
    const correlationId = req.headers.get("x-request-id") ?? crypto.randomUUID();
    const { user, db } = await getRouteSupabaseAndUser(req);

    if (!user || !db) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { campaign_id } = params;

    // ── Verify ownership ────────────────────────────────────────────────────
    const { data: campaign, error: campError } = await db
        .from("campaigns")
        .select("id, name")
        .eq("id", campaign_id)
        .single();

    if (campError || !campaign) {
        return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    // ── Fetch all data in parallel ──────────────────────────────────────────
    const [
        { data: contacts },
        { data: deliveries },
        { data: replies },
        { data: messages },
    ] = await Promise.all([
        db
            .from("contacts")
            .select("status")
            .eq("campaign_id", campaign_id),
        db
            .from("deliveries")
            .select("status, segments_billed, message_id, sent_at, delivered_at")
            .eq("campaign_id", campaign_id),
        db
            .from("replies")
            .select("intent, ai_summary, received_at, from_phone")
            .eq("campaign_id", campaign_id)
            .order("received_at", { ascending: false }),
        db
            .from("messages")
            .select("id, tone, sms, selected")
            .eq("campaign_id", campaign_id),
    ]);

    // ── Contact breakdown ────────────────────────────────────────────────────
    const contactStats = (contacts ?? []).reduce<Record<string, number>>(
        (acc, c) => {
            acc[c.status] = (acc[c.status] ?? 0) + 1;
            return acc;
        },
        {}
    );

    // ── Delivery stats ───────────────────────────────────────────────────────
    const deliveryStats = (deliveries ?? []).reduce<Record<string, number>>(
        (acc, d) => {
            acc[d.status] = (acc[d.status] ?? 0) + 1;
            return acc;
        },
        {}
    );

    const totalDeliveries = deliveries?.length ?? 0;
    const deliveredCount = deliveryStats["delivered"] ?? 0;
    const failedCount = (deliveryStats["failed"] ?? 0) + (deliveryStats["undelivered"] ?? 0);
    const deliveryRate = totalDeliveries > 0 ? Math.round((deliveredCount / totalDeliveries) * 100) : 0;

    const totalSegmentsBilled = (deliveries ?? []).reduce(
        (sum, d) => sum + (d.segments_billed ?? 1),
        0
    );

    // ── Reply breakdown ──────────────────────────────────────────────────────
    const replyStats = (replies ?? []).reduce<Record<string, number>>(
        (acc, r) => {
            acc[r.intent] = (acc[r.intent] ?? 0) + 1;
            return acc;
        },
        {}
    );

    const totalReplies = replies?.length ?? 0;
    const replyRate =
        totalDeliveries > 0 ? Math.round((totalReplies / totalDeliveries) * 100) : 0;

    // ── Per-variant performance (A/B tracking) ───────────────────────────────
    const variantPerformance = (messages ?? []).map((msg) => {
        const msgDeliveries = (deliveries ?? []).filter((d) => d.message_id === msg.id);
        const msgDelivered = msgDeliveries.filter((d) => d.status === "delivered").length;
        const msgReplies = 0; // Cross-link replies to message_id in future with delivery join
        return {
            message_id: msg.id,
            tone: msg.tone,
            sms_preview: msg.sms.slice(0, 80),
            selected: msg.selected,
            delivered: msgDelivered,
            total_sent: msgDeliveries.length,
        };
    });

    // ── Recent replies for inbox view ────────────────────────────────────────
    const recentReplies = (replies ?? []).slice(0, 20).map((r) => ({
        intent: r.intent,
        summary: r.ai_summary,
        received_at: r.received_at,
        from_phone: r.from_phone.replace(/(\d{3})(\d{3})(\d{4})/, "***-***-$3"), // Mask middle digits
    }));

    return NextResponse.json(
        {
            campaign_id,
            contacts: contactStats,
            deliveries: {
                total: totalDeliveries,
                delivered: deliveredCount,
                failed: failedCount,
                delivery_rate_pct: deliveryRate,
                segments_billed: totalSegmentsBilled,
                by_status: deliveryStats,
            },
            replies: {
                total: totalReplies,
                reply_rate_pct: replyRate,
                by_intent: replyStats,
                recent: recentReplies,
            },
            variants: variantPerformance,
        },
        { headers: { "x-request-id": correlationId } }
    );
}
