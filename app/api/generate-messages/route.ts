// app/api/generate-messages/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { generateMessages } from "@/lib/ai";
import { messagePrompt } from "@/lib/prompts";
import { analyzeSMS } from "@/lib/sms";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { campaign_id, issue, audience, goal } = body;

  if (!campaign_id || !issue || !audience || !goal) {
    return NextResponse.json(
      { error: "campaign_id, issue, audience, and goal are all required" },
      { status: 400 }
    );
  }

  const prompt = messagePrompt(issue, audience, goal);
  const { messages, usedFallback } = await generateMessages(prompt, { issue, goal });

  // Filter out messages that exceed the single-segment limit — do NOT silently truncate.
  // Users must see the real text or edit it; truncation hides bugs and destroys meaning.
  const withinLimit = messages.filter((msg) => {
    const analysis = analyzeSMS(msg.sms);
    return !analysis.isOverSingleSegment;
  });

  const overLimit = messages.filter((msg) => {
    const analysis = analyzeSMS(msg.sms);
    return analysis.isOverSingleSegment;
  });

  if (overLimit.length > 0) {
    console.warn(
      `[Constit] ${overLimit.length} message(s) exceeded SMS limit and were excluded from insert. ` +
      `Tones: ${overLimit.map((m) => m.tone).join(", ")}`
    );
  }

  // If no valid messages survived filtering, surface a clear error.
  if (withinLimit.length === 0 && !usedFallback) {
    return NextResponse.json(
      {
        error: "All generated messages exceeded the 160-character SMS limit. Try simplifying your campaign goal or audience description.",
        overLimitCount: overLimit.length,
      },
      { status: 422 }
    );
  }

  const toInsert = (withinLimit.length > 0 ? withinLimit : messages).map((msg) => ({
    campaign_id,
    tone: msg.tone,
    sms: msg.sms,
    call_to_action: msg.call_to_action,
    selected: false,
    performance_score: null,
  }));

  const { data, error } = await supabase
    .from("messages")
    .insert(toInsert)
    .select();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    messages: data,
    usedFallback,
    overLimitCount: overLimit.length,
  });
}

