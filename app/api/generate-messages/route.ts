// app/api/generate-messages/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { generateMessages } from "@/lib/ai";
import { messagePrompt } from "@/lib/prompts";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { campaign_id, issue, audience, goal } = body;

  if (!campaign_id || !issue || !audience || !goal) {
    return NextResponse.json(
      { error: "campaign_id, issue, audience, goal are all required" },
      { status: 400 }
    );
  }

  let messages;
  try {
    const prompt = messagePrompt(issue, audience, goal);
    messages = await generateMessages(prompt);
  } catch (err) {
    return NextResponse.json(
      { error: "AI generation failed: " + (err as Error).message },
      { status: 500 }
    );
  }

  // ── Hard SMS validation before touching the database ──────────────────────
  // This runs even though lib/ai.ts already truncates, as a belt-and-suspenders check.
  const validated = messages.map((msg) => {
    if (msg.sms.length > 160) {
      console.error(`[Constit] SMS still over 160 after ai.ts truncation — this is a bug`);
      msg.sms = msg.sms.slice(0, 157) + "…";
    }
    return msg;
  });

  // Insert all variants
  const to_insert = validated.map((msg) => ({
    campaign_id,
    tone: msg.tone,
    sms: msg.sms,
    long_text: msg.long_text,
    script: msg.script,
    call_to_action: msg.call_to_action,
    selected: false,
    performance_score: null,
  }));

  const { data, error } = await supabase
    .from("messages")
    .insert(to_insert)
    .select();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ messages: data });
}
