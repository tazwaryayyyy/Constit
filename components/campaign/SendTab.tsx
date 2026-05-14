"use client";

import { useState } from "react";
import { Message } from "@/types";
import { getAuthHeaders } from "@/lib/clientAuth";

interface Props {
    campaignId: string;
    selectedMessage: Message | null;
    contactTotal: number;
    includeOptOut: boolean;
    onIncludeOptOutChange: (v: boolean) => void;
    onSendComplete: () => void;
    onActivityLog: (event: string, details?: string) => void;
}

export default function SendTab({
    campaignId,
    selectedMessage,
    contactTotal,
    includeOptOut,
    onIncludeOptOutChange,
    onSendComplete,
    onActivityLog,
}: Props) {
    const [sending, setSending] = useState(false);
    const [sendResult, setSendResult] = useState<{ queued: number; failed: number; total: number } | null>(null);
    const [sendError, setSendError] = useState("");
    const [sendConfirmed, setSendConfirmed] = useState(false);

    async function handleSend() {
        setSendError("");
        setSending(true);
        setSendResult(null);
        const res = await fetch("/api/send", {
            method: "POST",
            headers: await getAuthHeaders({ "Content-Type": "application/json" }),
            body: JSON.stringify({ campaign_id: campaignId, include_opt_out: includeOptOut }),
        });
        const data = await res.json();
        setSending(false);
        if (!res.ok) { setSendError(data.error ?? "Send failed"); return; }
        setSendResult({ queued: data.queued, failed: data.failed, total: data.total });
        setSendConfirmed(false);
        onActivityLog("SMS sent via Twilio", `${data.queued} queued, ${data.failed} failed`);
        onSendComplete();
    }

    return (
        <div className="space-y-6">
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-5">
                <h3 className="text-sm font-semibold text-blue-900 mb-1">Direct SMS via Twilio</h3>
                <p className="text-sm text-blue-800">
                    Send SMS directly to all pending contacts without leaving Constit. Delivery status is tracked in real-time and replies appear in the Inbox tab.
                </p>
            </div>

            {!selectedMessage ? (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
                    <p className="text-sm text-amber-800">Select a message variant in the <strong>Messages</strong> tab before sending.</p>
                </div>
            ) : (
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-5">
                    <p className="text-sm font-medium text-emerald-800 mb-1">Message to send ({selectedMessage.tone})</p>
                    <p className="text-sm text-emerald-700 font-mono">{selectedMessage.sms}</p>
                </div>
            )}

            <div className="border border-zinc-200 rounded-xl p-6 space-y-5">
                <div>
                    <p className="text-sm font-medium text-zinc-800">Send summary</p>
                    <p className="text-xs text-zinc-400 mt-0.5">{contactTotal.toLocaleString()} total contacts — pending contacts with phone numbers will receive the SMS</p>
                </div>

                <label className="flex items-start gap-3 cursor-pointer">
                    <input
                        type="checkbox"
                        checked={includeOptOut}
                        onChange={(e) => onIncludeOptOutChange(e.target.checked)}
                        className="mt-0.5 accent-zinc-900"
                    />
                    <div>
                        <p className="text-sm text-zinc-800">Append opt-out line</p>
                        <p className="text-xs text-zinc-400">Appends &quot;Reply STOP to opt out.&quot; — strongly recommended and required by TCPA.</p>
                    </div>
                </label>

                {!sendResult && (
                    <label className="flex items-start gap-3 cursor-pointer border border-amber-200 bg-amber-50 rounded-lg px-4 py-3">
                        <input
                            type="checkbox"
                            checked={sendConfirmed}
                            onChange={(e) => setSendConfirmed(e.target.checked)}
                            className="mt-0.5 accent-zinc-900"
                        />
                        <div>
                            <p className="text-sm font-medium text-amber-900">I confirm I have consent to text these contacts</p>
                            <p className="text-xs text-amber-700 mt-0.5">TCPA requires prior express written consent. Sending without consent may result in fines up to $1,500 per message.</p>
                        </div>
                    </label>
                )}

                {sendResult && (
                    <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
                        <p className="text-sm font-medium text-emerald-800 mb-3">Send complete</p>
                        <div className="grid grid-cols-3 gap-3">
                            {[
                                { label: "Total", value: sendResult.total, color: "text-emerald-900" },
                                { label: "Queued", value: sendResult.queued, color: "text-emerald-900" },
                                { label: "Failed", value: sendResult.failed, color: sendResult.failed > 0 ? "text-red-600" : "text-emerald-900" },
                            ].map(({ label, value, color }) => (
                                <div key={label} className="text-center">
                                    <p className={`text-xl font-medium ${color}`}>{value}</p>
                                    <p className="text-xs text-emerald-700">{label}</p>
                                </div>
                            ))}
                        </div>
                        <p className="text-xs text-emerald-600 mt-3">Delivery confirmations arrive via webhook. Check the Analytics tab for live stats.</p>
                    </div>
                )}

                {sendError && (
                    <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-2">{sendError}</p>
                )}

                <button
                    onClick={handleSend}
                    disabled={sending || !selectedMessage || !sendConfirmed}
                    className={`px-6 py-3 text-sm font-medium rounded-lg transition-colors ${selectedMessage && sendConfirmed ? "bg-blue-600 text-white hover:bg-blue-700" : "bg-zinc-100 text-zinc-400 cursor-not-allowed"}`}
                >
                    {sending ? "Sending…" : "Send SMS to pending contacts"}
                </button>

                <p className="text-xs text-zinc-400">Requires TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER environment variables.</p>
            </div>
        </div>
    );
}
