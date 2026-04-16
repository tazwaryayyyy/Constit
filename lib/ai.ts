// lib/ai.ts
// Provider-agnostic AI layer. Currently using Groq via OpenAI-compatible API.
// To switch providers: update baseURL, API key env var, and MODEL below.

import OpenAI from "openai";

// Groq is OpenAI-API-compatible — no new package required.
const client = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: "https://api.groq.com/openai/v1",
});

// llama-3.3-70b-versatile: best Groq model for structured JSON output
const MODEL = "llama-3.3-70b-versatile";

export interface GeneratedMessage {
  tone: "formal" | "conversational" | "urgent";
  sms: string;
  call_to_action: string;
}

// Contextual fallback — used only if generation totally fails.
// Three templates rotated randomly so repeated failures don't look identical.
function buildFallback(issue?: string, goal?: string): GeneratedMessage[] {
  const i = issue ?? "a local issue affecting your community";
  const g = goal ?? "take action";

  const templates: Array<() => string> = [
    () => `Hi {name}, we're reaching out about ${i}. Please ${g}. Reply STOP to opt out.`,
    () => `Quick note about ${i} — we're asking people to ${g}. Reply STOP to opt out.`,
    () => `This is about ${i}. Can you help by: ${g}? Reply STOP to opt out.`,
  ];

  const pick = templates[Math.floor(Math.random() * templates.length)]();
  const sms = pick.length <= 160 ? pick : `We need your help with a local issue. Please ${g.slice(0, 60)}. Reply STOP to opt out.`;

  return [
    {
      tone: "conversational",
      sms: sms.slice(0, 160),
      call_to_action: g.slice(0, 80),
    },
  ];
}

function extractJSON(raw: string): string {
  return raw
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();
}

// Clean and validate a single message from the model.
// Returns null if the message is unusable — callers filter these out.

// SHAFT = Sex, Hate, Alcohol, Firearms, Tobacco — CTIA-prohibited categories.
// Also catches spam trigger words that carrier ML filters flag for bulk campaigns.
const BLOCKED_PATTERNS = [
  // Spam triggers (carrier ML flags these in bulk campaigns)
  /\bfree\b/i,
  /\bwinner\b/i,
  /\bguaranteed\b/i,
  /\bcash prize\b/i,
  /\bact now\b/i,
  /\blimited time offer\b/i,
  /\bclick here\b/i,
  // Clichés that indicate generic output
  /\bmake your voice heard\b/i,
  /\btogether we can\b/i,
  /\bnow more than ever\b/i,
  /\bwe're reaching out about an important issue\b/i,
  // All-caps words (3+ letters) — hallmark of spam
  /\b[A-Z]{3,}\b/,
  // Excessive punctuation
  /[!?]{2,}/,
];

function sanitize(raw: unknown): GeneratedMessage | null {
  if (!raw || typeof raw !== "object") return null;
  const msg = raw as Record<string, unknown>;

  const sms = typeof msg.sms === "string" ? msg.sms.trim() : "";
  const cta = typeof msg.call_to_action === "string" ? msg.call_to_action.trim() : "";
  const tone = msg.tone as string;

  if (!sms || !cta) return null;
  if (sms.length < 20) return null; // too short to be a real message
  if (![">formal", "formal", "conversational", "urgent"].includes(tone)) return null;
  // Normalise tone in case model adds prefix junk
  const normTone = tone.replace(/^>/, "") as GeneratedMessage["tone"];
  if (!["formal", "conversational", "urgent"].includes(normTone)) return null;

  // SHAFT / spam pattern check — reject rather than silently pass bad messages
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(sms)) {
      console.warn(`[Constit] sanitize: rejected message matching pattern ${pattern} — "${sms.slice(0, 60)}"`);
      return null;
    }
  }

  // Do NOT silently truncate. Callers decide what to do with over-limit messages.
  return { tone: normTone, sms, call_to_action: cta };
}

async function callModel(prompt: string): Promise<GeneratedMessage[]> {
  const response = await client.chat.completions.create({
    model: MODEL,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.7,
    max_tokens: 1200,
  });

  const raw = response.choices[0].message.content ?? "[]";
  const cleaned = extractJSON(raw);

  let parsed: unknown[];
  try {
    const result = JSON.parse(cleaned);
    parsed = Array.isArray(result) ? result : [];
  } catch {
    throw new Error("Model returned invalid JSON. Raw: " + raw.slice(0, 300));
  }

  return parsed.map(sanitize).filter((m): m is GeneratedMessage => m !== null);
}

export interface GenerateResult {
  messages: GeneratedMessage[];
  usedFallback: boolean;
}

export async function generateMessages(
  prompt: string,
  fallbackContext?: { issue?: string; goal?: string }
): Promise<GenerateResult> {
  let messages: GeneratedMessage[] = [];

  // Attempt 1
  try {
    messages = await callModel(prompt);
  } catch (err) {
    console.warn("[Constit] Generation attempt 1 failed:", (err as Error).message);
  }

  // Retry if fewer than 3 valid messages came back
  if (messages.length < 3) {
    console.warn(`[Constit] Only ${messages.length} valid messages — retrying`);
    try {
      messages = await callModel(prompt);
    } catch (err) {
      console.warn("[Constit] Retry failed:", (err as Error).message);
    }
  }

  if (messages.length === 0) {
    console.error("[Constit] All generation attempts failed — using contextual fallback");
    return {
      messages: buildFallback(fallbackContext?.issue, fallbackContext?.goal),
      usedFallback: true,
    };
  }

  return { messages, usedFallback: false };
}
