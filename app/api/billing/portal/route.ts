import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getRouteSupabaseAndUser } from "@/lib/supabaseRouteAuth";

export async function POST(req: NextRequest) {
    const correlationId = req.headers.get("x-request-id") ?? crypto.randomUUID();
    const { user } = await getRouteSupabaseAndUser(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const stripeKey = process.env.STRIPE_SECRET_KEY;
    const appUrl = process.env.NEXT_PUBLIC_APP_URL;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!stripeKey || !appUrl || !supabaseUrl || !serviceRole) {
        return NextResponse.json({ error: "Billing is not fully configured" }, { status: 503 });
    }

    const adminClient = createClient(supabaseUrl, serviceRole);

    // Prefer org owned by this user; fall back to first org membership.
    const { data: ownedOrg } = await adminClient
        .from("organizations")
        .select("stripe_customer_id")
        .eq("owner_id", user.id)
        .maybeSingle();

    let customerId = ownedOrg?.stripe_customer_id ?? null;

    if (!customerId) {
        const { data: member } = await adminClient
            .from("org_members")
            .select("organizations(stripe_customer_id)")
            .eq("user_id", user.id)
            .limit(1)
            .maybeSingle();

        customerId = (member?.organizations as { stripe_customer_id?: string } | null)?.stripe_customer_id ?? null;
    }

    if (!customerId) {
        return NextResponse.json(
            { error: "No billing account found. Upgrade first to create a Stripe customer." },
            { status: 404, headers: { "x-request-id": correlationId } }
        );
    }

    const portalRes = await fetch("https://api.stripe.com/v1/billing_portal/sessions", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${stripeKey}`,
            "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
            customer: customerId,
            return_url: `${appUrl}/dashboard`,
        }),
    });

    if (!portalRes.ok) {
        console.error(`[billing/portal] [${correlationId}] Stripe billing portal error`);
        return NextResponse.json(
            { error: "Failed to create billing portal session" },
            { status: 502, headers: { "x-request-id": correlationId } }
        );
    }

    const session = (await portalRes.json()) as { url: string };
    return NextResponse.json({ url: session.url }, { headers: { "x-request-id": correlationId } });
}
