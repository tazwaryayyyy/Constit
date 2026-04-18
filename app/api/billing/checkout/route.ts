// app/api/billing/checkout/route.ts
// Creates a Stripe Checkout session for subscription upgrades.
// Users are redirected to Stripe-hosted checkout, then back to /dashboard on success.

import { NextRequest, NextResponse } from "next/server";
import { getRouteSupabaseAndUser } from "@/lib/supabaseRouteAuth";

const PLANS: Record<string, { priceId: string; name: string }> = {
    pro: {
        priceId: process.env.STRIPE_PRO_PRICE_ID ?? "price_pro_placeholder",
        name: "Pro",
    },
    enterprise: {
        priceId: process.env.STRIPE_ENTERPRISE_PRICE_ID ?? "price_enterprise_placeholder",
        name: "Enterprise",
    },
};

export async function POST(req: NextRequest) {
    const correlationId = req.headers.get("x-request-id") ?? crypto.randomUUID();
    const { user, db } = await getRouteSupabaseAndUser(req);

    if (!user || !db) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
        return NextResponse.json(
            { error: "Stripe is not configured. Contact support." },
            { status: 503 }
        );
    }

    const body = await req.json();
    const { plan } = body as { plan: string };

    if (!plan || !PLANS[plan]) {
        return NextResponse.json(
            { error: `Invalid plan. Choose: ${Object.keys(PLANS).join(", ")}` },
            { status: 400 }
        );
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

    // Create Stripe Checkout Session via REST API (no stripe npm package needed)
    const params = new URLSearchParams({
        "line_items[0][price]": PLANS[plan].priceId,
        "line_items[0][quantity]": "1",
        mode: "subscription",
        success_url: `${baseUrl}/dashboard?billing=success&plan=${plan}`,
        cancel_url: `${baseUrl}/dashboard?billing=canceled`,
        customer_email: user.email ?? "",
        "metadata[user_id]": user.id,
        "metadata[plan]": plan,
        "subscription_data[metadata][user_id]": user.id,
    });

    const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${stripeKey}`,
            "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params.toString(),
    });

    const session = await response.json() as { url?: string; error?: { message?: string } };

    if (!response.ok) {
        console.error(`[billing/checkout] [${correlationId}] Stripe error:`, session.error?.message);
        return NextResponse.json({ error: "Failed to create checkout session" }, { status: 500 });
    }

    return NextResponse.json({ url: session.url }, { headers: { "x-request-id": correlationId } });
}
