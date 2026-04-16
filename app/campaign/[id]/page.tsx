"use client";
// app/campaign/[id]/page.tsx — the core product experience

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { Campaign, Contact, Message } from "@/types";
import CSVImporter from "@/components/CSVImporter";
import MessageCard from "@/components/MessageCard";

type Tab = "contacts" | "messages" | "export";

export default function CampaignPage() {
  const { id } = useParams<{ id: string }>();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [tab, setTab] = useState<Tab>("contacts");
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState("");
  const [showImporter, setShowImporter] = useState(false);

  useEffect(() => {
    loadAll();
  }, [id]);

  async function loadAll() {
    const [{ data: camp }, { data: conts }, { data: msgs }] = await Promise.all([
      supabase.from("campaigns").select("*").eq("id", id).single(),
      supabase.from("contacts").select("*").eq("campaign_id", id).order("created_at"),
      supabase.from("messages").select("*").eq("campaign_id", id).order("created_at"),
    ]);
    setCampaign(camp);
    setContacts(conts ?? []);
    setMessages(msgs ?? []);
  }

  async function handleGenerate() {
    if (!campaign) return;
    setGenerating(true);
    setGenError("");

    const res = await fetch("/api/generate-messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
  }

  async function handleSelect(messageId: string) {
    await fetch("/api/messages/select", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message_id: messageId, campaign_id: id }),
    });
    setMessages((msgs) =>
      msgs.map((m) => ({ ...m, selected: m.id === messageId }))
    );
  }

  async function handleStatusChange(contactId: string, status: Contact["status"]) {
    await supabase.from("contacts").update({ status }).eq("id", contactId);
    setContacts((cs) => cs.map((c) => c.id === contactId ? { ...c, status } : c));
  }

  const selectedMessage = messages.find((m) => m.selected);
  const pendingCount = contacts.filter((c) => c.status === "pending").length;
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
      <div className="mb-8">
        <a href="/dashboard" className="text-xs text-zinc-400 hover:text-zinc-600">← All campaigns</a>
        <h1 className="text-xl font-medium text-zinc-900 mt-2">{campaign.name}</h1>
        <p className="text-sm text-zinc-500 mt-1">{campaign.issue}</p>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        {[
          { label: "Total contacts", value: contacts.length },
          { label: "Pending outreach", value: pendingCount },
          { label: "Replied", value: repliedCount },
        ].map(({ label, value }) => (
          <div key={label} className="bg-zinc-50 rounded-xl p-4 border border-zinc-100">
            <p className="text-2xl font-medium text-zinc-900">{value}</p>
            <p className="text-xs text-zinc-400 mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {/* Tab nav */}
      <div className="flex gap-1 p-1 bg-zinc-100 rounded-xl w-fit mb-8">
        {(["contacts", "messages", "export"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm rounded-lg transition-all capitalize ${
              tab === t ? "bg-white shadow-sm text-zinc-900 font-medium" : "text-zinc-500 hover:text-zinc-700"
            }`}
          >
            {t}
            {t === "contacts" && contacts.length > 0 && (
              <span className="ml-1.5 text-xs bg-zinc-200 text-zinc-600 rounded-full px-1.5 py-0.5">
                {contacts.length}
              </span>
            )}
            {t === "messages" && messages.length > 0 && (
              <span className="ml-1.5 text-xs bg-zinc-200 text-zinc-600 rounded-full px-1.5 py-0.5">
                {messages.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Contacts tab ── */}
      {tab === "contacts" && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-zinc-600">
              {contacts.length === 0 ? "No contacts yet. Import a CSV to start." : `${contacts.length} contacts`}
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
                  loadAll();
                }}
              />
            </div>
          )}

          {contacts.length > 0 && (
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
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="px-4 py-2 bg-zinc-900 text-white text-sm rounded-lg hover:bg-zinc-700 disabled:opacity-50"
            >
              {generating ? "Generating…" : "Generate 5 variants"}
            </button>
          </div>

          {genError && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-2 mb-4">
              {genError}
            </p>
          )}

          <div className="grid grid-cols-1 gap-4">
            {messages.map((m) => (
              <MessageCard key={m.id} message={m} onSelect={handleSelect} />
            ))}
          </div>
        </div>
      )}

      {/* ── Export tab ── */}
      {tab === "export" && (
        <div className="space-y-6">
          {selectedMessage ? (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-5">
              <p className="text-sm font-medium text-emerald-800 mb-1">Selected message ({selectedMessage.tone})</p>
              <p className="text-sm text-emerald-700 font-mono">{selectedMessage.sms}</p>
              <p className="text-xs text-emerald-600 mt-2">{selectedMessage.sms.length} / 160 characters</p>
            </div>
          ) : (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
              <p className="text-sm text-amber-800">
                No message selected. Go to the Messages tab and choose a variant first.
              </p>
            </div>
          )}

          <div className="border border-zinc-200 rounded-xl p-6">
            <h3 className="text-sm font-medium text-zinc-800 mb-2">Export contact list</h3>
            <p className="text-sm text-zinc-500 mb-4">
              Downloads a CSV of all pending contacts with the selected message attached. Use this with your existing SMS or email tool.
            </p>
            <a
              href={`/api/contacts/export/${id}`}
              className={`inline-block px-5 py-2.5 text-sm rounded-lg transition-colors ${
                selectedMessage
                  ? "bg-zinc-900 text-white hover:bg-zinc-700"
                  : "bg-zinc-100 text-zinc-400 cursor-not-allowed pointer-events-none"
              }`}
            >
              Download CSV ({pendingCount} contacts)
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
