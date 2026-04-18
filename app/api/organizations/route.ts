// app/api/organizations/route.ts
// Returns the current user's workspace (organization) and membership role.

import { NextRequest, NextResponse } from "next/server";
import { getRouteSupabaseAndUser } from "@/lib/supabaseRouteAuth";

function isMissingRelationError(err: unknown) {
    if (!err || typeof err !== "object") return false;
    const maybe = err as { code?: string; message?: string };
    return maybe.code === "42P01" || (maybe.message ?? "").toLowerCase().includes("does not exist");
}

function defaultOrgName(email?: string | null) {
    const fallback = "My Organization";
    if (!email) return fallback;
    const localPart = email.split("@")[0]?.trim();
    if (!localPart) return fallback;
    const pretty = localPart.slice(0, 1).toUpperCase() + localPart.slice(1);
    return `${pretty}'s Organization`;
}

export async function GET(req: NextRequest) {
    const correlationId = req.headers.get("x-request-id") ?? crypto.randomUUID();
    const { user, db } = await getRouteSupabaseAndUser(req);

    if (!user || !db) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // First try an org owned by the current user.
    const { data: ownedOrg, error: ownedErr } = await db
        .from("organizations")
        .select("*")
        .eq("owner_id", user.id)
        .maybeSingle();

    if (ownedErr) {
        if (isMissingRelationError(ownedErr)) {
            return NextResponse.json({ organization: null, role: null, migrations_required: true });
        }
        return NextResponse.json(
            { error: "Organization lookup failed", correlation_id: correlationId },
            { status: 500 }
        );
    }

    if (ownedOrg) {
        return NextResponse.json({ organization: ownedOrg, role: "owner" }, { headers: { "x-request-id": correlationId } });
    }

    // Fall back to org membership.
    const { data: membership, error: membershipErr } = await db
        .from("org_members")
        .select("role, organizations(*)")
        .eq("user_id", user.id)
        .limit(1)
        .maybeSingle();

    if (membershipErr) {
        if (isMissingRelationError(membershipErr)) {
            return NextResponse.json({ organization: null, role: null, migrations_required: true });
        }
        return NextResponse.json(
            { error: "Organization membership lookup failed", correlation_id: correlationId },
            { status: 500 }
        );
    }

    if (membership?.organizations) {
        return NextResponse.json(
            {
                organization: membership.organizations,
                role: membership.role,
            },
            { headers: { "x-request-id": correlationId } }
        );
    }

    // If user has no org yet, create a personal free workspace.
    const { data: createdOrg, error: createErr } = await db
        .from("organizations")
        .insert({
            name: defaultOrgName(user.email),
            owner_id: user.id,
            plan: "free",
            contacts_used_this_month: 0,
            contacts_limit: 500,
        })
        .select("*")
        .single();

    if (createErr) {
        if (isMissingRelationError(createErr)) {
            return NextResponse.json({ organization: null, role: null, migrations_required: true });
        }
        return NextResponse.json(
            { error: "Failed to create organization", correlation_id: correlationId },
            { status: 500 }
        );
    }

    return NextResponse.json(
        { organization: createdOrg, role: "owner" },
        { status: 201, headers: { "x-request-id": correlationId } }
    );
}
