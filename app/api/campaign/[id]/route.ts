// app/api/campaign/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabaseServer";

export async function DELETE(
    _req: NextRequest,
    { params }: { params: { id: string } }
) {
    const supabase = createSupabaseServerClient();
    const { id } = params;

    if (!id) {
        return NextResponse.json({ error: "Campaign ID is required" }, { status: 400 });
    }

    // Delete cascade: contacts, messages, activity_log, then campaign.
    // Order matters if the DB doesn't have ON DELETE CASCADE set up.
    const [{ error: contactsErr }, { error: messagesErr }, { error: logsErr }] =
        await Promise.all([
            supabase.from("contacts").delete().eq("campaign_id", id),
            supabase.from("messages").delete().eq("campaign_id", id),
            supabase.from("activity_log").delete().eq("campaign_id", id),
        ]);

    if (contactsErr || messagesErr || logsErr) {
        const msg = (contactsErr || messagesErr || logsErr)!.message;
        return NextResponse.json({ error: `Failed to delete campaign data: ${msg}` }, { status: 500 });
    }

    const { error } = await supabase.from("campaigns").delete().eq("id", id);

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ deleted: true });
}
