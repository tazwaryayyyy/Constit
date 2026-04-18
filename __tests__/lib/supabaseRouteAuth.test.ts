import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockGetUser = vi.fn();
const mockSupabase = { auth: { getUser: mockGetUser } };
const mockCreateClient = vi.fn();

vi.mock("@/lib/supabaseServer", () => ({
    createSupabaseServerClient: () => mockSupabase,
}));

vi.mock("@supabase/supabase-js", () => ({
    createClient: (...args: unknown[]) => mockCreateClient(...args),
}));

describe("getRouteSupabaseAndUser", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
    });

    it("returns null user/db when session is missing", async () => {
        mockGetUser.mockResolvedValueOnce({ data: { user: null } });

        const { getRouteSupabaseAndUser } = await import("@/lib/supabaseRouteAuth");
        const req = new NextRequest("http://localhost/api/test");
        const result = await getRouteSupabaseAndUser(req);

        expect(result.user).toBeNull();
        expect(result.db).toBeNull();
        expect(mockGetUser).toHaveBeenCalledWith();
    });

    it("uses bearer token for auth and returns token-bound DB client", async () => {
        const bearerToken = "abc.def.ghi";
        const tokenDb = { tokenBound: true };

        mockGetUser.mockResolvedValueOnce({ data: { user: { id: "user-1" } } });
        mockCreateClient.mockReturnValueOnce(tokenDb);

        const { getRouteSupabaseAndUser } = await import("@/lib/supabaseRouteAuth");
        const req = new NextRequest("http://localhost/api/test", {
            headers: { Authorization: `Bearer ${bearerToken}` },
        });

        const result = await getRouteSupabaseAndUser(req);

        expect(mockGetUser).toHaveBeenCalledWith(bearerToken);
        expect(mockCreateClient).toHaveBeenCalledWith(
            "https://example.supabase.co",
            "anon-key",
            {
                global: {
                    headers: {
                        Authorization: `Bearer ${bearerToken}`,
                    },
                },
            }
        );
        expect(result.user).toEqual({ id: "user-1" });
        expect(result.db).toEqual(tokenDb);
    });

    it("uses cookie-backed supabase client when bearer is absent", async () => {
        mockGetUser.mockResolvedValueOnce({ data: { user: { id: "user-2" } } });

        const { getRouteSupabaseAndUser } = await import("@/lib/supabaseRouteAuth");
        const req = new NextRequest("http://localhost/api/test");

        const result = await getRouteSupabaseAndUser(req);

        expect(mockGetUser).toHaveBeenCalledWith();
        expect(mockCreateClient).not.toHaveBeenCalled();
        expect(result.user).toEqual({ id: "user-2" });
        expect(result.db).toBe(mockSupabase);
    });
});
