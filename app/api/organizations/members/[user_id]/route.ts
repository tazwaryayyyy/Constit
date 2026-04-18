// app/api/organizations/members/[user_id]/route.ts
// Update or remove team members from the caller's workspace.

import { NextRequest, NextResponse } from "next/server";
import { getRouteSupabaseAndUser } from "@/lib/supabaseRouteAuth";

const VALID_ROLES = new Set(["admin", "editor", "viewer"]);
const MIGRATIONS_REQUIRED = "migrations_required";

function isMissingRelationError(err: unknown) {
    if (!err || typeof err !== "object") return false;
    const maybe = err as { code?: string; message?: string };
    return maybe.code === "42P01" || (maybe.message ?? "").toLowerCase().includes("does not exist");
}

async function getOwnedOrgId(db: NonNullable<Awaited<ReturnType<typeof getRouteSupabaseAndUser>>["db"]>, userId: string) {
    const { data: ownedOrg, error } = await db
        .from("organizations")
        .select("id")
        .eq("owner_id", userId)
        .maybeSingle();

    if (error) {
        if (isMissingRelationError(error)) throw new Error(MIGRATIONS_REQUIRED);
        throw error;
    }

    return ownedOrg?.id as string | undefined;
}

export async function PATCH(
    req: NextRequest,
    { params }: { params: { user_id: string } }
) {
    const correlationId = req.headers.get("x-request-id") ?? crypto.randomUUID();
    const { user, db } = await getRouteSupabaseAndUser(req);

    if (!user || !db) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let orgId: string | undefined;
    try {
        orgId = await getOwnedOrgId(db, user.id);
    } catch (err) {
        if (err instanceof Error && err.message === MIGRATIONS_REQUIRED) {
            return NextResponse.json({ error: "Schema migrations required", migrations_required: true }, { status: 503 });
        }
        return NextResponse.json({ error: "Organization lookup failed", correlation_id: correlationId }, { status: 500 });
    }

    if (!orgId) {
        return NextResponse.json({ error: "Only workspace owner can update roles" }, { status: 403 });
    }

    const targetUserId = params.user_id;
    const body = await req.json() as { role?: string };
    const role = (body.role ?? "").trim();

    if (!VALID_ROLES.has(role)) {
        return NextResponse.json({ error: "role must be one of admin, editor, viewer" }, { status: 400 });
    }

    const { error } = await db
        .from("org_members")
        .update({ role })
        .eq("org_id", orgId)
        .eq("user_id", targetUserId);

    if (error) {
        if (isMissingRelationError(error)) {
            return NextResponse.json({ error: "Schema migrations required", migrations_required: true }, { status: 503 });
        }
        return NextResponse.json({ error: "Failed to update role", correlation_id: correlationId }, { status: 500 });
    }

    return NextResponse.json({ ok: true }, { headers: { "x-request-id": correlationId } });
}

export async function DELETE(
    req: NextRequest,
    { params }: { params: { user_id: string } }
) {
    const correlationId = req.headers.get("x-request-id") ?? crypto.randomUUID();
    const { user, db } = await getRouteSupabaseAndUser(req);

    if (!user || !db) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let orgId: string | undefined;
    try {
        orgId = await getOwnedOrgId(db, user.id);
    } catch (err) {
        if (err instanceof Error && err.message === MIGRATIONS_REQUIRED) {
            return NextResponse.json({ error: "Schema migrations required", migrations_required: true }, { status: 503 });
        }
        return NextResponse.json({ error: "Organization lookup failed", correlation_id: correlationId }, { status: 500 });
    }

    if (!orgId) {
        return NextResponse.json({ error: "Only workspace owner can remove members" }, { status: 403 });
    }

    const targetUserId = params.user_id;

    const { error } = await db
        .from("org_members")
        .delete()
        .eq("org_id", orgId)
        .eq("user_id", targetUserId);

    if (error) {
        if (isMissingRelationError(error)) {
            return NextResponse.json({ error: "Schema migrations required", migrations_required: true }, { status: 503 });
        }
        return NextResponse.json({ error: "Failed to remove member", correlation_id: correlationId }, { status: 500 });
    }

    return NextResponse.json({ ok: true }, { headers: { "x-request-id": correlationId } });
}
