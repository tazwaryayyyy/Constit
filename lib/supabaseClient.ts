// lib/supabaseClient.ts
import { createClient } from "@supabase/supabase-js";

let browserClient: ReturnType<typeof createClient<any>> | null = null;

export function getSupabaseClient() {
    if (browserClient) return browserClient;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
        throw new Error(
            "Missing Supabase env vars: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY"
        );
    }

    browserClient = createClient<any>(supabaseUrl, supabaseAnonKey);
    return browserClient;
}
