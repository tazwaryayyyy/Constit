// app/api/messages/select/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";

export async function POST(req: NextRequest) {
  const { message_id, campaign_id } = await req.json();

  if (!message_id || !campaign_id) {
    return NextResponse.json(
      { error: "message_id and campaign_id are required" },
      { status: 400 }
    );
  }

  // Deselect all other variants for this campaign
  await supabase
    .from("messages")
    .update({ selected: false })
    .eq("campaign_id", campaign_id);

  // Select the chosen one
  const { error } = await supabase
    .from("messages")
    .update({ selected: true })
    .eq("id", message_id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
