// app/api/contacts/import/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { applyMapping, ColumnMapping } from "@/lib/csv";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { campaign_id, rows, mapping } = body as {
    campaign_id: string;
    rows: Record<string, string>[];
    mapping: ColumnMapping;
  };

  if (!campaign_id || !rows?.length || !mapping) {
    return NextResponse.json(
      { error: "campaign_id, rows, and mapping are required" },
      { status: 400 }
    );
  }

  // Apply the user-confirmed mapping to produce clean contact objects
  const contacts = applyMapping(rows, mapping);

  if (contacts.length === 0) {
    return NextResponse.json(
      { error: "No valid contacts found after mapping. Check that the name column is set correctly." },
      { status: 400 }
    );
  }

  // Bulk insert — never loop and insert one at a time
  const rows_to_insert = contacts.map((c) => ({
    campaign_id,
    name: c.name,
    phone: c.phone || null,
    email: c.email || null,
    tags: c.tags,
    notes: c.notes || null,
    status: "pending",
  }));

  const { error } = await supabase.from("contacts").insert(rows_to_insert);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    imported: contacts.length,
    skipped: rows.length - contacts.length,
  });
}
