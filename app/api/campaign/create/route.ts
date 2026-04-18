// app/api/campaign/create/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabaseServer";
import { createClient } from "@supabase/supabase-js";

const FIELD_LIMITS: Record<string, number> = {
  name: 120,
  issue: 500,
  audience: 500,
  goal: 500,
};

export async function POST(req: NextRequest) {
  const correlationId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  const supabase = createSupabaseServerClient();
  const body = await req.json();
  const { name, issue, audience, goal } = body;

  if (!name || !issue || !audience || !goal) {
    return NextResponse.json(
      { error: "name, issue, audience, and goal are all required" },
      { status: 400 }
    );
  }

  // ── Input length validation ───────────────────────────────────────────────
  for (const [field, limit] of Object.entries(FIELD_LIMITS)) {
    const value = body[field];
    if (typeof value !== "string" || value.trim().length === 0) {
      return NextResponse.json({ error: `${field} must be a non-empty string` }, { status: 400 });
    }
    if (value.length > limit) {
      return NextResponse.json({ error: `${field} must be under ${limit} characters` }, { status: 400 });
    }
  }

  // Prefer cookie session, but also accept explicit bearer token from the client.
  const authHeader = req.headers.get("authorization") ?? "";
  const bearerToken = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length).trim()
    : null;

  const { data: { user } } = bearerToken
    ? await supabase.auth.getUser(bearerToken)
    : await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // If authentication came from a bearer token, run DB queries with that same token
  // so RLS sees auth.uid() correctly instead of anonymous.
  const db = bearerToken
    ? createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        global: {
          headers: {
            Authorization: `Bearer ${bearerToken}`,
          },
        },
      }
    )
    : supabase;

  const { data, error } = await db
    .from("campaigns")
    .insert({ name: name.trim(), issue: issue.trim(), audience: audience.trim(), goal: goal.trim(), user_id: user.id })
    .select("id")
    .single();

  if (error) {
    console.error(`[campaign/create] [${correlationId}] DB error for user ${user.id}:`, error.message);
    if (error.message.toLowerCase().includes("row-level security")) {
      return NextResponse.json({ error: "Unauthorized for this campaign operation." }, { status: 403 });
    }
    return NextResponse.json({ error: "Failed to create campaign" }, { status: 500 });
  }

  return NextResponse.json({ id: data.id }, { headers: { "x-request-id": correlationId } });
}
