"use client";
// app/dashboard/page.tsx

import { useEffect, useState } from "react";
import Link from "next/link";
import { getSupabaseClient } from "@/lib/supabaseClient";
import { getAuthHeaders } from "@/lib/clientAuth";
import { Campaign, Organization, OrganizationMember } from "@/types";

export default function DashboardPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [orgRole, setOrgRole] = useState<string | null>(null);
  const [migrationsRequired, setMigrationsRequired] = useState(false);
  const [billingLoading, setBillingLoading] = useState(false);
  const [billingError, setBillingError] = useState("");
  const [teamMembers, setTeamMembers] = useState<OrganizationMember[]>([]);
  const [teamLoading, setTeamLoading] = useState(false);
  const [teamError, setTeamError] = useState("");
  const [newMemberUserId, setNewMemberUserId] = useState("");
  const [newMemberRole, setNewMemberRole] = useState<"admin" | "editor" | "viewer">("viewer");

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

  useEffect(() => {
    // Run org fetch with auth headers after session is available client-side.
    async function loadOrg() {
      try {
        const res = await fetch("/api/organizations", { headers: await getAuthHeaders() });
        if (!res.ok) return;
        const data = (await res.json()) as {
          organization: Organization | null;
          role: string | null;
          migrations_required?: boolean;
        };

        if (data.migrations_required) {
          setMigrationsRequired(true);
          setOrganization(null);
          setOrgRole(null);
          return;
        }

        setMigrationsRequired(false);
        setOrganization(data.organization);
        setOrgRole(data.role);
      } catch {
        // Ignore transient org fetch errors on dashboard.
      }
    }

    loadOrg();
  }, []);

  useEffect(() => {
    async function loadMembers() {
      if (!organization) return;
      setTeamLoading(true);
      setTeamError("");
      try {
        const res = await fetch("/api/organizations/members", { headers: await getAuthHeaders() });
        const data = (await res.json()) as { members?: OrganizationMember[]; error?: string };
        if (!res.ok) {
          setTeamError(data.error ?? "Failed to load team");
          setTeamLoading(false);
          return;
        }
        setTeamMembers(data.members ?? []);
      } catch {
        setTeamError("Failed to load team");
      }
      setTeamLoading(false);
    }

    loadMembers();
  }, [organization]);

  async function startCheckout(plan: "pro" | "enterprise") {
    setBillingError("");
    setBillingLoading(true);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: await getAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ plan }),
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        setBillingError(data.error ?? "Could not start checkout.");
        setBillingLoading(false);
        return;
      }
      window.location.href = data.url;
    } catch {
      setBillingError("Could not start checkout.");
      setBillingLoading(false);
    }
  }

  async function openBillingPortal() {
    setBillingError("");
    setBillingLoading(true);
    try {
      const res = await fetch("/api/billing/portal", {
        method: "POST",
        headers: await getAuthHeaders(),
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        setBillingError(data.error ?? "Could not open billing portal.");
        setBillingLoading(false);
        return;
      }
      window.location.href = data.url;
    } catch {
      setBillingError("Could not open billing portal.");
      setBillingLoading(false);
    }
  }

  async function refreshTeamMembers() {
    setTeamLoading(true);
    setTeamError("");
    try {
      const res = await fetch("/api/organizations/members", { headers: await getAuthHeaders() });
      const data = (await res.json()) as { members?: OrganizationMember[]; error?: string };
      if (!res.ok) {
        setTeamError(data.error ?? "Failed to load team");
      } else {
        setTeamMembers(data.members ?? []);
      }
    } catch {
      setTeamError("Failed to load team");
    }
    setTeamLoading(false);
  }

  async function addTeamMember() {
    if (!newMemberUserId.trim()) return;
    setTeamError("");
    setTeamLoading(true);
    try {
      const res = await fetch("/api/organizations/members", {
        method: "POST",
        headers: await getAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ user_id: newMemberUserId.trim(), role: newMemberRole }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setTeamError(data.error ?? "Failed to add member");
        setTeamLoading(false);
        return;
      }
      setNewMemberUserId("");
      await refreshTeamMembers();
    } catch {
      setTeamError("Failed to add member");
      setTeamLoading(false);
    }
  }

  async function updateMemberRole(userId: string, role: "admin" | "editor" | "viewer") {
    setTeamError("");
    try {
      const res = await fetch(`/api/organizations/members/${userId}`, {
        method: "PATCH",
        headers: await getAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ role }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setTeamError(data.error ?? "Failed to update role");
        return;
      }
      setTeamMembers((prev) => prev.map((m) => (m.user_id === userId ? { ...m, role } : m)));
    } catch {
      setTeamError("Failed to update role");
    }
  }

  async function removeTeamMember(userId: string) {
    setTeamError("");
    try {
      const res = await fetch(`/api/organizations/members/${userId}`, {
        method: "DELETE",
        headers: await getAuthHeaders(),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setTeamError(data.error ?? "Failed to remove member");
        return;
      }
      setTeamMembers((prev) => prev.filter((m) => m.user_id !== userId));
    } catch {
      setTeamError("Failed to remove member");
    }
  }

  const contactsUsed = organization?.contacts_used_this_month ?? 0;
  const contactsLimit = organization?.contacts_limit ?? 500;
  const usagePct = Math.min(100, Math.round((contactsUsed / Math.max(1, contactsLimit)) * 100));
  const plan = organization?.plan ?? "free";

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

      {migrationsRequired && (
        <div className="mb-8 border border-amber-200 rounded-xl p-5 bg-amber-50">
          <h2 className="text-sm font-medium text-amber-900 mb-1">Workspace migrations required</h2>
          <p className="text-xs text-amber-800">
            This environment is missing organization tables. Run <span className="font-mono">schema_migrations.sql</span> in Supabase SQL Editor, then refresh this page.
          </p>
        </div>
      )}

      {organization && (
        <div className="mb-8 border border-zinc-200 rounded-xl p-5 bg-white">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <p className="text-xs uppercase tracking-wide text-zinc-400">Workspace</p>
              <h2 className="text-base font-medium text-zinc-900 mt-1">{organization.name}</h2>
              <p className="text-xs text-zinc-500 mt-1">Role: {orgRole ?? "member"}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-xs px-2 py-1 rounded-full border capitalize ${plan === "free" ? "bg-zinc-50 border-zinc-200 text-zinc-600" : plan === "pro" ? "bg-blue-50 border-blue-200 text-blue-700" : "bg-emerald-50 border-emerald-200 text-emerald-700"}`}>
                {plan}
              </span>
              {(plan === "pro" || plan === "enterprise") && (
                <button
                  onClick={openBillingPortal}
                  disabled={billingLoading}
                  className="text-xs px-3 py-1.5 border border-zinc-200 rounded-lg hover:bg-zinc-50 disabled:opacity-50"
                >
                  Manage billing
                </button>
              )}
              {plan === "free" && (
                <button
                  onClick={() => startCheckout("pro")}
                  disabled={billingLoading}
                  className="text-xs px-3 py-1.5 bg-zinc-900 text-white rounded-lg hover:bg-zinc-700 disabled:opacity-50"
                >
                  Upgrade to Pro
                </button>
              )}
              {plan === "pro" && (
                <button
                  onClick={() => startCheckout("enterprise")}
                  disabled={billingLoading}
                  className="text-xs px-3 py-1.5 border border-blue-200 text-blue-700 rounded-lg hover:bg-blue-50 disabled:opacity-50"
                >
                  Upgrade to Enterprise
                </button>
              )}
            </div>
          </div>

          <div className="mt-4">
            <div className="flex items-center justify-between text-xs text-zinc-500 mb-1.5">
              <span>Monthly contacts usage</span>
              <span>{contactsUsed.toLocaleString()} / {contactsLimit.toLocaleString()}</span>
            </div>
            <div className="h-2 bg-zinc-100 rounded-full overflow-hidden">
              <div className={`h-full ${usagePct >= 90 ? "bg-red-500" : usagePct >= 70 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${usagePct}%` }} />
            </div>
          </div>

          {billingError && <p className="text-xs text-red-600 mt-3">{billingError}</p>}
        </div>
      )}

      {organization && (
        <div className="mb-8 border border-zinc-200 rounded-xl p-5 bg-white">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-zinc-900">Team workspace</h3>
            <button
              onClick={refreshTeamMembers}
              disabled={teamLoading}
              className="text-xs text-zinc-500 hover:text-zinc-700 underline disabled:opacity-50"
            >
              Refresh
            </button>
          </div>

          {orgRole === "owner" && (
            <div className="mb-4 p-3 rounded-lg border border-zinc-200 bg-zinc-50">
              <p className="text-xs text-zinc-500 mb-2">Add member by Supabase user id</p>
              <div className="flex gap-2 flex-wrap">
                <input
                  value={newMemberUserId}
                  onChange={(e) => setNewMemberUserId(e.target.value)}
                  placeholder="user_id"
                  className="flex-1 min-w-[220px] text-xs border border-zinc-300 rounded px-2.5 py-1.5"
                />
                <select
                  value={newMemberRole}
                  onChange={(e) => setNewMemberRole(e.target.value as "admin" | "editor" | "viewer")}
                  className="text-xs border border-zinc-300 rounded px-2.5 py-1.5"
                >
                  <option value="admin">admin</option>
                  <option value="editor">editor</option>
                  <option value="viewer">viewer</option>
                </select>
                <button
                  onClick={addTeamMember}
                  disabled={teamLoading || !newMemberUserId.trim()}
                  className="text-xs px-3 py-1.5 bg-zinc-900 text-white rounded hover:bg-zinc-700 disabled:opacity-50"
                >
                  Add member
                </button>
              </div>
            </div>
          )}

          {teamError && <p className="text-xs text-red-600 mb-3">{teamError}</p>}

          {teamLoading ? (
            <div className="space-y-2">
              {[1, 2].map((i) => <div key={i} className="h-10 bg-zinc-100 rounded animate-pulse" />)}
            </div>
          ) : teamMembers.length === 0 ? (
            <p className="text-xs text-zinc-500">No team members yet.</p>
          ) : (
            <div className="space-y-2">
              {teamMembers.map((m) => (
                <div key={m.user_id} className="flex items-center justify-between border border-zinc-200 rounded-lg px-3 py-2">
                  <div>
                    <p className="text-xs text-zinc-700 font-mono">{m.user_id}</p>
                    <p className="text-[11px] text-zinc-400">{m.joined_at ? new Date(m.joined_at).toLocaleDateString() : "Owner"}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {orgRole === "owner" && m.role !== "owner" && (
                      <>
                        <select
                          value={m.role}
                          onChange={(e) => updateMemberRole(m.user_id, e.target.value as "admin" | "editor" | "viewer")}
                          className="text-xs border border-zinc-300 rounded px-2 py-1"
                        >
                          <option value="admin">admin</option>
                          <option value="editor">editor</option>
                          <option value="viewer">viewer</option>
                        </select>
                        <button
                          onClick={() => removeTeamMember(m.user_id)}
                          className="text-xs px-2.5 py-1 border border-red-200 text-red-600 rounded hover:bg-red-50"
                        >
                          Remove
                        </button>
                      </>
                    )}
                    {m.role === "owner" && <span className="text-xs px-2 py-1 rounded bg-zinc-100 text-zinc-600">owner</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

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
