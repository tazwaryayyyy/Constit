"use client";
// app/campaign/[id]/page.tsx — the core product experience

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { getSupabaseClient } from "@/lib/supabaseClient";
import { Campaign, Contact, Message, ActivityLog, CampaignAnalytics, Reply } from "@/types";
import { renderMessage } from "@/lib/sms";
import CSVImporter from "@/components/CSVImporter";
import MessageCard from "@/components/MessageCard";
import { getAuthHeaders } from "@/lib/clientAuth";

type Tab = "contacts" | "messages" | "export" | "send" | "analytics" | "inbox";

const CONTACTS_PER_PAGE = 50;

export default function CampaignPage() {
  const { id } = useParams<{ id: string }>();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactPage, setContactPage] = useState(1);
  const [contactTotal, setContactTotal] = useState(0);
  const [messages, setMessages] = useState<Message[]>([]);
  const [tab, setTab] = useState<Tab>("contacts");
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState("");
  const [showImporter, setShowImporter] = useState(false);
  const [activityLog, setActivityLog] = useState<ActivityLog[]>([]);
  const [includeOptOut, setIncludeOptOut] = useState(false);
  const [simName, setSimName] = useState("");
  const [simCopied, setSimCopied] = useState(false);
  const [messageLocked, setMessageLocked] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [exportConfirmed, setExportConfirmed] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");

  // Send state
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ queued: number; failed: number; total: number } | null>(null);
  const [sendError, setSendError] = useState("");
  const [sendConfirmed, setSendConfirmed] = useState(false);

  // Analytics state
  const [analytics, setAnalytics] = useState<CampaignAnalytics | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);

  // Inbox state
  const [replies, setReplies] = useState<Reply[]>([]);
  const [replyFilter, setReplyFilter] = useState<string>("all");
  const [replyPage, setReplyPage] = useState(1);
  const [replyTotal, setReplyTotal] = useState(0);
  const [inboxLoading, setInboxLoading] = useState(false);

  const loadContacts = useCallback(async (page: number) => {
    const supabase = getSupabaseClient();
    const from = (page - 1) * CONTACTS_PER_PAGE;
    const to = from + CONTACTS_PER_PAGE - 1;
    const { data, count } = await supabase
      .from("contacts")
      .select("*", { count: "exact" })
      .eq("campaign_id", id)
      .order("created_at")
      .range(from, to);
    setContacts(data ?? []);
    setContactTotal(count ?? 0);
  }, [id]);

  useEffect(() => {
    loadInitial();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    loadContacts(contactPage);
  }, [contactPage, loadContacts]);

  useEffect(() => {
    if (tab === "analytics" && !analytics) loadAnalytics();
    if (tab === "inbox") loadReplies(replyPage, replyFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  async function loadInitial() {
    const supabase = getSupabaseClient();
    const [{ data: camp }, { data: msgs }, { data: logs }] = await Promise.all([
      supabase.from("campaigns").select("*").eq("id", id).single(),
      supabase.from("messages").select("*").eq("campaign_id", id).order("created_at"),
      supabase.from("activity_log").select("*").eq("campaign_id", id).order("created_at", { ascending: false }).limit(20),
    ]);
    setCampaign(camp);
    setMessages(msgs ?? []);
    setActivityLog(logs ?? []);
    loadContacts(1);
  }

  async function loadAnalytics() {
    setAnalyticsLoading(true);
    const res = await fetch(`/api/analytics/${id}`, { headers: await getAuthHeaders() });
    if (res.ok) setAnalytics(await res.json() as CampaignAnalytics);
    setAnalyticsLoading(false);
  }

  async function loadReplies(page: number, intent: string) {
    setInboxLoading(true);
    const params = new URLSearchParams({ campaign_id: id, page: String(page) });
    if (intent !== "all") params.set("intent", intent);
    const res = await fetch(`/api/replies?${params}`, { headers: await getAuthHeaders() });
    if (res.ok) {
      const data = await res.json() as { replies: Reply[]; total: number };
      setReplies(data.replies);
      setReplyTotal(data.total);
    }
    setInboxLoading(false);
  }

  async function logActivity(event: string, details?: string) {
    const supabase = getSupabaseClient();
    await supabase.from("activity_log").insert({ campaign_id: id, event, details: details ?? null });
    setActivityLog((prev) => [
      { id: crypto.randomUUID(), campaign_id: id, event, details: details ?? null, created_at: new Date().toISOString() },
      ...prev,
    ].slice(0, 20));
  }

  async function handleGenerate() {
    if (!campaign) return;
    setGenerating(true);
    setGenError("");

    const res = await fetch("/api/generate-messages", {
      method: "POST",
      headers: await getAuthHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        campaign_id: id,
        issue: campaign.issue,
        audience: campaign.audience,
        goal: campaign.goal,
      }),
    });

    const data = await res.json();
    setGenerating(false);

    if (!res.ok) {
      setGenError(data.error);
      return;
    }

    setMessages((m) => [...m, ...data.messages]);
    setTab("messages");
    logActivity("Generated messages", `${data.messages.length} variants${data.usedFallback ? " (fallback)" : ""}`);
  }

  async function handleSelect(messageId: string) {
    await fetch("/api/messages/select", {
      method: "POST",
      headers: await getAuthHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ message_id: messageId, campaign_id: id }),
    });
    setMessages((msgs) =>
      msgs.map((m) => ({ ...m, selected: m.id === messageId }))
    );
  }

  function handleUpdate(messageId: string, sms: string) {
    setMessages((msgs) =>
      msgs.map((m) => (m.id === messageId ? { ...m, sms } : m))
    );
  }

  async function handleDelete() {
    if (!confirm("Delete this campaign and all its contacts, messages, and activity? This cannot be undone.")) return;
    setDeleting(true);
    setDeleteError("");
    const res = await fetch(`/api/campaign/${id}`, {
      method: "DELETE",
      headers: await getAuthHeaders(),
    });
    if (!res.ok) {
      const data = await res.json();
      setDeleteError(data.error ?? "Failed to delete campaign.");
      setDeleting(false);
      return;
    }
    window.location.href = "/dashboard";
  }

  async function handleStatusChange(contactId: string, status: Contact["status"]) {
    const supabase = getSupabaseClient();
    const update: Record<string, unknown> = { status };
    // Record the timestamp when a contact is first reached out to.
    if (status === "contacted") update.last_contacted_at = new Date().toISOString();
    await supabase.from("contacts").update(update).eq("id", contactId);
    setContacts((cs) => cs.map((c) => c.id === contactId ? { ...c, ...update } : c));
  }

  async function handleExport() {
    setExportError("");
    setExporting(true);

    const url = `/api/contacts/export/${id}${includeOptOut ? "?opt_out=true" : ""}`;
    const res = await fetch(url, {
      method: "GET",
      headers: await getAuthHeaders(),
    });

    if (!res.ok) {
      let message = "Failed to export CSV.";
      try {
        const err = await res.json();
        if (err?.error) message = err.error;
      } catch {
        // Ignore parse failures and keep default message.
      }
      setExportError(message);
      setExporting(false);
      return;
    }

    const blob = await res.blob();
    const downloadUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = downloadUrl;
    a.download = `constit-export-${id}.csv`;
    a.click();
    URL.revokeObjectURL(downloadUrl);

    setExporting(false);
    logActivity("Exported CSV", `${pendingCount} contacts`);
  }

  async function handleSend() {
    setSendError(""); setSending(true); setSendResult(null);
    const res = await fetch("/api/send", {
      method: "POST",
      headers: await getAuthHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ campaign_id: id, include_opt_out: includeOptOut }),
    });
    const data = await res.json();
    setSending(false);
    if (!res.ok) { setSendError(data.error ?? "Send failed"); return; }
    setSendResult({ queued: data.queued, failed: data.failed, total: data.total });
    setSendConfirmed(false);
    logActivity("SMS sent via Twilio", `${data.queued} queued, ${data.failed} failed`);
    loadContacts(contactPage);
    if (analytics) loadAnalytics();
  }

  const selectedMessage = messages.find((m) => m.selected);
  const pendingCount = contactTotal;
  const repliedCount = contacts.filter((c) => c.status === "replied").length;

  if (!campaign) return (
    <div className="max-w-4xl mx-auto px-6 py-12">
      <div className="h-8 w-48 bg-zinc-100 rounded animate-pulse mb-4" />
      <div className="h-4 w-64 bg-zinc-100 rounded animate-pulse" />
    </div>
  );

  return (
    <div className="max-w-4xl mx-auto px-6 py-10">
      {/* Header */}
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <a href="/dashboard" className="text-xs text-zinc-400 hover:text-zinc-600">← All campaigns</a>
          <h1 className="text-xl font-medium text-zinc-900 mt-2">{campaign.name}</h1>
          <p className="text-sm text-zinc-500 mt-1">{campaign.issue}</p>
        </div>
        <div className="flex-shrink-0 mt-1">
          {deleteError && (
            <p className="text-xs text-red-600 mb-1">{deleteError}</p>
          )}
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="text-xs px-3 py-1.5 border border-red-200 text-red-500 rounded-lg hover:bg-red-50 disabled:opacity-50 transition-colors"
          >
            {deleting ? "Deleting…" : "Delete campaign"}
          </button>
        </div>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        {[
          { label: "Total contacts", value: contactTotal },
          { label: "Pending outreach", value: pendingCount },
          { label: "Replied", value: analytics?.replies.total ?? repliedCount },
        ].map(({ label, value }) => (
          <div key={label} className="bg-zinc-50 rounded-xl p-4 border border-zinc-100">
            <p className="text-2xl font-medium text-zinc-900">{value.toLocaleString()}</p>
            <p className="text-xs text-zinc-400 mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {/* Tab nav */}
      <div className="flex flex-wrap gap-1 p-1 bg-zinc-100 rounded-xl w-fit mb-8">
        {(["contacts", "messages", "export", "send", "analytics", "inbox"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm rounded-lg transition-all capitalize ${tab === t ? "bg-white shadow-sm text-zinc-900 font-medium" : "text-zinc-500 hover:text-zinc-700"}`}
          >
            {t}
            {t === "contacts" && contactTotal > 0 && (
              <span className="ml-1.5 text-xs bg-zinc-200 text-zinc-600 rounded-full px-1.5 py-0.5">{contactTotal}</span>
            )}
            {t === "messages" && messages.length > 0 && (
              <span className="ml-1.5 text-xs bg-zinc-200 text-zinc-600 rounded-full px-1.5 py-0.5">{messages.length}</span>
            )}
            {t === "inbox" && analytics && analytics.replies.total > 0 && (
              <span className="ml-1.5 text-xs bg-blue-100 text-blue-600 rounded-full px-1.5 py-0.5">{analytics.replies.total}</span>
            )}
          </button>
        ))}
      </div>

      {/* ── Contacts tab ── */}
      {tab === "contacts" && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-zinc-600">
              {contactTotal === 0 ? "No contacts yet. Import a CSV to start." : `${contactTotal.toLocaleString()} contacts`}
            </p>
            <button
              onClick={() => setShowImporter(!showImporter)}
              className="text-sm px-4 py-2 border border-zinc-200 rounded-lg hover:bg-zinc-50"
            >
              {showImporter ? "Hide importer" : "Import CSV"}
            </button>
          </div>

          {showImporter && (
            <div className="mb-6 border border-zinc-200 rounded-xl p-5">
              <CSVImporter
                campaignId={id}
                onImported={(count) => {
                  setShowImporter(false);
                  logActivity("Imported contacts", `${count} contacts added`);
                  loadContacts(1); setContactPage(1);
                }}
              />
            </div>
          )}

          {contactTotal > 0 && (
            <>
              <div className="border border-zinc-200 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-zinc-50 border-b border-zinc-200">
                      <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500">Name</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500">Phone</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500">Tags</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {contacts.map((c, i) => (
                      <tr key={c.id} className={i % 2 === 0 ? "bg-white" : "bg-zinc-50/50"}>
                        <td className="px-4 py-3 font-medium text-zinc-800">{c.name}</td>
                        <td className="px-4 py-3 text-zinc-500 font-mono text-xs">{c.phone || "—"}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {c.tags?.map((tag) => (
                              <span key={tag} className="text-xs bg-zinc-100 text-zinc-600 px-2 py-0.5 rounded-full">
                                {tag}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <select
                            value={c.status}
                            onChange={(e) => handleStatusChange(c.id, e.target.value as Contact["status"])}
                            className="text-xs border border-zinc-200 rounded px-2 py-1 bg-white"
                          >
                            <option value="pending">Pending</option>
                            <option value="contacted">Contacted</option>
                            <option value="replied">Replied</option>
                            <option value="opted_out">Opted out</option>
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {contactTotal > CONTACTS_PER_PAGE && (
                <div className="flex items-center justify-between mt-4">
                  <p className="text-xs text-zinc-400">
                    Showing {((contactPage - 1) * CONTACTS_PER_PAGE) + 1}–{Math.min(contactPage * CONTACTS_PER_PAGE, contactTotal)} of {contactTotal.toLocaleString()}
                  </p>
                  <div className="flex gap-2">
                    <button onClick={() => setContactPage((p) => Math.max(1, p - 1))} disabled={contactPage === 1} className="text-xs px-3 py-1.5 border border-zinc-200 rounded-lg hover:bg-zinc-50 disabled:opacity-40">← Prev</button>
                    <button onClick={() => setContactPage((p) => p + 1)} disabled={contactPage * CONTACTS_PER_PAGE >= contactTotal} className="text-xs px-3 py-1.5 border border-zinc-200 rounded-lg hover:bg-zinc-50 disabled:opacity-40">Next →</button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Messages tab ── */}
      {tab === "messages" && (
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
                    : "border-zinc-200 text-zinc-600 hover:bg-zinc-50"
                    }`}
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
                onEdited={(_, tone) => logActivity("Edited message", `tone: ${tone}`)}
                sampleName={contacts[0]?.name}
                locked={messageLocked}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── Export tab ── */}
      {tab === "export" && (() => {
        // ── Pre-export validation: run renderMessage on ALL pending contacts ──
        // This is the real segment count — not an estimate from the template.
        const pendingContacts = contacts.filter((c) => c.status === "pending");
        const renderedAll = selectedMessage
          ? pendingContacts.map((c) =>
            renderMessage({ name: c.name }, selectedMessage.sms, { optOut: includeOptOut })
          )
          : [];

        const segmentCounts = renderedAll.map((r) => r.analysis.segments);
        const uniqueSegments = Array.from(new Set(segmentCounts));
        const hasSegmentVariance = uniqueSegments.length > 1;
        const maxSegments = segmentCounts.length > 0 ? Math.max(...segmentCounts) : 0;
        const twoSegCount = segmentCounts.filter((s) => s > 1).length;
        const optOutAddsSegmentForAny = renderedAll.some((r) => r.optOutAddsSegment);

        // First-contact preview (consistent with what export route produces)
        const firstContact = pendingContacts[0] ?? contacts[0];
        const firstRendered = selectedMessage && firstContact
          ? renderMessage({ name: firstContact.name }, selectedMessage.sms, { optOut: includeOptOut })
          : null;
        const finalAnalysis = firstRendered?.analysis ?? null;

        const isReady = !!selectedMessage && !optOutAddsSegmentForAny && !hasSegmentVariance && pendingContacts.length > 0;
        const hasWarning = !!selectedMessage && (maxSegments > 1 || optOutAddsSegmentForAny || hasSegmentVariance);

        // ── Test simulation ──────────────────────────────────────────────────
        const simRendered = selectedMessage && simName.trim()
          ? renderMessage({ name: simName.trim() }, selectedMessage.sms, { optOut: includeOptOut })
          : null;

        async function copySimText() {
          if (!simRendered) return;
          await navigator.clipboard.writeText(simRendered.text);
          setSimCopied(true);
          setTimeout(() => setSimCopied(false), 2000);
        }

        return (
          <div className="space-y-6">

            {/* ── Send readiness bar ── */}
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

            {/* ── Opt-out adds segment warning ── */}
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

            {/* ── Segment variance warning ── */}
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

            {/* Selected message */}
            {selectedMessage ? (
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-5">
                <p className="text-sm font-medium text-emerald-800 mb-1">Selected message ({selectedMessage.tone})</p>
                <p className="text-sm text-emerald-700 font-mono">{selectedMessage.sms}</p>
                <p className="text-xs text-emerald-600 mt-2">{selectedMessage.sms.length} raw template characters</p>
              </div>
            ) : (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
                <p className="text-sm text-amber-800">
                  No message selected. Go to the Messages tab and choose a variant first.
                </p>
              </div>
            )}

            {/* Live preview — what the first contact actually receives */}
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

            {/* ── Test simulation ── */}
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

            {/* Export options */}
            <div className="border border-zinc-200 rounded-xl p-6 space-y-4">
              <h3 className="text-sm font-medium text-zinc-800">Export options</h3>

              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeOptOut}
                  onChange={(e) => setIncludeOptOut(e.target.checked)}
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

              {/* Export summary */}
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

              {/* Intent confirmation — required when any cost warning is active */}
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
                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-2">
                  {exportError}
                </p>
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
      })()}

      {/* ── Send tab (Twilio direct send) ── */}
      {tab === "send" && (
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
              <input type="checkbox" checked={includeOptOut} onChange={(e) => setIncludeOptOut(e.target.checked)} className="mt-0.5 accent-zinc-900" />
              <div>
                <p className="text-sm text-zinc-800">Append opt-out line</p>
                <p className="text-xs text-zinc-400">Appends &quot;Reply STOP to opt out.&quot; — strongly recommended and required by TCPA.</p>
              </div>
            </label>

            {!sendResult && (
              <label className="flex items-start gap-3 cursor-pointer border border-amber-200 bg-amber-50 rounded-lg px-4 py-3">
                <input type="checkbox" checked={sendConfirmed} onChange={(e) => setSendConfirmed(e.target.checked)} className="mt-0.5 accent-zinc-900" />
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

            {sendError && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-2">{sendError}</p>}

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
      )}

      {/* ── Analytics tab ── */}
      {tab === "analytics" && (
        <div className="space-y-6">
          {analyticsLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[1, 2, 3, 4].map((i) => <div key={i} className="h-24 bg-zinc-100 rounded-xl animate-pulse" />)}
            </div>
          ) : analytics ? (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { label: "Delivered", value: analytics.deliveries.delivered, sub: `${analytics.deliveries.delivery_rate_pct}% rate` },
                  { label: "Failed", value: analytics.deliveries.failed, sub: "delivery failures" },
                  { label: "Replies", value: analytics.replies.total, sub: `${analytics.replies.reply_rate_pct}% reply rate` },
                  { label: "Segments billed", value: analytics.deliveries.segments_billed, sub: "total SMS units" },
                ].map(({ label, value, sub }) => (
                  <div key={label} className="bg-zinc-50 rounded-xl p-4 border border-zinc-100">
                    <p className="text-2xl font-medium text-zinc-900">{value.toLocaleString()}</p>
                    <p className="text-xs font-medium text-zinc-700 mt-0.5">{label}</p>
                    <p className="text-xs text-zinc-400">{sub}</p>
                  </div>
                ))}
              </div>

              {analytics.replies.total > 0 && (
                <div className="border border-zinc-200 rounded-xl p-5">
                  <h3 className="text-sm font-medium text-zinc-800 mb-4">Reply breakdown</h3>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                    {(["positive", "negative", "question", "opt_out", "unclassified"] as const).map((intent) => {
                      const count = analytics.replies.by_intent[intent] ?? 0;
                      const colors: Record<string, string> = {
                        positive: "bg-emerald-50 text-emerald-700 border-emerald-200",
                        negative: "bg-red-50 text-red-700 border-red-200",
                        question: "bg-blue-50 text-blue-700 border-blue-200",
                        opt_out: "bg-amber-50 text-amber-700 border-amber-200",
                        unclassified: "bg-zinc-50 text-zinc-600 border-zinc-200",
                      };
                      return (
                        <div key={intent} className={`rounded-lg border p-3 text-center ${colors[intent]}`}>
                          <p className="text-lg font-medium">{count}</p>
                          <p className="text-xs capitalize">{intent.replace("_", " ")}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {analytics.variants.length > 0 && (
                <div className="border border-zinc-200 rounded-xl p-5">
                  <h3 className="text-sm font-medium text-zinc-800 mb-4">Message variant performance</h3>
                  <div className="space-y-3">
                    {analytics.variants.map((v) => (
                      <div key={v.message_id} className={`flex items-center gap-4 p-3 rounded-lg border ${v.selected ? "border-emerald-200 bg-emerald-50" : "border-zinc-200"}`}>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-zinc-700 capitalize">{v.tone}{v.selected && " ✓ selected"}</p>
                          <p className="text-xs text-zinc-400 truncate">{v.sms_preview}…</p>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="text-sm font-medium text-zinc-800">{v.delivered}/{v.total_sent}</p>
                          <p className="text-xs text-zinc-400">delivered</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <button onClick={loadAnalytics} className="text-xs text-zinc-400 hover:text-zinc-600 underline">Refresh analytics</button>
            </>
          ) : (
            <div className="text-center py-12">
              <p className="text-sm text-zinc-500 mb-4">Analytics will appear here after you send SMS via Twilio.</p>
              <button onClick={loadAnalytics} className="text-sm px-4 py-2 bg-zinc-900 text-white rounded-lg hover:bg-zinc-700">Load analytics</button>
            </div>
          )}
        </div>
      )}

      {/* ── Inbox tab (AI-classified replies) ── */}
      {tab === "inbox" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h3 className="text-sm font-medium text-zinc-800">Constituent replies</h3>
            <div className="flex flex-wrap gap-1">
              {["all", "positive", "negative", "question", "opt_out", "unclassified"].map((f) => (
                <button
                  key={f}
                  onClick={() => { setReplyFilter(f); setReplyPage(1); loadReplies(1, f); }}
                  className={`text-xs px-2.5 py-1 rounded-lg border capitalize transition-colors ${replyFilter === f ? "bg-zinc-900 text-white border-zinc-900" : "border-zinc-200 text-zinc-600 hover:bg-zinc-50"}`}
                >
                  {f.replace("_", " ")}
                </button>
              ))}
            </div>
          </div>

          {inboxLoading ? (
            <div className="space-y-3">{[1, 2, 3].map((i) => <div key={i} className="h-16 bg-zinc-100 rounded-xl animate-pulse" />)}</div>
          ) : replies.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-sm text-zinc-400">No replies yet. Replies appear here automatically when contacts text back via Twilio.</p>
            </div>
          ) : (
            <>
              <div className="space-y-3">
                {replies.map((r) => {
                  const intentColors: Record<string, string> = {
                    positive: "bg-emerald-50 text-emerald-700 border-emerald-200",
                    negative: "bg-red-50 text-red-700 border-red-200",
                    question: "bg-blue-50 text-blue-700 border-blue-200",
                    opt_out: "bg-amber-50 text-amber-700 border-amber-200",
                    unclassified: "bg-zinc-50 text-zinc-600 border-zinc-200",
                  };
                  return (
                    <div key={r.id} className="border border-zinc-200 rounded-xl p-4">
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <span className="text-xs font-mono text-zinc-400">{r.from_phone}</span>
                        <div className="flex items-center gap-2">
                          <span className={`text-xs px-2 py-0.5 rounded border capitalize ${intentColors[r.intent]}`}>{r.intent.replace("_", " ")}</span>
                          <span className="text-xs text-zinc-300">{new Date(r.received_at).toLocaleString()}</span>
                        </div>
                      </div>
                      <p className="text-sm text-zinc-700">{r.body}</p>
                      {r.ai_summary && <p className="text-xs text-zinc-400 mt-1 italic">AI: {r.ai_summary}</p>}
                    </div>
                  );
                })}
              </div>

              {replyTotal > 25 && (
                <div className="flex items-center justify-between pt-2">
                  <p className="text-xs text-zinc-400">{replyTotal} total replies</p>
                  <div className="flex gap-2">
                    <button onClick={() => { const p = Math.max(1, replyPage - 1); setReplyPage(p); loadReplies(p, replyFilter); }} disabled={replyPage === 1} className="text-xs px-3 py-1.5 border border-zinc-200 rounded-lg hover:bg-zinc-50 disabled:opacity-40">← Prev</button>
                    <button onClick={() => { const p = replyPage + 1; setReplyPage(p); loadReplies(p, replyFilter); }} disabled={replyPage * 25 >= replyTotal} className="text-xs px-3 py-1.5 border border-zinc-200 rounded-lg hover:bg-zinc-50 disabled:opacity-40">Next →</button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Activity log ── */}
      {activityLog.length > 0 && (
        <div className="mt-10 pt-6 border-t border-zinc-100">
          <p className="text-xs font-medium text-zinc-400 uppercase tracking-wide mb-3">Activity</p>
          <ul className="space-y-2">
            {activityLog.map((entry) => (
              <li key={entry.id} className="flex items-start gap-3">
                <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-zinc-300 flex-shrink-0" />
                <div>
                  <span className="text-sm text-zinc-700">{entry.event}</span>
                  {entry.details && (
                    <span className="text-xs text-zinc-400 ml-1.5">— {entry.details}</span>
                  )}
                  <p className="text-xs text-zinc-300 mt-0.5">
                    {new Date(entry.created_at).toLocaleString()}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}