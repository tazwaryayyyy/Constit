// app/api/contacts/export/[campaign_id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { renderMessage } from "@/lib/sms";

export async function GET(
  req: NextRequest,
  { params }: { params: { campaign_id: string } }
) {
  const { campaign_id } = params;
  const includeOptOut = req.nextUrl.searchParams.get("opt_out") === "true";

  // Get selected message for this campaign
  const { data: message } = await supabase
    .from("messages")
    .select("sms, call_to_action, tone")
    .eq("campaign_id", campaign_id)
    .eq("selected", true)
    .single();

  // Get all pending contacts
  const { data: contacts, error } = await supabase
    .from("contacts")
    .select("name, phone, email, tags, status")
    .eq("campaign_id", campaign_id)
    .eq("status", "pending");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!message) {
    return NextResponse.json(
      { error: "No message selected for this campaign. Select a message variant before exporting." },
      { status: 422 }
    );
  }

  const templateSms = message.sms;

  const headers = ["name", "phone", "email", "tags", "status", "message_sms", "sms_segments", "sms_encoding"];
  const csvRows = [
    headers.join(","),
    ...(contacts ?? []).map((c) => {
      // Use renderMessage — the single source of truth for final SMS content.
      const { text: sms, analysis } = renderMessage(
        { name: c.name },
        templateSms,
        { optOut: includeOptOut }
      );

      return [
        `"${(c.name ?? "").replace(/"/g, '""')}"`,
        `"${c.phone ?? ""}"`,
        `"${c.email ?? ""}"`,
        `"${(c.tags ?? []).join("; ")}"`,
        c.status,
        `"${sms.replace(/"/g, '""')}"`,
        analysis.segments,
        analysis.encoding,
      ].join(",");
    }),
  ];

  return new NextResponse(csvRows.join("\n"), {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="constit-export-${campaign_id}.csv"`,
    },
  });
}
