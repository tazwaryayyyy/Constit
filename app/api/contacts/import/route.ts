// app/api/contacts/import/route.ts
import { NextRequest, NextResponse } from "next/server";
import { applyMapping, ColumnMapping } from "@/lib/csv";
import { getRouteSupabaseAndUser } from "@/lib/supabaseRouteAuth";
import { logger } from "@/lib/logger";

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
    logger.warn({ correlationId, campaignId: campaign_id, userId: user.id }, "contacts/import: campaign not found");
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

  // ── FIX #1 (atomic): Enforce plan contact limit ──────────────────────────
  // claim_contact_quota (Migration 11) uses SELECT ... FOR UPDATE so concurrent
  // imports on the same org row serialize at the Postgres lock, eliminating the
  // race condition where two simultaneous calls could both pass a Node.js check.
  // Returns: { allowed, [used, limit, requested], [reason:"no_org"] }
  const { data: quotaResult, error: quotaError } = await db.rpc("claim_contact_quota", {
    p_owner_id: user.id,
    p_delta: toInsert.length,
  });

  if (quotaError) {
    logger.error({ err: quotaError, correlationId, userId: user.id }, "contacts/import: quota RPC failed");
    return NextResponse.json({ error: "Failed to verify plan limits" }, { status: 500 });
  }

  const quota = quotaResult as {
    allowed: boolean;
    used?: number;
    limit?: number;
    requested?: number;
    reason?: string;
  };

  if (!quota.allowed) {
    const { used, limit, requested } = quota;
    logger.warn(
      { correlationId, userId: user.id, used, limit, requested },
      "contacts/import: plan limit would be exceeded"
    );
    return NextResponse.json(
      {
        error: `Plan limit reached. Your plan allows ${(limit ?? 0).toLocaleString()} contacts per month. You have used ${(used ?? 0).toLocaleString()} and are trying to import ${(requested ?? toInsert.length).toLocaleString()} more. Upgrade your plan to continue.`,
        used,
        limit,
        requested,
      },
      { status: 402 }
    );
  }

  // ── Insert contacts ───────────────────────────────────────────────────────
  const rowsToInsert = toInsert.map((c) => ({
    campaign_id,
    name: c.name,
    phone: c.phone || null,
    email: c.email || null,
    tags: c.tags,
    notes: c.notes || null,
    status: "pending",
  }));

  const { error: insertError } = await db.from("contacts").insert(rowsToInsert);

  if (insertError) {
    // Insert failed — compensate by releasing the quota that claim_contact_quota
    // already incremented. release_contact_quota caps at 0 to prevent negatives.
    if (quota.reason !== "no_org") {
      await db.rpc("release_contact_quota", { p_owner_id: user.id, p_delta: toInsert.length });
    }
    logger.error({ err: insertError, correlationId, campaignId: campaign_id }, "contacts/import: DB insert failed");
    if (insertError.message.toLowerCase().includes("row-level security")) {
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
