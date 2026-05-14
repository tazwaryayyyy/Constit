-- ============================================================
-- Constit — Schema Migrations (run after schema.sql)
-- Run these in order in the Supabase SQL editor
-- ============================================================

-- ── Migration 1: Index on campaigns.user_id (dashboard perf) ─────────────
-- Fixes slow dashboard queries for users with many campaigns.
CREATE INDEX IF NOT EXISTS idx_campaigns_user_id_created
  ON campaigns (user_id, created_at DESC);

-- ── Migration 2: Unique constraint for contact dedup ─────────────────────
-- App-level dedup fails under concurrent imports. DB constraint is the truth.
-- Partial index: only enforces uniqueness when phone is not null.
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_campaign_phone_unique
  ON contacts (campaign_id, phone)
  WHERE phone IS NOT NULL;

-- ── Migration 3: deliveries table (Twilio send tracking) ─────────────────
-- Tracks every SMS send attempt per contact, with status updates via webhook.
CREATE TABLE IF NOT EXISTS deliveries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id     uuid REFERENCES campaigns(id) ON DELETE CASCADE,
  contact_id      uuid REFERENCES contacts(id) ON DELETE CASCADE,
  message_id      uuid REFERENCES messages(id) ON DELETE SET NULL,
  twilio_sid      text,                                 -- Twilio MessageSid (for webhook matching)
  status          text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'sending', 'sent', 'delivered', 'failed', 'undelivered')),
  error_code      text,                                 -- Twilio error code if failed
  error_message   text,
  segments_billed integer,
  sent_at         timestamptz DEFAULT now(),
  delivered_at    timestamptz,
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deliveries_campaign_id ON deliveries (campaign_id);
CREATE INDEX IF NOT EXISTS idx_deliveries_twilio_sid  ON deliveries (twilio_sid) WHERE twilio_sid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_deliveries_contact_id  ON deliveries (contact_id);

ALTER TABLE deliveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own deliveries" ON deliveries
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM campaigns c
      WHERE c.id = deliveries.campaign_id
      AND c.user_id = auth.uid()
    )
  );

-- ── Migration 4: replies table (inbound SMS via Twilio webhook) ───────────
-- Captures constituent replies for AI inbox classification.
CREATE TABLE IF NOT EXISTS replies (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id     uuid REFERENCES campaigns(id) ON DELETE CASCADE,
  contact_id      uuid REFERENCES contacts(id) ON DELETE SET NULL,
  from_phone      text NOT NULL,
  body            text NOT NULL,
  twilio_sid      text,
  -- AI classification: positive | negative | question | opt_out | unclassified
  intent          text DEFAULT 'unclassified'
    CHECK (intent IN ('positive', 'negative', 'question', 'opt_out', 'unclassified')),
  ai_summary      text,
  received_at     timestamptz DEFAULT now(),
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_replies_campaign_id  ON replies (campaign_id);
CREATE INDEX IF NOT EXISTS idx_replies_from_phone   ON replies (from_phone);
CREATE INDEX IF NOT EXISTS idx_replies_contact_id   ON replies (contact_id) WHERE contact_id IS NOT NULL;

ALTER TABLE replies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own replies" ON replies
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM campaigns c
      WHERE c.id = replies.campaign_id
      AND c.user_id = auth.uid()
    )
  );

-- ── Migration 5: organizations table (team workspaces) ───────────────────
CREATE TABLE IF NOT EXISTS organizations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  owner_id    uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  plan        text NOT NULL DEFAULT 'free'
    CHECK (plan IN ('free', 'pro', 'enterprise')),
  -- Usage counters (reset monthly)
  contacts_used_this_month  integer DEFAULT 0,
  contacts_limit            integer DEFAULT 500,
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Org members see their org" ON organizations
  FOR ALL USING (
    owner_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM org_members om
      WHERE om.org_id = organizations.id
      AND om.user_id = auth.uid()
    )
  );

-- ── Migration 6: org_members table (roles) ───────────────────────────────
CREATE TABLE IF NOT EXISTS org_members (
  id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id  uuid REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  role    text NOT NULL DEFAULT 'viewer'
    CHECK (role IN ('admin', 'editor', 'viewer')),
  joined_at timestamptz DEFAULT now(),
  UNIQUE (org_id, user_id)
);

ALTER TABLE org_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members see their own membership" ON org_members
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Org admins manage members" ON org_members
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM organizations o
      WHERE o.id = org_members.org_id
      AND o.owner_id = auth.uid()
    )
  );

