import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetSession = vi.fn();

vi.mock("@/lib/supabaseClient", () => ({
    getSupabaseClient: () => ({
        auth: {
            getSession: mockGetSession,
        },
    }),
}));

describe("getAuthHeaders", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("returns base headers when no session token is present", async () => {
        mockGetSession.mockResolvedValueOnce({ data: { session: null } });

        const { getAuthHeaders } = await import("@/lib/clientAuth");
        const headers = await getAuthHeaders({ "Content-Type": "application/json" });

        expect(headers).toEqual({ "Content-Type": "application/json" });
    });

    it("adds Authorization bearer when session token exists", async () => {
        mockGetSession.mockResolvedValueOnce({
            data: { session: { access_token: "token-123" } },
        });

        const { getAuthHeaders } = await import("@/lib/clientAuth");
        const headers = await getAuthHeaders({ Accept: "application/json" });

        expect(headers).toEqual({
            Accept: "application/json",
            Authorization: "Bearer token-123",
        });
    });
});
