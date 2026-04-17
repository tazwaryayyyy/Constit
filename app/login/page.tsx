"use client";

import { FormEvent, Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { getSupabaseClient } from "@/lib/supabaseClient";

function LoginForm() {
    const params = useSearchParams();
    const next = params.get("next") || "/dashboard";

    const [email, setEmail] = useState("");
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState("");
    const [error, setError] = useState("");

    async function handleSubmit(e: FormEvent) {
        e.preventDefault();
        setLoading(true);
        setError("");
        setMessage("");

        try {
            const supabase = getSupabaseClient();
            const { error: signInError } = await supabase.auth.signInWithOtp({
                email: email.trim(),
                options: {
                    emailRedirectTo: `${window.location.origin}${next}`,
                },
            });

            if (signInError) {
                setError(signInError.message);
            } else {
                setMessage("Check your email for the sign-in link, then return here.");
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : "Login failed.");
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="max-w-md mx-auto px-6 py-14">
            <Link href="/dashboard" className="text-sm text-zinc-400 hover:text-zinc-700">
                ← Back
            </Link>

            <h1 className="mt-6 text-2xl font-medium text-zinc-900">Sign in</h1>
            <p className="mt-2 text-sm text-zinc-500">
                Use your email to continue and create campaigns.
            </p>

            <form onSubmit={handleSubmit} className="mt-8 space-y-4">
                <div>
                    <label className="block text-sm font-medium text-zinc-800 mb-1">Email</label>
                    <input
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-zinc-900"
                        placeholder="you@example.com"
                    />
                </div>

                {error && (
                    <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                        {error}
                    </p>
                )}

                {message && (
                    <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                        {message}
                    </p>
                )}

                <button
                    type="submit"
                    disabled={loading}
                    className="w-full py-2.5 bg-zinc-900 text-white text-sm rounded-lg hover:bg-zinc-700 disabled:opacity-50"
                >
                    {loading ? "Sending link…" : "Send magic link"}
                </button>
            </form>
        </div>
    );
}

export default function LoginPage() {
    return (
        <Suspense fallback={<div className="max-w-md mx-auto px-6 py-14 text-sm text-zinc-500">Loading sign-in…</div>}>
            <LoginForm />
        </Suspense>
    );
}
