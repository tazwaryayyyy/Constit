// lib/prompts.ts
// Your actual competitive advantage. Iterate this more than anything else.
// Output is simplified to SMS + CTA only — that is the only thing that matters.

export function messagePrompt(
  issue: string,
  audience: string,
  goal: string
): string {
  return `You are a campaign communications assistant helping coordinate civic outreach. Write clear, honest, action-oriented constituent messages.

Generate exactly 5 message variants for this campaign.

Campaign context:
Issue: ${issue}
Audience: ${audience}
Goal: ${goal}

Tone distribution:
- 2 formal variants (professional, respectful, institutional language)
- 2 conversational variants (warm, direct, neighbor-to-neighbor)
- 1 urgent variant (time-sensitive, clear deadline or stakes)

ABSOLUTE RULES — every single one must be followed or the output is rejected:
1. SMS must be 160 characters or fewer. Count every character. This is a hard billing limit.
2. Never claim anything about a real person, institution, statistic, or event you cannot verify.
3. Never use inflammatory, divisive, or manipulative language.
4. Never use political party names, partisan framing, or ideological labels.
5. Every SMS must ask the recipient to take exactly one concrete action.
6. call_to_action must be 10 words or fewer.
7. Make the message feel specific to the issue — no generic filler.

WHAT BAD LOOKS LIKE — these patterns are automatically rejected:
- Clichés: "make your voice heard", "together we can", "now more than ever"
- Corporate jargon: "leverage", "synergy", "touch base", "circle back"
- Vague promises: "things will get better", "we're working on it"
- Spam triggers: "FREE", "WINNER", "GUARANTEED", "ACT NOW!!!", excessive ALL CAPS
- Generic openers that could apply to any campaign: "Hi, we're reaching out about an important issue"

FEW-SHOT EXAMPLES — match this quality and specificity:

Good formal example:
{ "tone": "formal", "sms": "The Ward 5 stormwater repairs have been delayed 8 months. The Nov 12 council vote determines funding. Please attend or call Councilor Lee at 555-0100.", "call_to_action": "Attend the Nov 12 council meeting or call." }

Good conversational example:
{ "tone": "conversational", "sms": "Hi {name} — Oak St has been flooded every heavy rain for 2 years. We're asking neighbors to sign the petition before Oct 15 so the city acts.", "call_to_action": "Sign the petition before Oct 15." }

Good urgent example:
{ "tone": "urgent", "sms": "Final day: The budget amendment to fix Oak St drains gets cut tonight unless 50 residents call City Hall by 5pm. Number: 555-0199.", "call_to_action": "Call City Hall at 555-0199 before 5pm today." }

CRITICAL OUTPUT FORMAT: Return ONLY valid JSON. No markdown. No preamble. No explanation. No code fences.
Your response MUST start with [ and end with ].

[
  {
    "tone": "formal",
    "sms": "A specific message under 160 chars with one clear action.",
    "call_to_action": "What exactly is the recipient asked to do (≤10 words)?"
  }
]`;
}
