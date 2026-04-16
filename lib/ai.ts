// lib/ai.ts
// Model-agnostic abstraction. Swap provider here — never in API routes.

import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export interface AIMessage {
  tone: string;
  sms: string;
  long_text: string;
  script: string;
  call_to_action: string;
}

export async function generateMessages(prompt: string): Promise<AIMessage[]> {
  const response = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.7,
    max_tokens: 2000,
  });

  const raw = response.choices[0].message.content ?? "[]";

  // Strip markdown code fences if the model wraps its JSON
  const cleaned = raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();

  let parsed: AIMessage[];
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error("AI returned invalid JSON. Raw: " + raw.slice(0, 200));
  }

  // ── CRITICAL FIX #1: Hard enforce SMS character limit ──────────────────
  // Never trust the LLM to count characters. Always enforce server-side.
  const enforced = parsed.map((msg) => ({
    ...msg,
    sms: msg.sms.length > 160 ? msg.sms.slice(0, 157) + "…" : msg.sms,
  }));

  // Warn if we had to truncate — log so you can improve the prompt
  enforced.forEach((msg, i) => {
    if (parsed[i].sms.length > 160) {
      console.warn(
        `[Constit] SMS variant ${i} was ${parsed[i].sms.length} chars — truncated to 160`
      );
    }
  });

  return enforced;
}
