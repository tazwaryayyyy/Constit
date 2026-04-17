// app/api/campaign/create/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabaseServer";

export async function POST(req: NextRequest) {
  const supabase = createSupabaseServerClient();
  const body = await req.json();
  const { name, issue, audience, goal } = body;

  if (!name || !issue || !audience || !goal) {
    return NextResponse.json(
      { error: "name, issue, audience, and goal are all required" },
      { status: 400 }
    );
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

  const { data, error } = await supabase
    .from("campaigns")
    .insert({ name, issue, audience, goal, user_id: user.id })
    .select("id")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ id: data.id });
}