-- ── Migration 7: Add org_id to campaigns (optional, nullable for solo users)
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES organizations(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_campaigns_org_id ON campaigns (org_id) WHERE org_id IS NOT NULL;

-- ── Migration 8: Stripe billing columns on organizations ─────────────────
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS stripe_customer_id   text;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS stripe_subscription_id text;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS subscription_status  text DEFAULT 'inactive'
  CHECK (subscription_status IN ('inactive', 'active', 'past_due', 'canceled'));

-- ── Migration 9: webhook_events dead-letter queue ─────────────────────────
-- Every received webhook is persisted here BEFORE processing.
-- If the business-logic write fails, the raw payload survives for manual retry.
-- Provider retries are absorbed by the UNIQUE constraint (idempotent receipts).
CREATE TABLE IF NOT EXISTS webhook_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider     TEXT NOT NULL,           -- 'twilio' or 'stripe'
  -- Twilio status callbacks: MessageSid:MessageStatus  (e.g. SMxxx:delivered)
  -- Twilio inbound replies:  MessageSid:inbound
  -- Stripe events:           Stripe event ID           (e.g. evt_1AbCDEF...)
  event_id     TEXT NOT NULL,
  payload      JSONB NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processed', 'failed')),
  processed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Prevents double-processing of the exact same webhook delivery.
CREATE UNIQUE INDEX IF NOT EXISTS idx_webhook_events_provider_event
  ON webhook_events (provider, event_id);

-- Operational index: find all unprocessed events for retry jobs.
CREATE INDEX IF NOT EXISTS idx_webhook_events_status_pending
  ON webhook_events (status, created_at)
  WHERE status != 'processed';

-- Only service role should access this table (ops, not end-users).
ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;
-- No user-facing SELECT policy: only accessible via service role key.

-- ── Migration 10: Simple usage increment (kept for backward compat) ──────────
-- Prefer claim_contact_quota (Migration 11) for all new writes. This function
-- is retained so any in-flight requests against the old schema continue to work.
CREATE OR REPLACE FUNCTION increment_contacts_used(p_owner_id UUID, p_delta INTEGER)
RETURNS VOID LANGUAGE SQL SECURITY INVOKER AS $$
  UPDATE organizations
  SET contacts_used_this_month = contacts_used_this_month + p_delta
  WHERE owner_id = p_owner_id;
$$;

-- ── Migration 11: Race-safe atomic quota claim ────────────────────────────────
-- SELECT ... FOR UPDATE serializes concurrent import requests on the same org row,
-- so two simultaneous imports can never both pass the limit check at the same time.
-- Returns JSONB indicating whether the import is allowed:
--   { "allowed": true,  "reason": "no_org" }               — solo user, no limit
--   { "allowed": true,  "used": N, "limit": N }            — within limit; counter incremented
--   { "allowed": false, "used": N, "limit": N, "requested": N } — would exceed limit
CREATE OR REPLACE FUNCTION claim_contact_quota(p_owner_id UUID, p_delta INTEGER)
RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE
  v_used  INTEGER;
  v_limit INTEGER;
BEGIN
  SELECT contacts_used_this_month, contacts_limit
    INTO v_used, v_limit
    FROM organizations
   WHERE owner_id = p_owner_id
     FOR UPDATE;     -- row-level lock: concurrent callers block here until we commit

  IF NOT FOUND THEN
    -- No org record means this is a solo user — no billing limit applies.
    RETURN jsonb_build_object('allowed', true, 'reason', 'no_org');
  END IF;

  IF v_used + p_delta > v_limit THEN
    RETURN jsonb_build_object(
      'allowed',   false,
      'used',      v_used,
      'limit',     v_limit,
      'requested', p_delta
    );
  END IF;

  -- Within limit: increment atomically inside this same transaction.
  UPDATE organizations
     SET contacts_used_this_month = contacts_used_this_month + p_delta
   WHERE owner_id = p_owner_id;

  RETURN jsonb_build_object(
    'allowed',   true,
    'used',      v_used,
    'limit',     v_limit,
    'requested', p_delta
  );
END;
$$;

-- Compensating transaction: call this if the contacts INSERT fails after
-- claim_contact_quota returned allowed=true, to undo the optimistic increment.
-- GREATEST(0, ...) guards against negative counts from any double-release.
CREATE OR REPLACE FUNCTION release_contact_quota(p_owner_id UUID, p_delta INTEGER)
RETURNS VOID LANGUAGE SQL SECURITY INVOKER AS $$
  UPDATE organizations
     SET contacts_used_this_month = GREATEST(0, contacts_used_this_month - p_delta)
   WHERE owner_id = p_owner_id;
$$;

-- ── Migration 12: retry_count on webhook_events ───────────────────────────────
-- Tracks how many times the hourly retry cron has re-attempted a failed event.
-- The cron stops retrying once retry_count reaches MAX_RETRIES (3).
ALTER TABLE webhook_events ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0;
