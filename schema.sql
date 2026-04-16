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
  id          uuid primary key default gen_random_uuid(),
  campaign_id uuid references campaigns(id) on delete cascade,
  name        text not null,
  phone       text,
  email       text,
  tags        text[] default '{}',
  status      text default 'pending'
    check (status in ('pending', 'contacted', 'replied', 'opted_out')),
  notes       text,
  created_at  timestamptz default now()
);

-- GIN index on tags for fast @> queries
create index on contacts using gin(tags);

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
-- performance_score: null until an A/B test picks a winner
-- sms_char_count stored at write time — never trust the AI length
create table messages (
  id              uuid primary key default gen_random_uuid(),
  campaign_id     uuid references campaigns(id) on delete cascade,
  tone            text not null,
  sms             text not null,
  sms_char_count  integer generated always as (char_length(sms)) stored,
  long_text       text,
  script          text,
  call_to_action  text,
  selected        boolean default false,
  performance_score float default null,
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

-- ── Volunteers ───────────────────────────────────────────────
create table volunteers (
  id          uuid primary key default gen_random_uuid(),
  campaign_id uuid references campaigns(id) on delete cascade,
  name        text not null,
  contact     text,
  role        text default 'volunteer'
    check (role in ('manager', 'organizer', 'volunteer'))
);

alter table volunteers enable row level security;
create policy "Users see own volunteers" on volunteers
  for all using (
    exists (
      select 1 from campaigns c
      where c.id = volunteers.campaign_id
      and c.user_id = auth.uid()
    )
  );

-- ── Tasks ────────────────────────────────────────────────────
create table tasks (
  id           uuid primary key default gen_random_uuid(),
  volunteer_id uuid references volunteers(id) on delete cascade,
  message_id   uuid references messages(id) on delete set null,
  contact_id   uuid references contacts(id) on delete cascade,
  status       text default 'pending'
    check (status in ('pending', 'in_progress', 'done', 'failed')),
  created_at   timestamptz default now(),
  completed_at timestamptz
);

alter table tasks enable row level security;
create policy "Users see own tasks" on tasks
  for all using (
    exists (
      select 1 from volunteers v
      join campaigns c on c.id = v.campaign_id
      where v.id = tasks.volunteer_id
      and c.user_id = auth.uid()
    )
  );
