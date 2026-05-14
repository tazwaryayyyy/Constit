"use client";

import { useEffect, useState } from "react";
import { CampaignAnalytics } from "@/types";
import { getAuthHeaders } from "@/lib/clientAuth";

interface Props {
    campaignId: string;
    analytics: CampaignAnalytics | null;
    onAnalyticsLoaded: (a: CampaignAnalytics) => void;
}

export default function CampaignAnalyticsTab({ campaignId, analytics, onAnalyticsLoaded }: Props) {
    const [analyticsLoading, setAnalyticsLoading] = useState(false);

    async function loadAnalytics() {
        setAnalyticsLoading(true);
        const res = await fetch(`/api/analytics/${campaignId}`, { headers: await getAuthHeaders() });
        if (res.ok) onAnalyticsLoaded(await res.json() as CampaignAnalytics);
        setAnalyticsLoading(false);
    }

    useEffect(() => {
        if (!analytics) loadAnalytics();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    if (analyticsLoading) {
        return (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[1, 2, 3, 4].map((i) => <div key={i} className="h-24 bg-zinc-100 rounded-xl animate-pulse" />)}
            </div>
        );
    }

    if (!analytics) {
        return (
            <div className="text-center py-12">
                <p className="text-sm text-zinc-500 mb-4">Analytics will appear here after you send SMS via Twilio.</p>
                <button onClick={loadAnalytics} className="text-sm px-4 py-2 bg-zinc-900 text-white rounded-lg hover:bg-zinc-700">Load analytics</button>
            </div>
        );
    }

    return (
        <div className="space-y-6">
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
        </div>
    );
}
