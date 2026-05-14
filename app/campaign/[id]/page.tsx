"use client";
// app/campaign/[id]/page.tsx — orchestrates the 7 campaign sub-components

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { getSupabaseClient } from "@/lib/supabaseClient";
import { Campaign, Message, ActivityLog, CampaignAnalytics } from "@/types";
import CampaignHeader from "@/components/campaign/CampaignHeader";
import ContactList from "@/components/campaign/ContactList";
import MessageGenerator from "@/components/campaign/MessageGenerator";
import ExportTab from "@/components/campaign/ExportTab";
import SendTab from "@/components/campaign/SendTab";
import CampaignAnalyticsTab from "@/components/campaign/CampaignAnalytics";
import InboxTab from "@/components/campaign/InboxTab";

type Tab = "contacts" | "messages" | "export" | "send" | "analytics" | "inbox";

export default function CampaignPage() {
  const { id } = useParams<{ id: string }>();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [tab, setTab] = useState<Tab>("contacts");
  const [includeOptOut, setIncludeOptOut] = useState(false);
  const [contactTotal, setContactTotal] = useState(0);
  const [contactRefreshKey, setContactRefreshKey] = useState(0);
  const [activityLog, setActivityLog] = useState<ActivityLog[]>([]);
  const [analytics, setAnalytics] = useState<CampaignAnalytics | null>(null);

  useEffect(() => {
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
    }
    loadInitial();
  }, [id]);

  const logActivity = useCallback(async (event: string, details?: string) => {
    const supabase = getSupabaseClient();
    await supabase.from("activity_log").insert({ campaign_id: id, event, details: details ?? null });
    setActivityLog((prev) => [
      { id: crypto.randomUUID(), campaign_id: id, event, details: details ?? null, created_at: new Date().toISOString() },
      ...prev,
    ].slice(0, 20));
  }, [id]);

  const selectedMessage = messages.find((m) => m.selected) ?? null;

  if (!campaign) return (
    <div className="max-w-4xl mx-auto px-6 py-12">
      <div className="h-8 w-48 bg-zinc-100 rounded animate-pulse mb-4" />
      <div className="h-4 w-64 bg-zinc-100 rounded animate-pulse" />
    </div>
  );

  return (
    <div className="max-w-4xl mx-auto px-6 py-10">
      <CampaignHeader campaign={campaign} campaignId={id} />

      <div className="grid grid-cols-3 gap-4 mb-8">
        {[
          { label: "Total contacts", value: contactTotal },
          { label: "Pending outreach", value: contactTotal },
          { label: "Replied", value: analytics?.replies.total ?? 0 },
        ].map(({ label, value }) => (
          <div key={label} className="bg-zinc-50 rounded-xl p-4 border border-zinc-100">
            <p className="text-2xl font-medium text-zinc-900">{value.toLocaleString()}</p>
            <p className="text-xs text-zinc-400 mt-0.5">{label}</p>
          </div>
        ))}
      </div>

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

      {tab === "contacts" && (
        <ContactList campaignId={id} refreshKey={contactRefreshKey} onCountChange={setContactTotal} onActivityLog={logActivity} />
      )}
      {tab === "messages" && (
        <MessageGenerator campaignId={id} campaign={campaign} messages={messages} onMessagesChange={setMessages} onActivityLog={logActivity} />
      )}
      {tab === "export" && (
        <ExportTab campaignId={id} selectedMessage={selectedMessage} includeOptOut={includeOptOut} onIncludeOptOutChange={setIncludeOptOut} onActivityLog={logActivity} />
      )}
      {tab === "send" && (
        <SendTab campaignId={id} selectedMessage={selectedMessage} contactTotal={contactTotal} includeOptOut={includeOptOut} onIncludeOptOutChange={setIncludeOptOut} onSendComplete={() => setContactRefreshKey((k) => k + 1)} onActivityLog={logActivity} />
      )}
      {tab === "analytics" && (
        <CampaignAnalyticsTab campaignId={id} analytics={analytics} onAnalyticsLoaded={setAnalytics} />
      )}
      {tab === "inbox" && <InboxTab campaignId={id} />}

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
                  <p className="text-xs text-zinc-300 mt-0.5">{new Date(entry.created_at).toLocaleString()}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
