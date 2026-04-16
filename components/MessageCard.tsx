"use client";
// components/MessageCard.tsx
// Message Safety Panel: encoding, segment count, cost estimate.
// Multi-segment messages are ALLOWED — but require an extra confirmation click.
// Inline editing before selection. {name} preview if template variable is used.

import { useState } from "react";
import { Message } from "@/types";
import { analyzeSMS } from "@/lib/sms";

interface Props {
  message: Message;
  onSelect: (id: string) => void;
  onUpdate: (id: string, sms: string) => void;
  onEdited?: (id: string, tone: string) => void; // called after a successful inline edit save
  sampleName?: string; // first contact's name — used for {name} preview
}

// ── Message Safety Panel ────────────────────────────────────────────────────
function SafetyPanel({ text }: { text: string }) {
  const a = analyzeSMS(text);

  const barColor = a.isMultiSegment
    ? "bg-red-500"
    : a.charCount > Math.floor(a.maxSingleSegment * 0.88)
      ? "bg-amber-400"
      : "bg-emerald-500";

  const fillPct = Math.min((a.gsmUnits / a.maxSingleSegment) * 100, 100);

  return (
    <div className="mt-3 space-y-2">
      {/* Progress bar */}
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1.5 bg-zinc-100 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${barColor}`}
            style={{ width: `${fillPct}%` }}
          />
        </div>
        <span className={`text-xs font-mono tabular-nums ${a.isOverSingleSegment ? "text-red-600 font-semibold" : "text-zinc-500"}`}>
          {a.encoding === "GSM" ? a.gsmUnits : a.charCount}/{a.maxSingleSegment}
        </span>
      </div>

      {/* Badges */}
      <div className="flex flex-wrap gap-1.5">
        <span className={`text-xs px-2 py-0.5 rounded border ${a.encoding === "GSM"
          ? "bg-zinc-50 text-zinc-500 border-zinc-200"
          : "bg-amber-50 text-amber-700 border-amber-200"
          }`}>
          {a.encoding}
        </span>

        <span className={`text-xs px-2 py-0.5 rounded border ${a.segments === 1
          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
          : "bg-red-50 text-red-700 border-red-200"
          }`}>
          {a.segments} SMS segment{a.segments > 1 ? "s" : ""}
        </span>

        {/* Cost note: segment count only, no dollar amounts — pricing varies by country/carrier */}
        {a.segments > 1 && (
          <span className="text-xs px-2 py-0.5 rounded border bg-red-50 text-red-700 border-red-200">
            cost varies by provider
          </span>
        )}
      </div>
    </div>
  );
}

const TONE_BADGE: Record<string, string> = {
  formal: "bg-blue-50 text-blue-700 border-blue-200",
  conversational: "bg-emerald-50 text-emerald-700 border-emerald-200",
  urgent: "bg-red-50 text-red-700 border-red-200",
};

export default function MessageCard({ message, onSelect, onUpdate, onEdited, sampleName }: Props) {
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(message.sms);
  const [saving, setSaving] = useState(false);
  const [selecting, setSelecting] = useState(false);
  // Multi-segment confirmation: first click shows warning, second click confirms.
  const [confirmMulti, setConfirmMulti] = useState(false);

  const toneBadge = TONE_BADGE[message.tone] ?? "bg-zinc-50 text-zinc-600 border-zinc-200";
  const liveText = editing ? editText : message.sms;
  const analysis = analyzeSMS(liveText);
  const isMultiSeg = analysis.isMultiSegment;

  // {name} preview: if the SMS contains {name}, show a personalised example.
  const hasNameVar = /\{name\}/i.test(liveText);
  const previewName = sampleName?.split(" ")[0] ?? "Alex";
  const previewText = hasNameVar ? liveText.replace(/\{name\}/gi, previewName) : null;

  async function handleSave() {
    if (!editText.trim() || editText === message.sms) {
      setEditing(false);
      return;
    }
    setSaving(true);
    const res = await fetch(`/api/messages/${message.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sms: editText.trim() }),
    });
    setSaving(false);
    if (res.ok) {
      onUpdate(message.id, editText.trim());
      onEdited?.(message.id, message.tone);
      setEditing(false);
      setConfirmMulti(false);
    }
  }

  function handleCancel() {
    setEditText(message.sms);
    setEditing(false);
    setConfirmMulti(false);
  }

  async function handleSelect() {
    setSelecting(true);
    await onSelect(message.id);
    setSelecting(false);
    setConfirmMulti(false);
  }

  function handleSelectClick() {
    if (isMultiSeg && !confirmMulti) {
      // First click: surface the cost warning, require a second deliberate click.
      setConfirmMulti(true);
      return;
    }
    handleSelect();
  }

  return (
    <div className={`border rounded-xl p-5 transition-all ${message.selected
      ? "border-zinc-900 bg-zinc-50 shadow-sm"
      : "border-zinc-200 bg-white hover:border-zinc-300"
      }`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <span className={`text-xs font-medium px-2.5 py-1 rounded-full border ${toneBadge}`}>
          {message.tone}
        </span>
        <div className="flex items-center gap-2">
          {message.selected && (
            <span className="text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full">
              Selected
            </span>
          )}
          {!editing && (
            <button
              onClick={() => { setEditText(message.sms); setEditing(true); setConfirmMulti(false); }}
              className="text-xs text-zinc-400 hover:text-zinc-700 underline underline-offset-2"
            >
              Edit
            </button>
          )}
        </div>
      </div>

      {/* SMS text — editable or read-only */}
      <div className="min-h-[72px]">
        {editing ? (
          <textarea
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            rows={3}
            className="w-full text-sm text-zinc-800 font-mono border border-zinc-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-zinc-900 resize-none bg-white"
          />
        ) : (
          <p className="text-sm text-zinc-800 leading-relaxed font-mono">{message.sms}</p>
        )}
      </div>

      {/* {name} variable preview */}
      {previewText && !editing && (
        <div className="mt-2 px-3 py-2 bg-zinc-50 border border-zinc-100 rounded-lg">
          <p className="text-xs text-zinc-400 mb-0.5">Preview with &quot;{previewName}&quot;:</p>
          <p className="text-xs text-zinc-600 font-mono">{previewText}</p>
        </div>
      )}

      {/* Message Safety Panel */}
      <SafetyPanel text={liveText} />

      {/* CTA */}
      {message.call_to_action && (
        <div className="mt-3 pt-3 border-t border-zinc-100">
          <span className="text-xs text-zinc-400">Call to action: </span>
          <span className="text-xs text-zinc-700 font-medium">{message.call_to_action}</span>
        </div>
      )}

      {/* Multi-segment confirmation banner */}
      {confirmMulti && !editing && (
        <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-xs text-red-800 font-medium mb-2">
            This message is <strong>{analysis.segments} SMS segments</strong>.
            Sending to many contacts multiplies your SMS cost. Confirm if intentional.
          </p>
          <div className="flex gap-2">
            <button
              onClick={handleSelect}
              disabled={selecting}
              className="px-3 py-1.5 text-xs bg-red-700 text-white rounded-lg hover:bg-red-800 disabled:opacity-50"
            >
              {selecting ? "Selecting…" : `Confirm — ${analysis.segments} SMS per contact`}
            </button>
            <button
              onClick={() => setConfirmMulti(false)}
              className="px-3 py-1.5 text-xs border border-red-300 text-red-700 rounded-lg hover:bg-red-100"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="mt-4 flex gap-2">
        {editing ? (
          <>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 py-2 text-sm bg-zinc-900 text-white rounded-lg hover:bg-zinc-700 disabled:opacity-50 transition-colors"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              onClick={handleCancel}
              className="px-4 py-2 text-sm border border-zinc-200 rounded-lg hover:bg-zinc-50"
            >
              Cancel
            </button>
          </>
        ) : message.selected ? (
          <p className="text-xs text-zinc-500 text-center w-full">This variant is selected for outreach</p>
        ) : confirmMulti ? null : (
          <button
            onClick={handleSelectClick}
            disabled={selecting}
            className={`w-full py-2 text-sm rounded-lg transition-colors disabled:opacity-50 ${isMultiSeg
              ? "border border-red-400 text-red-700 hover:bg-red-50"
              : "border border-zinc-900 text-zinc-900 hover:bg-zinc-900 hover:text-white"
              }`}
          >
            {isMultiSeg
              ? `Use this variant (${analysis.segments} SMS segments — cost varies)`
              : selecting
                ? "Selecting…"
                : "Use this variant"}
          </button>
        )}
      </div>
    </div>
  );
}


import { useState } from "react";
import { Message } from "@/types";
import { analyzeSMS } from "@/lib/sms";

interface Props {
  message: Message;
  onSelect: (id: string) => void;
  onUpdate: (id: string, sms: string) => void;
}

// ── Message Safety Panel ────────────────────────────────────────────────────
// Shows exactly what Twilio will charge for. No surprises.
function SafetyPanel({ text }: { text: string }) {
  const a = analyzeSMS(text);

  const barColor =
    a.isMultiSegment
      ? "bg-red-500"
      : a.charCount > Math.floor(a.maxSingleSegment * 0.88)
        ? "bg-amber-400"
        : "bg-emerald-500";

  const fillPct = Math.min(
    (a.gsmUnits / a.maxSingleSegment) * 100,
    100
  );

  return (
    <div className="mt-3 space-y-2">
      {/* Progress bar */}
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1.5 bg-zinc-100 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${barColor}`}
            style={{ width: `${fillPct}%` }}
          />
        </div>
        <span className={`text-xs font-mono tabular-nums ${a.isOverSingleSegment ? "text-red-600 font-semibold" : "text-zinc-500"}`}>
          {a.encoding === "GSM" ? a.gsmUnits : a.charCount}/{a.maxSingleSegment}
        </span>
      </div>

      {/* Badges */}
      <div className="flex flex-wrap gap-1.5">
        {/* Encoding */}
        <span className={`text-xs px-2 py-0.5 rounded border ${a.encoding === "GSM"
          ? "bg-zinc-50 text-zinc-500 border-zinc-200"
          : "bg-amber-50 text-amber-700 border-amber-200"
          }`}>
          {a.encoding}
        </span>

        {/* Segment count */}
        <span className={`text-xs px-2 py-0.5 rounded border font-medium ${a.segments === 1
          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
          : "bg-red-50 text-red-700 border-red-200"
          }`}>
          {a.segments} SMS segment{a.segments > 1 ? "s" : ""}
        </span>

        {/* Cost warning */}
        {a.costWarning && (
          <span className="text-xs px-2 py-0.5 rounded border bg-red-50 text-red-700 border-red-200">
            ⚠ {a.costWarning}
          </span>
        )}
      </div>
    </div>
  );
}

const TONE_BADGE: Record<string, string> = {
  formal: "bg-blue-50 text-blue-700 border-blue-200",
  conversational: "bg-emerald-50 text-emerald-700 border-emerald-200",
  urgent: "bg-red-50 text-red-700 border-red-200",
};

export default function MessageCard({ message, onSelect, onUpdate }: Props) {
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(message.sms);
  const [saving, setSaving] = useState(false);
  const [selecting, setSelecting] = useState(false);

  const toneBadge = TONE_BADGE[message.tone] ?? "bg-zinc-50 text-zinc-600 border-zinc-200";
  const liveText = editing ? editText : message.sms;
  const analysis = analyzeSMS(liveText);
  const isOverLimit = analysis.isOverSingleSegment;

  async function handleSave() {
    if (!editText.trim() || editText === message.sms) {
      setEditing(false);
      return;
    }
    setSaving(true);
    const res = await fetch(`/api/messages/${message.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sms: editText.trim() }),
    });
    setSaving(false);
    if (res.ok) {
      onUpdate(message.id, editText.trim());
      setEditing(false);
    }
  }

  function handleCancel() {
    setEditText(message.sms);
    setEditing(false);
  }

  async function handleSelect() {
    if (isOverLimit) return; // never select an over-limit message
    setSelecting(true);
    await onSelect(message.id);
    setSelecting(false);
  }

  return (
    <div className={`border rounded-xl p-5 transition-all ${message.selected
      ? "border-zinc-900 bg-zinc-50 shadow-sm"
      : "border-zinc-200 bg-white hover:border-zinc-300"
      }`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <span className={`text-xs font-medium px-2.5 py-1 rounded-full border ${toneBadge}`}>
          {message.tone}
        </span>
        <div className="flex items-center gap-2">
          {message.selected && (
            <span className="text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full">
              Selected
            </span>
          )}
          {!editing && (
            <button
              onClick={() => { setEditText(message.sms); setEditing(true); }}
              className="text-xs text-zinc-400 hover:text-zinc-700 underline underline-offset-2"
            >
              Edit
            </button>
          )}
        </div>
      </div>

      {/* SMS text — editable or read-only */}
      <div className="min-h-[72px]">
        {editing ? (
          <textarea
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            rows={3}
            className="w-full text-sm text-zinc-800 font-mono border border-zinc-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-zinc-900 resize-none bg-white"
          />
        ) : (
          <p className="text-sm text-zinc-800 leading-relaxed font-mono">{message.sms}</p>
        )}
      </div>

      {/* Message Safety Panel */}
      <SafetyPanel text={liveText} />

      {/* CTA */}
      {message.call_to_action && (
        <div className="mt-3 pt-3 border-t border-zinc-100">
          <span className="text-xs text-zinc-400">Call to action: </span>
          <span className="text-xs text-zinc-700 font-medium">{message.call_to_action}</span>
        </div>
      )}

      {/* Action buttons */}
      <div className="mt-4 flex gap-2">
        {editing ? (
          <>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 py-2 text-sm bg-zinc-900 text-white rounded-lg hover:bg-zinc-700 disabled:opacity-50 transition-colors"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              onClick={handleCancel}
              className="px-4 py-2 text-sm border border-zinc-200 rounded-lg hover:bg-zinc-50"
            >
              Cancel
            </button>
          </>
        ) : message.selected ? (
          <p className="text-xs text-zinc-500 text-center w-full">This variant is selected for outreach</p>
        ) : (
          <button
            onClick={handleSelect}
            disabled={selecting || isOverLimit}
            title={isOverLimit ? "Fix the message length before selecting" : undefined}
            className={`w-full py-2 text-sm rounded-lg transition-colors ${isOverLimit
              ? "bg-zinc-100 text-zinc-400 cursor-not-allowed"
              : "border border-zinc-900 text-zinc-900 hover:bg-zinc-900 hover:text-white disabled:opacity-50"
              }`}
          >
            {isOverLimit
              ? "Over limit — edit before selecting"
              : selecting
                ? "Selecting…"
                : "Use this variant"}
          </button>
        )}
      </div>
    </div>
  );
}


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
          className={`h-full rounded-full transition-all ${isOver ? "bg-red-500" : len > 140 ? "bg-amber-400" : "bg-emerald-500"
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
    <div className={`border rounded-xl p-5 transition-all ${message.selected
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
            className={`px-3 py-1 text-xs rounded-md transition-all ${tab === t ? "bg-white shadow-sm text-zinc-900 font-medium" : "text-zinc-500 hover:text-zinc-700"
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
