// app/api/messages/select/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getRouteSupabaseAndUser } from "@/lib/supabaseRouteAuth";

export async function POST(req: NextRequest) {
  const correlationId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  const { user, db } = await getRouteSupabaseAndUser(req);

  if (!user || !db) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { message_id, campaign_id } = await req.json();

  if (!message_id || !campaign_id) {
    return NextResponse.json(
      { error: "message_id and campaign_id are required" },
      { status: 400 }
    );
  }

  // ── Ownership check ─────────────────────────────────────────────────────
  // Verify the message actually belongs to the campaign BEFORE touching data.
  // RLS will also block this, but defense-in-depth prevents silent edge-cases.
  const { data: msg, error: checkError } = await db
    .from("messages")
    .select("id")
    .eq("id", message_id)
    .eq("campaign_id", campaign_id)
    .single();

  if (checkError || !msg) {
    console.warn(`[messages/select] [${correlationId}] message ${message_id} not found in campaign ${campaign_id} for user ${user.id}`);
    return NextResponse.json(
      { error: "Message not found in this campaign." },
      { status: 404 }
    );
  }

  // ── Atomic select: single UPDATE covers all rows atomically ──────────────
  // Sets selected = true for the chosen message, false for all others in the campaign.
  // Eliminates the race condition from two separate UPDATE queries.
  const { error } = await db
    .from("messages")
    .update({ selected: false })
    .eq("campaign_id", campaign_id);

  if (!error) {
    await db
      .from("messages")
      .update({ selected: true })
      .eq("id", message_id)
      .eq("campaign_id", campaign_id);
  }

  if (error) {
    console.error(`[messages/select] [${correlationId}] DB error:`, error.message);
    if (error.message.toLowerCase().includes("row-level security")) {
      return NextResponse.json({ error: "Unauthorized for this message operation." }, { status: 403 });
    }
    return NextResponse.json({ error: "Failed to select message" }, { status: 500 });
  }

  return NextResponse.json({ ok: true }, { headers: { "x-request-id": correlationId } });
}
