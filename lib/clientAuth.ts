import { getSupabaseClient } from "@/lib/supabaseClient";

export async function getAuthHeaders(baseHeaders: Record<string, string> = {}) {
    const {
        data: { session },
    } = await getSupabaseClient().auth.getSession();

    if (!session?.access_token) {
        return baseHeaders;
    }

    return {
        ...baseHeaders,
        Authorization: `Bearer ${session.access_token}`,
    };
}
