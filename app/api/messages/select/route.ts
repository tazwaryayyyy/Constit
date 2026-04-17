// app/api/messages/select/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getRouteSupabaseAndUser } from "@/lib/supabaseRouteAuth";

export async function POST(req: NextRequest) {
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

  // Deselect all other variants for this campaign
  await db
    .from("messages")
    .update({ selected: false })
    .eq("campaign_id", campaign_id);

  // Select the chosen one
  const { error } = await db
    .from("messages")
    .update({ selected: true })
    .eq("id", message_id);

  if (error) {
    if (error.message.toLowerCase().includes("row-level security")) {
      return NextResponse.json({ error: "Unauthorized for this message operation." }, { status: 403 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
