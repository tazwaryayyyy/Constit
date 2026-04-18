// app/api/contacts/import/route.ts
import { NextRequest, NextResponse } from "next/server";
import { applyMapping, ColumnMapping } from "@/lib/csv";
import { getRouteSupabaseAndUser } from "@/lib/supabaseRouteAuth";

const MAX_IMPORT_ROWS = 50_000;

export async function POST(req: NextRequest) {
  const correlationId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  const { user, db } = await getRouteSupabaseAndUser(req);

  if (!user || !db) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const {
    campaign_id,
    rows,
    mapping,
    duplicate_strategy = "skip", // "skip" | "keep_both"
  } = body as {
    campaign_id: string;
    rows: Record<string, string>[];
    mapping: ColumnMapping;
    duplicate_strategy?: string;
  };

  if (!campaign_id || !rows?.length || !mapping) {
    return NextResponse.json(
      { error: "campaign_id, rows, and mapping are required" },
      { status: 400 }
    );
  }

  // ── Size limit: prevent DOS via massive imports ──────────────────────────
  if (rows.length > MAX_IMPORT_ROWS) {
    return NextResponse.json(
      { error: `Import limited to ${MAX_IMPORT_ROWS.toLocaleString()} rows per batch` },
      { status: 413 }
    );
  }

  // ── Ownership check: campaign must belong to this user ───────────────────
  const { data: campaign, error: campError } = await db
    .from("campaigns")
    .select("id")
    .eq("id", campaign_id)
    .single();

  if (campError || !campaign) {
    console.warn(`[contacts/import] [${correlationId}] campaign ${campaign_id} not found for user ${user.id}`);
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  // Apply user-confirmed mapping — returns valid rows and error rows.
  const { valid, errors } = applyMapping(rows, mapping);

  if (valid.length === 0) {
    return NextResponse.json(
      { error: "No importable contacts found. Rows may be missing required fields (name or phone). Download the error report for details." },
      { status: 400 }
    );
  }

  // Detect duplicates against existing contacts in this campaign (by phone).
  const { data: existing } = await db
    .from("contacts")
    .select("phone")
    .eq("campaign_id", campaign_id);

  const existingPhones = new Set(
    (existing ?? []).map((c: { phone: string | null }) => c.phone).filter(Boolean)
  );

  const duplicates = valid.filter((c) => c.phone && existingPhones.has(c.phone));
  const uniqueRows = valid.filter((c) => !c.phone || !existingPhones.has(c.phone));

  const toInsert = duplicate_strategy === "keep_both" ? valid : uniqueRows;

  if (toInsert.length === 0) {
    return NextResponse.json({
      imported: 0,
      skipped: duplicates.length,
      duplicateCount: duplicates.length,
      errors,
    });
  }

  const rowsToInsert = toInsert.map((c) => ({
    campaign_id,
    name: c.name,
    phone: c.phone || null,
    email: c.email || null,
    tags: c.tags,
    notes: c.notes || null,
    status: "pending",
  }));

  const { error } = await db.from("contacts").insert(rowsToInsert);

  if (error) {
    console.error(`[contacts/import] [${correlationId}] DB insert error:`, error.message);
    if (error.message.toLowerCase().includes("row-level security")) {
      return NextResponse.json({ error: "Unauthorized for this contacts operation." }, { status: 403 });
    }
    return NextResponse.json({ error: "Failed to import contacts" }, { status: 500 });
  }

  return NextResponse.json(
    {
      imported: toInsert.length,
      skipped: duplicate_strategy === "skip" ? duplicates.length : 0,
      duplicateCount: duplicates.length,
      errors,
    },
    { headers: { "x-request-id": correlationId } }
  );
}

