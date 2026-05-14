"use client";

import { useState } from "react";
import { Campaign, Message } from "@/types";
import MessageCard from "@/components/MessageCard";
import { getAuthHeaders } from "@/lib/clientAuth";

interface Props {
    campaignId: string;
    campaign: Campaign;
    messages: Message[];
    onMessagesChange: (msgs: Message[]) => void;
    onActivityLog: (event: string, details?: string) => void;
}

export default function MessageGenerator({ campaignId, campaign, messages, onMessagesChange, onActivityLog }: Props) {
    const [generating, setGenerating] = useState(false);
    const [genError, setGenError] = useState("");
    const [messageLocked, setMessageLocked] = useState(false);

    const selectedMessage = messages.find((m) => m.selected);

    async function handleGenerate() {
        setGenerating(true);
        setGenError("");
        const res = await fetch("/api/generate-messages", {
            method: "POST",
            headers: await getAuthHeaders({ "Content-Type": "application/json" }),
            body: JSON.stringify({
                campaign_id: campaignId,
                issue: campaign.issue,
                audience: campaign.audience,
                goal: campaign.goal,
            }),
        });
        const data = await res.json();
        setGenerating(false);
        if (!res.ok) { setGenError(data.error); return; }
        onMessagesChange([...messages, ...data.messages]);
        onActivityLog("Generated messages", `${data.messages.length} variants${data.usedFallback ? " (fallback)" : ""}`);
    }

    async function handleSelect(messageId: string) {
        await fetch("/api/messages/select", {
            method: "POST",
            headers: await getAuthHeaders({ "Content-Type": "application/json" }),
            body: JSON.stringify({ message_id: messageId, campaign_id: campaignId }),
        });
        onMessagesChange(messages.map((m) => ({ ...m, selected: m.id === messageId })));
    }

    function handleUpdate(messageId: string, sms: string) {
        onMessagesChange(messages.map((m) => (m.id === messageId ? { ...m, sms } : m)));
    }

    return (
        <div>
            <div className="flex items-center justify-between mb-6">
                <p className="text-sm text-zinc-500">
                    {messages.length === 0
                        ? "No messages yet. Generate 5 variants with one click."
                        : `${messages.length} variants · ${selectedMessage ? "1 selected" : "none selected"}`}
                </p>
                <div className="flex items-center gap-2">
                    {selectedMessage && (
                        <button
                            onClick={() => setMessageLocked((l) => !l)}
                            className={`text-sm px-3 py-2 rounded-lg border transition-colors ${messageLocked
                                ? "bg-zinc-900 text-white border-zinc-900 hover:bg-zinc-700"
                                : "border-zinc-200 text-zinc-600 hover:bg-zinc-50"}`}
                            title={messageLocked ? "Unlock to allow editing" : "Lock selected message before export"}
                        >
                            {messageLocked ? "🔒 Locked" : "Lock for export"}
                        </button>
                    )}
                    <button
                        onClick={handleGenerate}
                        disabled={generating || messageLocked}
                        className="px-4 py-2 bg-zinc-900 text-white text-sm rounded-lg hover:bg-zinc-700 disabled:opacity-50"
                    >
                        {generating ? "Generating…" : "Generate 5 variants"}
                    </button>
                </div>
            </div>

            {messageLocked && (
                <div className="mb-4 px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-lg">
                    <p className="text-sm text-zinc-600">
                        Message locked. Go to the <strong>Export</strong> tab to download your CSV.{" "}
                        <button onClick={() => setMessageLocked(false)} className="text-zinc-900 underline underline-offset-2">
                            Unlock to edit
                        </button>
                    </p>
                </div>
            )}

            {genError && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-2 mb-4">
                    {genError}
                </p>
            )}

            <div className="grid grid-cols-1 gap-4">
                {messages.map((m) => (
                    <MessageCard
                        key={m.id}
                        message={m}
                        onSelect={handleSelect}
                        onUpdate={handleUpdate}
                        onEdited={(_, tone) => onActivityLog("Edited message", `tone: ${tone}`)}
                        locked={messageLocked}
                    />
                ))}
            </div>
        </div>
    );
}
