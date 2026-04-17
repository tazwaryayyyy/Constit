import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabaseServer";

export async function getRouteSupabaseAndUser(req: NextRequest) {
    const supabase = createSupabaseServerClient();

    const authHeader = req.headers.get("authorization") ?? "";
    const bearerToken = authHeader.startsWith("Bearer ")
        ? authHeader.slice("Bearer ".length).trim()
        : null;

    const {
        data: { user },
    } = bearerToken ? await supabase.auth.getUser(bearerToken) : await supabase.auth.getUser();

    if (!user) {
        return { user: null, db: null };
    }

    const db = bearerToken
        ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
            global: {
                headers: {
                    Authorization: `Bearer ${bearerToken}`,
                },
            },
        })
        : supabase;

    return { user, db };
}
