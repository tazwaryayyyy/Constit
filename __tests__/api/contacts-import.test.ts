// __tests__/api/contacts-import.test.ts
// Tests billing limit enforcement in POST /api/contacts/import.
//
// After Fix 1 (atomic quota), the route calls db.rpc("claim_contact_quota")
// instead of a separate org-fetch + Node.js check + increment_contacts_used.
// These tests verify:
//   1. The 402 gate fires when claim_contact_quota returns allowed:false
//   2. No DB insert is called when the gate fires (data cannot slip through)
//   3. A successful import resolves with the single atomic RPC pattern
//   4. Solo users with no org (reason:"no_org") bypass the limit entirely

import { describe, expect, test, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Mock logger (avoids pino requiring native deps in test environment)
vi.mock("@/lib/logger", () => ({
    logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// Mock auth layer â€” we control user + db
vi.mock("@/lib/supabaseRouteAuth", () => ({
    getRouteSupabaseAndUser: vi.fn(),
}));

// Mock CSV mapper â€” focus test on billing logic, not CSV parsing
vi.mock("@/lib/csv", () => ({
    applyMapping: vi.fn(),
}));

import { POST } from "@/app/api/contacts/import/route";
import { getRouteSupabaseAndUser } from "@/lib/supabaseRouteAuth";
import { applyMapping } from "@/lib/csv";

// â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Builds a Supabase-style chainable query builder that resolves to `resolved`
 * when awaited directly OR when `.single()` is called.
 * The `.insert()` terminal also resolves to `resolved`.
 */
function makeChain(resolved: unknown) {
    const self: Record<string, unknown> = {};
    const thenable = (res: (v: unknown) => void, rej?: (e: unknown) => void) =>
        Promise.resolve(resolved).then(res, rej);

    for (const m of ["select", "eq", "order", "limit", "range", "update", "upsert"]) {
        (self as Record<string, () => typeof self>)[m] = () => self;
    }
    (self as Record<string, unknown>).single = vi.fn().mockResolvedValue(resolved);
    (self as Record<string, unknown>).maybeSingle = vi.fn().mockResolvedValue(resolved);
    (self as Record<string, unknown>).insert = vi.fn().mockResolvedValue(resolved);
    // Make the chain itself thenable so `await chain.eq()` works
    (self as Record<string, unknown>).then = thenable;
    (self as Record<string, unknown>).catch = (rej: (e: unknown) => void) =>
        Promise.resolve(resolved).catch(rej);
    return self;
}

function makeRequest(body: unknown) {
    return new NextRequest("http://localhost/api/contacts/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
    });
}

function makeContacts(count: number) {
    return Array.from({ length: count }, (_, i) => ({
        name: `Contact ${i}`,
        phone: `+1555${String(i).padStart(7, "0")}`,
        email: null,
        tags: [],
        notes: null,
    }));
}

const BASE_BODY = {
    campaign_id: "campaign-1",
    rows: [{ name: "Test", phone: "+15550001234" }],
    mapping: { name: "name", phone: "phone" },
};

// â”€â”€ Tests â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe("POST /api/contacts/import â€” billing limit enforcement", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    test("returns 402 when claim_contact_quota returns allowed:false (400/500 + 200)", async () => {
        // claim_contact_quota is called once atomically; no separate org fetch.
        const rpcMock = vi.fn()
            .mockResolvedValue({ data: { allowed: false, used: 400, limit: 500, requested: 200 }, error: null });
        const fromMock = vi.fn()
            .mockReturnValueOnce(makeChain({ data: { id: "campaign-1" }, error: null }))  // campaigns
            .mockReturnValueOnce(makeChain({ data: [], error: null }));                    // contacts dedup

        const mockDb = { from: fromMock, rpc: rpcMock };
        (getRouteSupabaseAndUser as ReturnType<typeof vi.fn>).mockResolvedValue({
            user: { id: "user-1" },
            db: mockDb,
        });
        (applyMapping as ReturnType<typeof vi.fn>).mockReturnValue({
            valid: makeContacts(200),
            errors: [],
        });

        const res = await POST(makeRequest(BASE_BODY));
        const body = await res.json();

        expect(res.status).toBe(402);
        expect(body.error).toMatch(/plan limit reached/i);
        expect(body.used).toBe(400);
        expect(body.limit).toBe(500);
        expect(body.requested).toBe(200);
        // DB insert must NOT have been called â€” the gate fired before it
        expect(fromMock).toHaveBeenCalledTimes(2); // campaigns + dedup only
        // claim_contact_quota called once with correct args
        expect(rpcMock).toHaveBeenCalledWith("claim_contact_quota", {
            p_owner_id: "user-1",
            p_delta: 200,
        });
    });

    test("returns 200 and calls insert when claim_contact_quota returns allowed:true (200/500 + 100)", async () => {
        // The RPC atomically checked the limit AND incremented the counter.
        // No separate increment call is needed after the insert.
        const rpcMock = vi.fn()
            .mockResolvedValue({ data: { allowed: true, used: 200, limit: 500, requested: 100 }, error: null });
        const fromMock = vi.fn()
            .mockReturnValueOnce(makeChain({ data: { id: "campaign-1" }, error: null }))  // campaigns
            .mockReturnValueOnce(makeChain({ data: [], error: null }))                    // contacts dedup
            .mockReturnValueOnce(makeChain({ error: null }));                             // contacts insert

        const mockDb = { from: fromMock, rpc: rpcMock };
        (getRouteSupabaseAndUser as ReturnType<typeof vi.fn>).mockResolvedValue({
            user: { id: "user-1" },
            db: mockDb,
        });
        (applyMapping as ReturnType<typeof vi.fn>).mockReturnValue({
            valid: makeContacts(100),
            errors: [],
        });

        const res = await POST(makeRequest(BASE_BODY));
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.imported).toBe(100);
        // insert was called (3rd from() call)
        expect(fromMock).toHaveBeenCalledTimes(3);
        // Atomic RPC called once â€” no separate increment_contacts_used
        expect(rpcMock).toHaveBeenCalledTimes(1);
        expect(rpcMock).toHaveBeenCalledWith("claim_contact_quota", {
            p_owner_id: "user-1",
            p_delta: 100,
        });
    });

    test("returns 200 for solo user with no org (reason:no_org) â€” no limit enforced", async () => {
        // claim_contact_quota returns allowed:true with reason:"no_org" for users
        // who have not yet created an org. The insert proceeds without a limit check.
        // release_contact_quota must NOT be called even if insert were to fail.
        const rpcMock = vi.fn()
            .mockResolvedValue({ data: { allowed: true, reason: "no_org" }, error: null });
        const fromMock = vi.fn()
            .mockReturnValueOnce(makeChain({ data: { id: "campaign-1" }, error: null }))
            .mockReturnValueOnce(makeChain({ data: [], error: null }))
            .mockReturnValueOnce(makeChain({ error: null }));

        const mockDb = { from: fromMock, rpc: rpcMock };
        (getRouteSupabaseAndUser as ReturnType<typeof vi.fn>).mockResolvedValue({
            user: { id: "user-1" },
            db: mockDb,
        });
        (applyMapping as ReturnType<typeof vi.fn>).mockReturnValue({
            valid: makeContacts(100),
            errors: [],
        });

        const res = await POST(makeRequest(BASE_BODY));
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.imported).toBe(100);
        // claim_contact_quota called once, release_contact_quota not called
        expect(rpcMock).toHaveBeenCalledTimes(1);
        expect(rpcMock).toHaveBeenCalledWith("claim_contact_quota", expect.anything());
        expect(rpcMock).not.toHaveBeenCalledWith("release_contact_quota", expect.anything());
    });
});
