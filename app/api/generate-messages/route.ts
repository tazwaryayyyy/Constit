// app/api/generate-messages/route.ts
import { NextRequest, NextResponse } from "next/server";
import { generateMessages } from "@/lib/ai";
import { messagePrompt } from "@/lib/prompts";
import { analyzeSMS } from "@/lib/sms";
import { getRouteSupabaseAndUser } from "@/lib/supabaseRouteAuth";

// In-memory rate limiter: per-user, max 10 calls per 60 seconds
// In production, replace with Redis (Upstash) for multi-instance correctness.
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60_000;

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(userId);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(userId, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT) return false;
  entry.count++;
  return true;
}

export async function POST(req: NextRequest) {
  const correlationId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  const { user, db } = await getRouteSupabaseAndUser(req);

  if (!user || !db) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // -- Rate limit: prevent Groq API abuse ----------------------------------
  if (!checkRateLimit(user.id)) {
    console.warn(`[generate-messages] [${correlationId}] Rate limit hit for user ${user.id}`);
    return NextResponse.json(
      { error: "Too many requests. Wait 60 seconds before generating again." },
      { status: 429, headers: { "Retry-After": "60", "x-request-id": correlationId } }
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
    console.warn(`[generate-messages] [${correlationId}] campaign ${campaign_id} not found for user ${user.id}`);
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

  // Filter out messages that exceed the single-segment limit - do NOT silently truncate.
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
      `[generate-messages] [${correlationId}] ${overLimit.length} message(s) exceeded SMS limit. ` +
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
  }));

  const { data, error } = await db
    .from("messages")
    .insert(toInsert)
    .select();

  if (error) {
    console.error(`[generate-messages] [${correlationId}] DB insert error:`, error.message);
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
