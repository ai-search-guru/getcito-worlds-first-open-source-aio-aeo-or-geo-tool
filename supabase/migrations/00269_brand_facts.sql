-- ============================================================================
-- 00269: Quality phase 2, CE-047 — a brand's facts, read from its own site
-- ============================================================================
-- Trust gives 10 points for a page consistent with the brand's facts (Quality
-- spec §10): its prices and plans, its trial, when it was founded, and the
-- claims it makes of itself (awards, certifications), read from the brand's
-- own pricing, About and product pages. The server reads them when someone
-- first asks and again each week; a person approves each one, and only the
-- approved ones are compared with a page.
--
--   * brand_facts: one row per fact, by what it is about (`slot`: "price of
--     the Pro plan, in USD, a month") and its value (`value_key`: "49.00").
--     `quote` is the page's own words, which hold the value: the server
--     keeps a fact only when its quote is on the page word for word, and
--     reads the value from it by rule. A new value in a slot is a new
--     pending fact: the person approves the change. An approved fact no
--     longer on the page is marked gone (`gone_at`) and left out of the
--     check; the server removes it after 30 days.
--   * brand_fact_pages: the pages read, one per kind, with a hash of their
--     text: an unchanged page isn't sent to the model again. No page text is
--     kept.
--
-- Members read the facts and change only their status (approve or reject),
-- as themselves; everything else is the server's. brand_fact_pages is
-- server-only.

create table if not exists public.brand_facts (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  kind text not null check (kind in ('price', 'trial', 'founded', 'claim')),
  slot text not null check (char_length(slot) between 1 and 300),
  value jsonb not null default '{}'::jsonb
    check (jsonb_typeof(value) = 'object' and octet_length(value::text) <= 1024),
  value_key text not null check (char_length(value_key) between 1 and 300),
  quote text not null check (char_length(quote) between 1 and 300),
  source_url text not null
    check (char_length(source_url) <= 2048 and source_url ~ '^https?://'),
  source_kind text not null check (source_kind in ('pricing', 'about', 'product')),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  gone_at timestamptz,
  unique (brand_id, slot, value_key),
  -- Each kind's value, as the server reads it from the fact's words.
  -- A key left out is a violation (a NULL check would pass), and a number
  -- out of range too, never a cast error.
  constraint brand_facts_kind_value_check check (
    coalesce(
      case kind
        when 'price' then
          jsonb_typeof(value -> 'amount') = 'number'
          and (value ->> 'amount')::numeric >= 0
          and coalesce(value ->> 'currency', '') ~ '^[A-Z]{3}$'
          and jsonb_typeof(value -> 'plan') = 'string'
        when 'trial' then
          jsonb_typeof(value -> 'days') = 'number'
          and (value ->> 'days')::numeric between 1 and 365
        when 'founded' then
          jsonb_typeof(value -> 'year') = 'number'
          and (value ->> 'year')::numeric between 1800 and 2100
        else true
      end,
      false
    )
  )
);

create index if not exists brand_facts_brand_status_idx
  on public.brand_facts (brand_id, status);

alter table public.brand_facts enable row level security;
revoke all on table public.brand_facts from anon, authenticated;
grant select on table public.brand_facts to authenticated;
-- A member changes a fact's status only: its value and words are the site's.
grant update (status, reviewed_by, reviewed_at) on table public.brand_facts to authenticated;
grant all on table public.brand_facts to service_role;

drop policy if exists "brand_facts: member select" on public.brand_facts;
create policy "brand_facts: member select"
  on public.brand_facts
  for select
  using (
    brand_id in (
      select b.id from public.brands b
      join public.profiles p on p.organization_id = b.organization_id
      where p.id = auth.uid()
    )
  );

drop policy if exists "brand_facts: member update" on public.brand_facts;
create policy "brand_facts: member update"
  on public.brand_facts
  for update
  using (
    brand_id in (
      select b.id from public.brands b
      join public.profiles p on p.organization_id = b.organization_id
      where p.id = auth.uid()
    )
  )
  with check (
    brand_id in (
      select b.id from public.brands b
      join public.profiles p on p.organization_id = b.organization_id
      where p.id = auth.uid()
    )
    and reviewed_by = auth.uid()
    and status in ('approved', 'rejected')
    and reviewed_at between now() - interval '1 minute' and now() + interval '1 minute'
  );

comment on table public.brand_facts is
  'Quality CE-047 (00269): a brand''s facts (prices, trial, founding year, claims) read from its own pricing, About and product pages, each kept with its words on the page; members approve or reject them, and only approved ones not gone from the site are compared with a page.';

create table if not exists public.brand_fact_pages (
  brand_id uuid not null references public.brands(id) on delete cascade,
  kind text not null check (kind in ('pricing', 'about', 'product')),
  url text check (url is null or char_length(url) <= 2048),
  status text not null check (status in ('ok', 'blocked', 'not_found', 'failed', 'missed')),
  text_hash text check (text_hash is null or text_hash ~ '^[0-9a-f]{16}$'),
  model text check (model is null or char_length(model) <= 100),
  checked_at timestamptz not null default now(),
  extracted_at timestamptz,
  primary key (brand_id, kind)
);

create index if not exists brand_fact_pages_checked_idx
  on public.brand_fact_pages (checked_at);

alter table public.brand_fact_pages enable row level security;
revoke all on table public.brand_fact_pages from anon, authenticated;
grant all on table public.brand_fact_pages to service_role;

comment on table public.brand_fact_pages is
  'Quality CE-047 (00269): the brand pages its facts were read from, one per kind, with a hash of their text (an unchanged page isn''t read by the model again) and when they were read. No page text is kept. Server-only.';

notify pgrst, 'reload schema';
