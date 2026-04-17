// app/api/contacts/export/[campaign_id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { renderMessage } from "@/lib/sms";
import { getRouteSupabaseAndUser } from "@/lib/supabaseRouteAuth";

export async function GET(
  req: NextRequest,
  { params }: { params: { campaign_id: string } }
) {
  const { user, db } = await getRouteSupabaseAndUser(req);

  if (!user || !db) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { campaign_id } = params;
  const includeOptOut = req.nextUrl.searchParams.get("opt_out") === "true";

  // Get selected message for this campaign
  const { data: message, error: messageError } = await db
    .from("messages")
    .select("sms, call_to_action, tone")
    .eq("campaign_id", campaign_id)
    .eq("selected", true)
    .single();

  if (messageError && messageError.code !== "PGRST116") {
    if (messageError.message.toLowerCase().includes("row-level security")) {
      return NextResponse.json({ error: "Unauthorized for this export operation." }, { status: 403 });
    }
    return NextResponse.json({ error: messageError.message }, { status: 500 });
  }

  // Get all pending contacts
  const { data: contacts, error } = await db
    .from("contacts")
    .select("name, phone, email, tags, status")
    .eq("campaign_id", campaign_id)
    .eq("status", "pending");

  if (error) {
    if (error.message.toLowerCase().includes("row-level security")) {
      return NextResponse.json({ error: "Unauthorized for this export operation." }, { status: 403 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!message) {
    return NextResponse.json(
      { error: "No message selected for this campaign. Select a message variant before exporting." },
      { status: 422 }
    );
  }

  const templateSms = message.sms;

  // Post-render integrity check: assert the final SMS is non-empty for every contact.
  // An empty template ("") with no opt-out produces an empty string — never export blank rows.
  type ExportRow = string;
  const emptyNameList: string[] = [];

  const dataRows: ExportRow[] = (contacts ?? []).map((c) => {
    const { text: sms, analysis } = renderMessage(
      { name: c.name },
      templateSms,
      { optOut: includeOptOut }
    );

    // Guard: rendered text must have content. If blank, record it and skip.
    if (!sms.trim()) {
      emptyNameList.push(c.name ?? "(blank)");
      return "";
    }

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
  }).filter(Boolean);

  // If every contact produced an empty render, abort — sending blank texts is worse than not sending.
  if (dataRows.length === 0) {
    return NextResponse.json(
      { error: "Every contact produced an empty message. Check that the message template is not blank." },
      { status: 422 }
    );
  }

  const headers = ["name", "phone", "email", "tags", "status", "message_sms", "sms_segments", "sms_encoding"];
  const csvRows = [headers.join(","), ...dataRows];

  return new NextResponse(csvRows.join("\n"), {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="constit-export-${campaign_id}.csv"`,
    },
  });
}
