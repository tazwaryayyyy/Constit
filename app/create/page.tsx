"use client";
// app/create/page.tsx

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseClient } from "@/lib/supabaseClient";

export default function CreatePage() {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", issue: "", audience: "", goal: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const supabase = getSupabaseClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const token = session?.access_token;

    if (!token) {
      setLoading(false);
      setError("You are not signed in. Open /login and sign in, then try again.");
      return;
    }

    const res = await fetch("/api/campaign/create", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(form),
    });

    const data = await res.json();
    setLoading(false);

    if (!res.ok) {
      if (res.status === 401) {
        setError("Unauthorized. Please sign in first at /login, then try creating the campaign again.");
      } else {
        setError(data.error);
      }
      return;
    }

    router.push(`/campaign/${data.id}`);
  }

  const field = (key: keyof typeof form, label: string, placeholder: string, hint: string) => (
    <div>
      <label className="block text-sm font-medium text-zinc-800 mb-1">{label}</label>
      <p className="text-xs text-zinc-400 mb-2">{hint}</p>
      <input
        type="text"
        value={form[key]}
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
        placeholder={placeholder}
        required
        className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-zinc-900 bg-white"
      />
    </div>
  );

  return (
    <div className="max-w-xl mx-auto px-6 py-12">
      <a href="/dashboard" className="text-sm text-zinc-400 hover:text-zinc-700 mb-8 block">
        ← Back to dashboard
      </a>
      <h1 className="text-xl font-medium text-zinc-900 mb-8">New campaign</h1>

      <form onSubmit={handleSubmit} className="space-y-6">
        {field("name", "Campaign name", "e.g. Ward 5 Outreach 2024", "An internal name — your team will see this, not the public.")}
        {field("issue", "The issue", "e.g. Potholes on Oak Street going unrepaired for 6 months", "What is this campaign about? Be specific.")}
        {field("audience", "Target audience", "e.g. Homeowners in Ward 5, age 35–65", "Who are you reaching out to?")}
        {field("goal", "What you want them to do", "e.g. Sign the petition by Oct 15, or attend the town hall", "One concrete action. The AI will write to this.")}

        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-2">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full py-3 bg-zinc-900 text-white text-sm rounded-lg hover:bg-zinc-700 disabled:opacity-50 transition-colors"
        >
          {loading ? "Creating…" : "Create campaign →"}
        </button>
      </form>
    </div>
  );
}
