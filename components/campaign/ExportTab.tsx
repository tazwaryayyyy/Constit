"use client";

import { useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabaseClient";
import { Contact, Message } from "@/types";
import { renderMessage } from "@/lib/sms";
import { getAuthHeaders } from "@/lib/clientAuth";

interface Props {
    campaignId: string;
    selectedMessage: Message | null;
    includeOptOut: boolean;
    onIncludeOptOutChange: (v: boolean) => void;
    onActivityLog: (event: string, details?: string) => void;
}

export default function ExportTab({ campaignId, selectedMessage, includeOptOut, onIncludeOptOutChange, onActivityLog }: Props) {
    const [pendingContacts, setPendingContacts] = useState<Contact[]>([]);
    const [exportConfirmed, setExportConfirmed] = useState(false);
    const [exporting, setExporting] = useState(false);
    const [exportError, setExportError] = useState("");
    const [simName, setSimName] = useState("");
    const [simCopied, setSimCopied] = useState(false);

    useEffect(() => {
        async function fetchPending() {
            const supabase = getSupabaseClient();
            const { data } = await supabase
                .from("contacts")
                .select("*")
                .eq("campaign_id", campaignId)
                .eq("status", "pending")
                .limit(100);
            setPendingContacts(data ?? []);
        }
        fetchPending();
    }, [campaignId]);

    const renderedAll = selectedMessage
        ? pendingContacts.map((c) => renderMessage({ name: c.name }, selectedMessage.sms, { optOut: includeOptOut }))
        : [];

    const segmentCounts = renderedAll.map((r) => r.analysis.segments);
    const uniqueSegments = Array.from(new Set(segmentCounts));
    const hasSegmentVariance = uniqueSegments.length > 1;
    const maxSegments = segmentCounts.length > 0 ? Math.max(...segmentCounts) : 0;
    const twoSegCount = segmentCounts.filter((s) => s > 1).length;
    const optOutAddsSegmentForAny = renderedAll.some((r) => r.optOutAddsSegment);

    const firstContact = pendingContacts[0];
    const firstRendered = selectedMessage && firstContact
        ? renderMessage({ name: firstContact.name }, selectedMessage.sms, { optOut: includeOptOut })
        : null;
    const finalAnalysis = firstRendered?.analysis ?? null;

    const isReady = !!selectedMessage && !optOutAddsSegmentForAny && !hasSegmentVariance && pendingContacts.length > 0;
    const hasWarning = !!selectedMessage && (maxSegments > 1 || optOutAddsSegmentForAny || hasSegmentVariance);

    const simRendered = selectedMessage && simName.trim()
        ? renderMessage({ name: simName.trim() }, selectedMessage.sms, { optOut: includeOptOut })
        : null;

    async function copySimText() {
        if (!simRendered) return;
        await navigator.clipboard.writeText(simRendered.text);
        setSimCopied(true);
        setTimeout(() => setSimCopied(false), 2000);
    }

    async function handleExport() {
        setExportError("");
        setExporting(true);
        const url = `/api/contacts/export/${campaignId}${includeOptOut ? "?opt_out=true" : ""}`;
        const res = await fetch(url, { method: "GET", headers: await getAuthHeaders() });

        if (!res.ok) {
            let message = "Failed to export CSV.";
            try {
                const err = await res.json();
                if (err?.error) message = err.error;
            } catch { /* keep default */ }
            setExportError(message);
            setExporting(false);
            return;
        }

        const blob = await res.blob();
        const downloadUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = downloadUrl;
        a.download = `constit-export-${campaignId}.csv`;
        a.click();
        URL.revokeObjectURL(downloadUrl);
        setExporting(false);
        onActivityLog("Exported CSV", `${pendingContacts.length} contacts`);
    }

    return (
        <div className="space-y-6">
            {/* Send readiness bar */}
            <div className={`rounded-xl border px-5 py-4 flex items-center gap-4 ${!selectedMessage
                ? "bg-zinc-50 border-zinc-200"
                : hasWarning
                    ? "bg-amber-50 border-amber-200"
                    : "bg-emerald-50 border-emerald-200"
                }`}>
                <span className={`text-lg ${!selectedMessage ? "text-zinc-400" : hasWarning ? "text-amber-500" : "text-emerald-600"}`}>
                    {!selectedMessage ? "○" : hasWarning ? "⚠" : "✓"}
                </span>
                <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                        <span className="text-sm text-zinc-700">
                            <strong>{pendingContacts.length}</strong> contacts ready to export
                        </span>
                        {finalAnalysis && (
                            <span className={`text-sm ${maxSegments > 1 ? "text-amber-700 font-medium" : "text-zinc-700"}`}>
                                <strong>{maxSegments}</strong> SMS segment{maxSegments !== 1 ? "s" : ""} worst-case
                            </span>
                        )}
                        {finalAnalysis && (
                            <span className="text-sm text-zinc-500">{finalAnalysis.encoding} encoding</span>
                        )}
                    </div>
                    {!selectedMessage && <p className="text-xs text-zinc-400 mt-0.5">Select a message variant first.</p>}
                    {hasWarning && <p className="text-xs text-amber-700 mt-0.5">Review warnings below before exporting.</p>}
                    {isReady && <p className="text-xs text-emerald-600 mt-0.5">Ready — CSV compatible with Twilio, Textedly, and other SMS tools.</p>}
                </div>
            </div>

            {optOutAddsSegmentForAny && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-4">
                    <p className="text-sm font-medium text-amber-800 mb-1">⚠ Opt-out suffix adds a segment for some contacts</p>
                    <p className="text-sm text-amber-700">
                        The opt-out line will be appended for all contacts (compliance), but for some contacts it pushes the
                        message into <strong>2 SMS segments</strong>. Shorten your template message to eliminate this, or proceed
                        knowing these contacts will cost 2× per SMS.
                    </p>
                </div>
            )}

            {hasSegmentVariance && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-4">
                    <p className="text-sm font-medium text-amber-800 mb-1">⚠ Segment count varies across contacts</p>
                    <p className="text-sm text-amber-700">
                        <strong>{twoSegCount}</strong> of {pendingContacts.length} contacts will receive{" "}
                        <strong>2 SMS segments</strong> due to name length or Unicode characters.
                        Worst case: <strong>{maxSegments} SMS per contact</strong>.
                        Consider removing {"{name}"} from your template if cost consistency matters.
                    </p>
                </div>
            )}

            {selectedMessage ? (
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-5">
                    <p className="text-sm font-medium text-emerald-800 mb-1">Selected message ({selectedMessage.tone})</p>
                    <p className="text-sm text-emerald-700 font-mono">{selectedMessage.sms}</p>
                    <p className="text-xs text-emerald-600 mt-2">{selectedMessage.sms.length} raw template characters</p>
                </div>
            ) : (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
                    <p className="text-sm text-amber-800">No message selected. Go to the Messages tab and choose a variant first.</p>
                </div>
            )}

            {selectedMessage && firstContact && firstRendered && (
                <div className="border border-zinc-200 rounded-xl p-5">
                    <h3 className="text-sm font-medium text-zinc-800 mb-3">Live preview</h3>
                    <p className="text-xs text-zinc-400 mb-2">
                        What <strong>{firstContact.name || "(blank name)"}</strong> will receive
                        {!firstContact.name?.split(" ")[0]?.trim() && " — using \"there\" as fallback"}:
                    </p>
                    <p className="text-sm font-mono text-zinc-700 bg-zinc-50 rounded-lg px-3 py-2 break-words">
                        {firstRendered.text}
                    </p>
                    <div className="flex flex-wrap gap-3 mt-2">
                        <span className={`text-xs px-2 py-0.5 rounded border ${firstRendered.analysis.segments === 1
                            ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                            : "bg-amber-50 text-amber-700 border-amber-200"}`}>
                            {firstRendered.analysis.segments} segment{firstRendered.analysis.segments !== 1 ? "s" : ""}
                        </span>
                        <span className="text-xs px-2 py-0.5 rounded border bg-zinc-50 text-zinc-500 border-zinc-200">
                            {firstRendered.analysis.encoding}
                        </span>
                        <span className="text-xs text-zinc-400">
                            {firstRendered.analysis.encoding === "GSM"
                                ? firstRendered.analysis.gsmUnits
                                : firstRendered.analysis.charCount}/{firstRendered.analysis.maxSingleSegment} units
                        </span>
                    </div>
                    {firstRendered.optOutAddsSegment && (
                        <p className="text-xs text-amber-700 mt-2">
                            ⚠ Opt-out suffix pushed this contact into 2 segments. Shorten your template to fix.
                        </p>
                    )}
                </div>
            )}

            {selectedMessage && (
                <div className="border border-zinc-200 rounded-xl p-5">
                    <h3 className="text-sm font-medium text-zinc-800 mb-1">Simulate with any name</h3>
                    <p className="text-xs text-zinc-400 mb-3">
                        Enter any name to preview the exact SMS that recipient will receive — encoding, segments, and all.
                    </p>
                    <input
                        type="text"
                        placeholder="e.g. María José"
                        value={simName}
                        onChange={(e) => setSimName(e.target.value)}
                        className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-zinc-900 mb-3"
                    />
                    {simRendered ? (
                        <div>
                            <div className="relative">
                                <p className="text-sm font-mono text-zinc-700 bg-zinc-50 rounded-lg px-3 py-2 pr-20 break-words mb-2">
                                    {simRendered.text}
                                </p>
                                <button
                                    onClick={copySimText}
                                    className="absolute top-2 right-2 text-xs px-2 py-1 border border-zinc-200 bg-white rounded hover:bg-zinc-50 transition-colors"
                                >
                                    {simCopied ? "Copied!" : "Copy"}
                                </button>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                <span className={`text-xs px-2 py-0.5 rounded border ${simRendered.analysis.segments === 1
                                    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                    : "bg-amber-50 text-amber-700 border-amber-200"}`}>
                                    {simRendered.analysis.segments} segment{simRendered.analysis.segments !== 1 ? "s" : ""}
                                </span>
                                <span className="text-xs px-2 py-0.5 rounded border bg-zinc-50 text-zinc-500 border-zinc-200">
                                    {simRendered.analysis.encoding}
                                </span>
                                <span className="text-xs text-zinc-400">
                                    {simRendered.analysis.encoding === "GSM"
                                        ? simRendered.analysis.gsmUnits
                                        : simRendered.analysis.charCount} / {simRendered.analysis.maxSingleSegment} units
                                </span>
                                {simRendered.optOutAddsSegment && (
                                    <span className="text-xs text-amber-700">⚠ opt-out adds segment</span>
                                )}
                            </div>
                        </div>
                    ) : (
                        <p className="text-xs text-zinc-400">Enter a name above to see the rendered output.</p>
                    )}
                </div>
            )}

            <div className="border border-zinc-200 rounded-xl p-6 space-y-4">
                <h3 className="text-sm font-medium text-zinc-800">Export options</h3>

                <label className="flex items-start gap-3 cursor-pointer">
                    <input
                        type="checkbox"
                        checked={includeOptOut}
                        onChange={(e) => onIncludeOptOutChange(e.target.checked)}
                        className="mt-0.5 accent-zinc-900"
                    />
                    <div>
                        <p className="text-sm text-zinc-800">Append opt-out line</p>
                        <p className="text-xs text-zinc-400">
                            Always appends &quot;Reply STOP to opt out.&quot; to every contact&apos;s message.
                            Recommended for SMS compliance. May add a segment — check warnings above.
                        </p>
                    </div>
                </label>

                <div className="bg-zinc-50 border border-zinc-100 rounded-lg px-4 py-3">
                    <p className="text-xs text-zinc-500">
                        <strong className="text-zinc-700">Personalisation:</strong> Use{" "}
                        <code className="bg-zinc-200 px-1 rounded">{"{name}"}</code> in your message — replaced with each
                        contact&apos;s first name. Blank names fall back to &quot;there&quot;.
                    </p>
                </div>

                {selectedMessage && pendingContacts.length > 0 && (
                    <div className="bg-zinc-50 border border-zinc-100 rounded-lg px-4 py-3 space-y-1">
                        <p className="text-xs font-medium text-zinc-600">This export will contain:</p>
                        <ul className="text-xs text-zinc-500 space-y-0.5 list-disc list-inside">
                            <li><strong className="text-zinc-700">{pendingContacts.length}</strong> contacts (pending status)</li>
                            <li>
                                Worst-case:{" "}
                                <strong className={maxSegments > 1 ? "text-amber-700" : "text-zinc-700"}>
                                    {maxSegments} SMS segment{maxSegments !== 1 ? "s" : ""}
                                </strong>{" "}
                                · <strong className="text-zinc-700">{finalAnalysis?.encoding}</strong> encoding
                            </li>
                            {hasSegmentVariance && (
                                <li className="text-amber-600">{twoSegCount} contacts will get 2 segments (name variance)</li>
                            )}
                            <li>Columns: name, phone, email, tags, status, message_sms, sms_segments, sms_encoding</li>
                        </ul>
                        <p className="text-xs text-zinc-400 mt-2 pt-2 border-t border-zinc-200">
                            CSV is ready for upload to Twilio, Textedly, SimpleTexting, EZTexting, or any SMS platform.
                        </p>
                    </div>
                )}

                {hasWarning && (
                    <label className="flex items-start gap-3 cursor-pointer border border-amber-200 bg-amber-50 rounded-lg px-4 py-3">
                        <input
                            type="checkbox"
                            checked={exportConfirmed}
                            onChange={(e) => setExportConfirmed(e.target.checked)}
                            className="mt-0.5 accent-zinc-900"
                        />
                        <div>
                            <p className="text-sm font-medium text-amber-900">I&apos;ve reviewed the warnings above</p>
                            <p className="text-xs text-amber-700 mt-0.5">
                                {[
                                    maxSegments > 1 && `Up to ${maxSegments} segments per contact.`,
                                    optOutAddsSegmentForAny && "Opt-out suffix increases segment count for some contacts.",
                                    hasSegmentVariance && `${twoSegCount} contacts will receive 2 segments due to name length.`,
                                ].filter(Boolean).join(" ")}
                            </p>
                        </div>
                    </label>
                )}

                {exportError && (
                    <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-2">{exportError}</p>
                )}

                <button
                    onClick={handleExport}
                    disabled={exporting || !(selectedMessage && (!hasWarning || exportConfirmed))}
                    className={`inline-block px-5 py-2.5 text-sm rounded-lg transition-colors ${selectedMessage && (!hasWarning || exportConfirmed)
                        ? "bg-zinc-900 text-white hover:bg-zinc-700"
                        : "bg-zinc-100 text-zinc-400 cursor-not-allowed"
                        }`}
                >
                    {exporting ? "Downloading..." : `Download CSV (${pendingContacts.length} contacts)`}
                </button>
            </div>
        </div>
    );
}
