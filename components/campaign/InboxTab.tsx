"use client";

import { useEffect, useState } from "react";
import { Reply } from "@/types";
import { getAuthHeaders } from "@/lib/clientAuth";

interface Props {
    campaignId: string;
}

const REPLIES_PER_PAGE = 25;

export default function InboxTab({ campaignId }: Props) {
    const [replies, setReplies] = useState<Reply[]>([]);
    const [replyFilter, setReplyFilter] = useState("all");
    const [replyPage, setReplyPage] = useState(1);
    const [replyTotal, setReplyTotal] = useState(0);
    const [inboxLoading, setInboxLoading] = useState(false);

    async function loadReplies(page: number, intent: string) {
        setInboxLoading(true);
        const params = new URLSearchParams({ campaign_id: campaignId, page: String(page) });
        if (intent !== "all") params.set("intent", intent);
        const res = await fetch(`/api/replies?${params}`, { headers: await getAuthHeaders() });
        if (res.ok) {
            const data = await res.json() as { replies: Reply[]; total: number };
            setReplies(data.replies);
            setReplyTotal(data.total);
        }
        setInboxLoading(false);
    }

    useEffect(() => {
        loadReplies(1, "all");
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [campaignId]);

    const intentColors: Record<string, string> = {
        positive: "bg-emerald-50 text-emerald-700 border-emerald-200",
        negative: "bg-red-50 text-red-700 border-red-200",
        question: "bg-blue-50 text-blue-700 border-blue-200",
        opt_out: "bg-amber-50 text-amber-700 border-amber-200",
        unclassified: "bg-zinc-50 text-zinc-600 border-zinc-200",
    };

    return (
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
                        {replies.map((r) => (
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
                        ))}
                    </div>

                    {replyTotal > REPLIES_PER_PAGE && (
                        <div className="flex items-center justify-between pt-2">
                            <p className="text-xs text-zinc-400">{replyTotal} total replies</p>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => { const p = Math.max(1, replyPage - 1); setReplyPage(p); loadReplies(p, replyFilter); }}
                                    disabled={replyPage === 1}
                                    className="text-xs px-3 py-1.5 border border-zinc-200 rounded-lg hover:bg-zinc-50 disabled:opacity-40"
                                >
                                    ← Prev
                                </button>
                                <button
                                    onClick={() => { const p = replyPage + 1; setReplyPage(p); loadReplies(p, replyFilter); }}
                                    disabled={replyPage * REPLIES_PER_PAGE >= replyTotal}
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
