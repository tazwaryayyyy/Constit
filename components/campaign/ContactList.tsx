"use client";

import { useCallback, useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabaseClient";
import { Contact } from "@/types";
import CSVImporter from "@/components/CSVImporter";

const CONTACTS_PER_PAGE = 50;

interface Props {
    campaignId: string;
    refreshKey?: number;
    onCountChange: (count: number) => void;
    onActivityLog: (event: string, details?: string) => void;
}

export default function ContactList({ campaignId, refreshKey, onCountChange, onActivityLog }: Props) {
    const [contacts, setContacts] = useState<Contact[]>([]);
    const [contactPage, setContactPage] = useState(1);
    const [contactTotal, setContactTotal] = useState(0);
    const [showImporter, setShowImporter] = useState(false);

    const loadContacts = useCallback(async (page: number) => {
        const supabase = getSupabaseClient();
        const from = (page - 1) * CONTACTS_PER_PAGE;
        const to = from + CONTACTS_PER_PAGE - 1;
        const { data, count } = await supabase
            .from("contacts")
            .select("*", { count: "exact" })
            .eq("campaign_id", campaignId)
            .order("created_at")
            .range(from, to);
        const total = count ?? 0;
        setContacts(data ?? []);
        setContactTotal(total);
        onCountChange(total);
    }, [campaignId, onCountChange]);

    useEffect(() => {
        loadContacts(contactPage);
    }, [contactPage, loadContacts]);

    // Refresh when parent signals (e.g., after a send completes)
    useEffect(() => {
        if (refreshKey !== undefined && refreshKey > 0) {
            setContactPage(1);
            loadContacts(1);
        }
    }, [refreshKey, loadContacts]);

    async function handleStatusChange(contactId: string, status: Contact["status"]) {
        const supabase = getSupabaseClient();
        const update: Record<string, unknown> = { status };
        if (status === "contacted") update.last_contacted_at = new Date().toISOString();
        await supabase.from("contacts").update(update).eq("id", contactId);
        setContacts((cs) => cs.map((c) => c.id === contactId ? { ...c, ...update } : c));
    }

    return (
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
                        campaignId={campaignId}
                        onImported={(count) => {
                            setShowImporter(false);
                            onActivityLog("Imported contacts", `${count} contacts added`);
                            setContactPage(1);
                            loadContacts(1);
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
                                <button
                                    onClick={() => setContactPage((p) => Math.max(1, p - 1))}
                                    disabled={contactPage === 1}
                                    className="text-xs px-3 py-1.5 border border-zinc-200 rounded-lg hover:bg-zinc-50 disabled:opacity-40"
                                >
                                    ← Prev
                                </button>
                                <button
                                    onClick={() => setContactPage((p) => p + 1)}
                                    disabled={contactPage * CONTACTS_PER_PAGE >= contactTotal}
                                    className="text-xs px-3 py-1.5 border border-zinc-200 rounded-lg hover:bg-zinc-50 disabled:opacity-40"
                                >
                                    Next →
                                </button>
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
