// app/api/campaign/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getRouteSupabaseAndUser } from "@/lib/supabaseRouteAuth";

export async function DELETE(
    req: NextRequest,
    { params }: { params: { id: string } }
) {
    const { user, db } = await getRouteSupabaseAndUser(req);
    const { id } = params;

    if (!user || !db) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!id) {
        return NextResponse.json({ error: "Campaign ID is required" }, { status: 400 });
    }

    // Delete cascade: contacts, messages, activity_log, then campaign.
    // Order matters if the DB doesn't have ON DELETE CASCADE set up.
    const [{ error: contactsErr }, { error: messagesErr }, { error: logsErr }] =
        await Promise.all([
            db.from("contacts").delete().eq("campaign_id", id),
            db.from("messages").delete().eq("campaign_id", id),
            db.from("activity_log").delete().eq("campaign_id", id),
        ]);

    if (contactsErr || messagesErr || logsErr) {
        const msg = (contactsErr || messagesErr || logsErr)!.message;
        return NextResponse.json({ error: `Failed to delete campaign data: ${msg}` }, { status: 500 });
    }

    const { error } = await db.from("campaigns").delete().eq("id", id);

    if (error) {
        if (error.message.toLowerCase().includes("row-level security")) {
            return NextResponse.json({ error: "Unauthorized for this campaign operation." }, { status: 403 });
        }
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ deleted: true });
}
