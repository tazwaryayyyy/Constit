// app/api/contacts/import/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { applyMapping, ColumnMapping } from "@/lib/csv";

export async function POST(req: NextRequest) {
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

  // Apply user-confirmed mapping — returns valid rows and error rows.
  const { valid, errors } = applyMapping(rows, mapping);

  if (valid.length === 0) {
    return NextResponse.json(
      { error: "No importable contacts found. Rows may be missing required fields (name or phone). Download the error report for details." },
      { status: 400 }
    );
  }

  // Detect duplicates against existing contacts in this campaign (by phone).
  const { data: existing } = await supabase
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

  const { error } = await supabase.from("contacts").insert(rowsToInsert);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    imported: toInsert.length,
    skipped: duplicate_strategy === "skip" ? duplicates.length : 0,
    duplicateCount: duplicates.length,
    errors,
  });
}

