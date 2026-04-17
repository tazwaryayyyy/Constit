-- ============================================================
-- Constit — Supabase SQL Schema
-- Run this in the Supabase SQL editor in order
-- ============================================================

-- Enable UUID extension
create extension if not exists "pgcrypto";

-- ── Campaigns ────────────────────────────────────────────────
create table campaigns (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete cascade,
  name        text not null,
  issue       text not null,
  audience    text not null,
  goal        text not null,
  created_at  timestamptz default now()
);

alter table campaigns enable row level security;
create policy "Users see own campaigns" on campaigns
  for all using (auth.uid() = user_id);

-- ── Contacts ─────────────────────────────────────────────────
-- tags is a Postgres text array — filter with @> operator
create table contacts (
  id                 uuid primary key default gen_random_uuid(),
  campaign_id        uuid references campaigns(id) on delete cascade,
  name               text not null,
  phone              text,
  email              text,
  tags               text[] default '{}',
  status             text default 'pending'
    check (status in ('pending', 'contacted', 'replied', 'opted_out')),
  notes              text,
  last_contacted_at  timestamptz default null, -- set when status → contacted; enables "stale contacts" view
  created_at         timestamptz default now()
);

-- GIN index on tags for fast @> queries
create index on contacts using gin(tags);

-- Composite index: campaign page loads pending count on every render
-- (campaign_id, status) covers: WHERE campaign_id = $1 AND status = 'pending'
create index on contacts (campaign_id, status);

-- Composite index: import route queries existing phones per campaign for dup detection
create index on contacts (campaign_id, phone) where phone is not null;

alter table contacts enable row level security;
create policy "Users see own contacts" on contacts
  for all using (
    exists (
      select 1 from campaigns c
      where c.id = contacts.campaign_id
      and c.user_id = auth.uid()
    )
  );

-- ── Messages ─────────────────────────────────────────────────
-- sms_char_count stored at write time — never trust the AI length
create table messages (
  id              uuid primary key default gen_random_uuid(),
  campaign_id     uuid references campaigns(id) on delete cascade,
  tone            text not null,
  sms             text not null check (length(trim(sms)) > 0),
  sms_char_count  integer generated always as (char_length(sms)) stored,
  call_to_action  text,
  selected        boolean default false,
  created_at      timestamptz default now()
);

alter table messages enable row level security;
create policy "Users see own messages" on messages
  for all using (
    exists (
      select 1 from campaigns c
      where c.id = messages.campaign_id
      and c.user_id = auth.uid()
    )
  );

-- ── Activity Log ────────────────────────────────────────────
-- Lightweight audit trail: import, generate, export events.
create table activity_log (
  id          uuid primary key default gen_random_uuid(),
  campaign_id uuid references campaigns(id) on delete cascade,
  event       text not null,
  details     text,
  created_at  timestamptz default now()
);

alter table activity_log enable row level security;
create policy "Users see own activity" on activity_log
  for all using (
    exists (
      select 1 from campaigns c
      where c.id = activity_log.campaign_id
      and c.user_id = auth.uid()
    )
  );

-- ── Migration notes ─────────────────────────────────────────────────────────
-- If upgrading an existing DB from an earlier schema, run:
--   drop table if exists tasks;
--   drop table if exists volunteers;
--   alter table messages drop column if exists long_text;
--   alter table messages drop column if exists script;
--   alter table messages drop column if exists performance_score;
--   alter table messages add constraint messages_sms_nonempty check (length(trim(sms)) > 0);

