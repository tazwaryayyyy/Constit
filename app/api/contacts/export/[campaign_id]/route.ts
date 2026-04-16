// app/api/contacts/export/[campaign_id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { analyzeSMS } from "@/lib/sms";

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

  const templateSms = message?.sms ?? "";
  const optOutSuffix = " Reply STOP to opt out.";

  const headers = ["name", "phone", "email", "tags", "status", "message_sms"];
  const csvRows = [
    headers.join(","),
    ...(contacts ?? []).map((c) => {
      // Personalise: replace {name} with the contact's first name.
      // Fallback to "there" for blank/missing names to avoid "Hi , ...".
      const rawFirst = c.name?.split(" ")[0]?.trim() ?? "";
      const firstName = rawFirst.length > 0 ? rawFirst : "there";
      let sms = templateSms.replace(/\{name\}/gi, firstName);

      // Append opt-out suffix only if the composed message still fits in one GSM segment.
      // Use analyzeSMS (not .length) so Unicode and extended chars are accounted for.
      if (includeOptOut && !sms.toLowerCase().includes("reply stop")) {
        const candidate = sms + optOutSuffix;
        if (analyzeSMS(candidate).segments === 1) sms = candidate;
      }

      return [
        `"${c.name}"`,
        `"${c.phone ?? ""}"`,
        `"${c.email ?? ""}"`,
        `"${(c.tags ?? []).join("; ")}"`,
        c.status,
        `"${sms.replace(/"/g, '""')}"`,
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
