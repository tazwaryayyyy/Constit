"use client";
// components/MessageCard.tsx
// CRITICAL FIX #1: Live character counter with segment warning.
// Users see exactly what Twilio will charge them for.

import { useState } from "react";
import { Message } from "@/types";

const SMS_LIMIT = 160;
const DOUBLE_SEGMENT = 161; // Twilio charges for 2 segments above this

interface Props {
  message: Message;
  onSelect: (id: string) => void;
}

function CharCounter({ text }: { text: string }) {
  const len = text.length;
  const isOver = len > SMS_LIMIT;
  const isDoubleSegment = len >= DOUBLE_SEGMENT;

  return (
    <div className="flex items-center gap-2 mt-1">
      <div className="flex-1 h-1.5 bg-zinc-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${
            isOver ? "bg-red-500" : len > 140 ? "bg-amber-400" : "bg-emerald-500"
          }`}
          style={{ width: `${Math.min((len / SMS_LIMIT) * 100, 100)}%` }}
        />
      </div>
      <span className={`text-xs font-mono tabular-nums ${isOver ? "text-red-600" : "text-zinc-400"}`}>
        {len}/{SMS_LIMIT}
      </span>
      {isDoubleSegment && (
        <span className="text-xs bg-red-50 text-red-600 border border-red-200 rounded px-1.5 py-0.5">
          2 segments — double charge
        </span>
      )}
      {isOver && !isDoubleSegment && (
        <span className="text-xs bg-amber-50 text-amber-700 border border-amber-200 rounded px-1.5 py-0.5">
          over limit
        </span>
      )}
    </div>
  );
}

const TONE_BADGE: Record<string, string> = {
  formal: "bg-blue-50 text-blue-700 border-blue-200",
  conversational: "bg-emerald-50 text-emerald-700 border-emerald-200",
  urgent: "bg-red-50 text-red-700 border-red-200",
};

export default function MessageCard({ message, onSelect }: Props) {
  const [tab, setTab] = useState<"sms" | "long" | "script">("sms");
  const [selecting, setSelecting] = useState(false);

  const toneBadge = TONE_BADGE[message.tone] ?? "bg-zinc-50 text-zinc-600 border-zinc-200";

  async function handleSelect() {
    setSelecting(true);
    await onSelect(message.id);
    setSelecting(false);
  }

  return (
    <div className={`border rounded-xl p-5 transition-all ${
      message.selected
        ? "border-zinc-900 bg-zinc-50 shadow-sm"
        : "border-zinc-200 bg-white hover:border-zinc-300"
    }`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <span className={`text-xs font-medium px-2.5 py-1 rounded-full border ${toneBadge}`}>
          {message.tone}
        </span>
        {message.selected && (
          <span className="text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full">
            Selected
          </span>
        )}
      </div>

      {/* Tab switcher */}
      <div className="flex gap-1 mb-3 p-1 bg-zinc-100 rounded-lg w-fit">
        {(["sms", "long", "script"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-1 text-xs rounded-md transition-all ${
              tab === t ? "bg-white shadow-sm text-zinc-900 font-medium" : "text-zinc-500 hover:text-zinc-700"
            }`}
          >
            {t === "sms" ? "SMS" : t === "long" ? "Long form" : "Script"}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="min-h-[80px]">
        {tab === "sms" && (
          <div>
            <p className="text-sm text-zinc-800 leading-relaxed font-mono">{message.sms}</p>
            {/* CRITICAL: Live character counter */}
            <CharCounter text={message.sms} />
          </div>
        )}
        {tab === "long" && (
          <p className="text-sm text-zinc-700 leading-relaxed">{message.long_text}</p>
        )}
        {tab === "script" && (
          <p className="text-sm text-zinc-700 leading-relaxed italic">{message.script}</p>
        )}
      </div>

      {/* CTA */}
      {message.call_to_action && (
        <div className="mt-3 pt-3 border-t border-zinc-100">
          <span className="text-xs text-zinc-400">Call to action: </span>
          <span className="text-xs text-zinc-700 font-medium">{message.call_to_action}</span>
        </div>
      )}

      {/* Select button */}
      <div className="mt-4">
        {message.selected ? (
          <p className="text-xs text-zinc-500 text-center">This variant is selected for outreach</p>
        ) : (
          <button
            onClick={handleSelect}
            disabled={selecting}
            className="w-full py-2 text-sm border border-zinc-900 text-zinc-900 rounded-lg hover:bg-zinc-900 hover:text-white transition-colors disabled:opacity-50"
          >
            {selecting ? "Selecting…" : "Use this variant"}
          </button>
        )}
      </div>
    </div>
  );
}
