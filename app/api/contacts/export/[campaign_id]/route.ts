// app/api/contacts/export/[campaign_id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";

export async function GET(
  _req: NextRequest,
  { params }: { params: { campaign_id: string } }
) {
  const { campaign_id } = params;

  // Get selected message for this campaign
  const { data: message } = await supabase
    .from("messages")
    .select("sms, call_to_action, tone")
    .eq("campaign_id", campaign_id)
    .eq("selected", true)
    .single();

  // Get all contacts
  const { data: contacts, error } = await supabase
    .from("contacts")
    .select("name, phone, email, tags, status")
    .eq("campaign_id", campaign_id)
    .eq("status", "pending");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Build CSV manually — no papaparse on server to keep bundle small
  const selectedSms = message?.sms ?? "";
  const headers = ["name", "phone", "email", "tags", "status", "selected_message_sms"];
  const csvRows = [
    headers.join(","),
    ...(contacts ?? []).map((c) =>
      [
        `"${c.name}"`,
        `"${c.phone ?? ""}"`,
        `"${c.email ?? ""}"`,
        `"${(c.tags ?? []).join("; ")}"`,
        c.status,
        `"${selectedSms.replace(/"/g, '""')}"`,
      ].join(",")
    ),
  ];

  return new NextResponse(csvRows.join("\n"), {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="constit-export-${campaign_id}.csv"`,
    },
  });
}
