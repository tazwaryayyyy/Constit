// app/api/organizations/members/route.ts
// Manage team members for the caller's workspace.

import { NextRequest, NextResponse } from "next/server";
import { getRouteSupabaseAndUser } from "@/lib/supabaseRouteAuth";

const VALID_ROLES = new Set(["admin", "editor", "viewer"]);
const MIGRATIONS_REQUIRED = "migrations_required";

function isMissingRelationError(err: unknown) {
    if (!err || typeof err !== "object") return false;
    const maybe = err as { code?: string; message?: string };
    return maybe.code === "42P01" || (maybe.message ?? "").toLowerCase().includes("does not exist");
}

async function getOrgContext(db: NonNullable<Awaited<ReturnType<typeof getRouteSupabaseAndUser>>["db"]>, userId: string) {
    const { data: ownedOrg, error: ownedErr } = await db
        .from("organizations")
        .select("id, owner_id")
        .eq("owner_id", userId)
        .maybeSingle();

    if (ownedErr) {
        if (isMissingRelationError(ownedErr)) throw new Error(MIGRATIONS_REQUIRED);
        throw ownedErr;
    }

    if (ownedOrg) {
        return { orgId: ownedOrg.id as string, isOwner: true };
    }

    const { data: member, error: memberErr } = await db
        .from("org_members")
        .select("org_id, role")
        .eq("user_id", userId)
        .limit(1)
        .maybeSingle();

    if (memberErr) {
        if (isMissingRelationError(memberErr)) throw new Error(MIGRATIONS_REQUIRED);
        throw memberErr;
    }

    if (!member) return null;
    return { orgId: member.org_id as string, isOwner: false };
}

export async function GET(req: NextRequest) {
    const correlationId = req.headers.get("x-request-id") ?? crypto.randomUUID();
    const { user, db } = await getRouteSupabaseAndUser(req);

    if (!user || !db) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let org: Awaited<ReturnType<typeof getOrgContext>>;
    try {
        org = await getOrgContext(db, user.id);
    } catch (err) {
        if (err instanceof Error && err.message === MIGRATIONS_REQUIRED) {
            return NextResponse.json({ error: "Schema migrations required", migrations_required: true }, { status: 503 });
        }
        return NextResponse.json({ error: "Organization lookup failed", correlation_id: correlationId }, { status: 500 });
    }

    if (!org) {
        return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    const { data: members, error } = await db
        .from("org_members")
        .select("user_id, role, joined_at")
        .eq("org_id", org.orgId)
        .order("joined_at", { ascending: true });

    if (error) {
        if (isMissingRelationError(error)) {
            return NextResponse.json({ error: "Schema migrations required", migrations_required: true }, { status: 503 });
        }
        return NextResponse.json({ error: "Failed to load members", correlation_id: correlationId }, { status: 500 });
    }

    const normalized = [
        { user_id: user.id, role: org.isOwner ? "owner" : "member", joined_at: null },
        ...(members ?? []),
    ];

    return NextResponse.json({ org_id: org.orgId, members: normalized }, { headers: { "x-request-id": correlationId } });
}

export async function POST(req: NextRequest) {
    const correlationId = req.headers.get("x-request-id") ?? crypto.randomUUID();
    const { user, db } = await getRouteSupabaseAndUser(req);

    if (!user || !db) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let org: Awaited<ReturnType<typeof getOrgContext>>;
    try {
        org = await getOrgContext(db, user.id);
    } catch (err) {
        if (err instanceof Error && err.message === MIGRATIONS_REQUIRED) {
            return NextResponse.json({ error: "Schema migrations required", migrations_required: true }, { status: 503 });
        }
        return NextResponse.json({ error: "Organization lookup failed", correlation_id: correlationId }, { status: 500 });
    }

    if (!org || !org.isOwner) {
        return NextResponse.json({ error: "Only workspace owner can add members" }, { status: 403 });
    }

    const body = await req.json() as { user_id?: string; role?: string };
    const targetUserId = (body.user_id ?? "").trim();
    const role = (body.role ?? "viewer").trim();

    if (!targetUserId) {
        return NextResponse.json({ error: "user_id is required" }, { status: 400 });
    }
    if (!VALID_ROLES.has(role)) {
        return NextResponse.json({ error: "role must be one of admin, editor, viewer" }, { status: 400 });
    }

    if (targetUserId === user.id) {
        return NextResponse.json({ error: "Owner is already in this workspace" }, { status: 400 });
    }

    const { error } = await db
        .from("org_members")
        .upsert({ org_id: org.orgId, user_id: targetUserId, role }, { onConflict: "org_id,user_id" });

    if (error) {
        if (isMissingRelationError(error)) {
            return NextResponse.json({ error: "Schema migrations required", migrations_required: true }, { status: 503 });
        }
        return NextResponse.json({ error: "Failed to add member", correlation_id: correlationId }, { status: 500 });
    }

    return NextResponse.json({ ok: true }, { headers: { "x-request-id": correlationId } });
}
