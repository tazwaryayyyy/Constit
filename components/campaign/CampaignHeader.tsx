"use client";

import { useState } from "react";
import { Campaign } from "@/types";
import { getAuthHeaders } from "@/lib/clientAuth";

interface Props {
    campaign: Campaign;
    campaignId: string;
}

export default function CampaignHeader({ campaign, campaignId }: Props) {
    const [deleting, setDeleting] = useState(false);
    const [deleteError, setDeleteError] = useState("");

    async function handleDelete() {
        if (!confirm("Delete this campaign and all its contacts, messages, and activity? This cannot be undone.")) return;
        setDeleting(true);
        setDeleteError("");
        const res = await fetch(`/api/campaign/${campaignId}`, {
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

    return (
        <div className="mb-8 flex items-start justify-between gap-4">
            <div>
                <a href="/dashboard" className="text-xs text-zinc-400 hover:text-zinc-600">← All campaigns</a>
                <h1 className="text-xl font-medium text-zinc-900 mt-2">{campaign.name}</h1>
                <p className="text-sm text-zinc-500 mt-1">{campaign.issue}</p>
            </div>
            <div className="flex-shrink-0 mt-1">
                {deleteError && <p className="text-xs text-red-600 mb-1">{deleteError}</p>}
                <button
                    onClick={handleDelete}
                    disabled={deleting}
                    className="text-xs px-3 py-1.5 border border-red-200 text-red-500 rounded-lg hover:bg-red-50 disabled:opacity-50 transition-colors"
                >
                    {deleting ? "Deleting…" : "Delete campaign"}
                </button>
            </div>
        </div>
    );
}
