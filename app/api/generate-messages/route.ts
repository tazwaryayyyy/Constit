// app/api/generate-messages/route.ts
import { NextRequest, NextResponse } from "next/server";
import { generateMessages } from "@/lib/ai";
import { messagePrompt } from "@/lib/prompts";
import { analyzeSMS } from "@/lib/sms";
import { getRouteSupabaseAndUser } from "@/lib/supabaseRouteAuth";
import { aiRateLimit } from "@/lib/rateLimit";
import { logger } from "@/lib/logger";

export async function POST(req: NextRequest) {
  const correlationId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  const { user, db } = await getRouteSupabaseAndUser(req);

  if (!user || !db) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── FIX #2: Upstash Redis sliding-window rate limit ───────────────────────
  // Replaces the in-memory map that reset on every Vercel cold start.
  const { success, reset } = await aiRateLimit.limit(user.id);
  if (!success) {
    const retryAfter = Math.ceil((reset - Date.now()) / 1000);
    logger.warn({ correlationId, userId: user.id }, "generate-messages: rate limit exceeded");
    return NextResponse.json(
      { error: "Too many requests. Wait before generating again." },
      { status: 429, headers: { "Retry-After": String(retryAfter), "x-request-id": correlationId } }
    );
  }

  const body = await req.json();
  const { campaign_id, issue, audience, goal } = body;

  if (!campaign_id || !issue || !audience || !goal) {
    return NextResponse.json(
      { error: "campaign_id, issue, audience, and goal are all required" },
      { status: 400 }
    );
  }

  // -- Ownership check: campaign must belong to this user -----------------
  const { data: campaign, error: campError } = await db
    .from("campaigns")
    .select("id")
    .eq("id", campaign_id)
    .single();

  if (campError || !campaign) {
    logger.warn({ correlationId, campaignId: campaign_id, userId: user.id }, "generate-messages: campaign not found");
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  // Input length guards before sending to AI
  if (typeof issue !== "string" || issue.length > 500) {
    return NextResponse.json({ error: "issue must be under 500 characters" }, { status: 400 });
  }
  if (typeof audience !== "string" || audience.length > 500) {
    return NextResponse.json({ error: "audience must be under 500 characters" }, { status: 400 });
  }
  if (typeof goal !== "string" || goal.length > 500) {
    return NextResponse.json({ error: "goal must be under 500 characters" }, { status: 400 });
  }

  const prompt = messagePrompt(issue, audience, goal);
  const { messages, usedFallback } = await generateMessages(prompt, { issue, goal });

  // Filter out messages that exceed the single-segment limit.
  const withinLimit = messages.filter((msg) => !analyzeSMS(msg.sms).isOverSingleSegment);
  const overLimit = messages.filter((msg) => analyzeSMS(msg.sms).isOverSingleSegment);

  if (overLimit.length > 0) {
    logger.warn(
      { correlationId, overLimitCount: overLimit.length, tones: overLimit.map((m) => m.tone) },
      "generate-messages: messages filtered for exceeding SMS segment limit"
    );
  }

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
  }));

  const { data, error } = await db
    .from("messages")
    .insert(toInsert)
    .select();

  if (error) {
    logger.error({ err: error, correlationId, campaignId: campaign_id }, "generate-messages: DB insert failed");
    if (error.message.toLowerCase().includes("row-level security")) {
      return NextResponse.json({ error: "Unauthorized for this message operation." }, { status: 403 });
    }
    return NextResponse.json({ error: "Failed to save generated messages" }, { status: 500 });
  }

  return NextResponse.json(
    { messages: data, usedFallback, overLimitCount: overLimit.length },
    { headers: { "x-request-id": correlationId } }
  );
}
