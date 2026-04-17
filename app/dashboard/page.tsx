"use client";
// app/dashboard/page.tsx

import { useEffect, useState } from "react";
import Link from "next/link";
import { getSupabaseClient } from "@/lib/supabaseClient";
import { Campaign } from "@/types";

export default function DashboardPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = getSupabaseClient();
    supabase
      .from("campaigns")
      .select("*")
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        setCampaigns(data ?? []);
        setLoading(false);
      });
  }, []);

  return (
    <div className="max-w-4xl mx-auto px-6 py-12">
      <div className="flex items-center justify-between mb-10">
        <div>
          <h1 className="text-2xl font-medium text-zinc-900">Constit</h1>
          <p className="text-sm text-zinc-500 mt-0.5">Campaign operations, simplified</p>
        </div>
        <Link
          href="/create"
          className="px-4 py-2 bg-zinc-900 text-white text-sm rounded-lg hover:bg-zinc-700 transition-colors"
        >
          New campaign
        </Link>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 bg-zinc-100 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : campaigns.length === 0 ? (
        <div className="text-center py-24 border-2 border-dashed border-zinc-200 rounded-xl">
          <p className="text-zinc-400 text-sm">No campaigns yet.</p>
          <Link
            href="/create"
            className="inline-block mt-4 text-sm text-zinc-900 underline underline-offset-4"
          >
            Create your first campaign
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {campaigns.map((c) => (
            <Link
              key={c.id}
              href={`/campaign/${c.id}`}
              className="block border border-zinc-200 rounded-xl p-5 hover:border-zinc-400 hover:shadow-sm transition-all bg-white"
            >
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="font-medium text-zinc-900">{c.name}</h2>
                  <p className="text-sm text-zinc-500 mt-1">{c.issue}</p>
                </div>
                <span className="text-xs text-zinc-400 mt-0.5">
                  {new Date(c.created_at).toLocaleDateString()}
                </span>
              </div>
              <p className="text-xs text-zinc-400 mt-3">Goal: {c.goal}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
