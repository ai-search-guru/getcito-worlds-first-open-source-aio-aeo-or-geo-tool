-- ============================================================================
-- 00286: conversions from AI visits, as the AI Traffic snippet sees them (CE-017)
-- ============================================================================
-- The snippet counts AI-referred landings (ai_traffic_logs). With conversions
-- on, it also follows a visitor who came from an AI assistant through the
-- site to a goal (a signup, a demo form, an order…), so the Content Editor
-- can show what a page earns from AI visits, and the journeys that got there.
--
--   * Off by default, per brand (`conversions_enabled`). A brand that leaves
--     it off sends nothing new: the snippet keeps nothing in the browser, as
--     it always has.
--   * `conversions_consent`: 'wait' (default) keeps the visitor's id only once
--     the site says the visitor agreed (its consent banner, or Google Consent
--     Mode); 'always' keeps it at once, for sites whose own banner covers it.
--     The snippet reads it from its install tag; the server keeps it for the
--     Settings page.
--   * `ai_traffic_events`: a journey's pageviews and its conversions. One
--     visitor id per browser, random and first-party: never the IP address,
--     never a name or an email. Each row carries the first AI visit it is
--     credited to (first touch, within 30 days), so a journey reads without
--     joining the landing logs.
--   * `url` is the page without its query string or fragment: a thank-you
--     page's ?email=… never gets in, nor a path segment holding an email
--     (stored as "[email]").
--   * `order_ref`: a hash of the brand and an order's own id at the shop
--     (Shopify's pixel, a site's call), once per visitor, so an order sent
--     twice counts once; only ever compared, so the id itself isn't kept.
--     Per visitor, not per brand: the tracking code is public, and an order
--     id sent first by anyone else must not shut the real one out.
--   * The server stores at most a few hundred pageviews per visitor id in
--     the window and a few conversions a day, so a journey's reads stay
--     bounded (routes/traffic.js).
--   * `page_key` and `first_key`: the pages' keys, made once on insert, for
--     the journeys' reads.
--   * Members read their brands' events; only the server writes them.

alter table public.brands
  add column if not exists conversions_enabled boolean not null default false,
  add column if not exists conversions_consent text not null default 'wait'
    check (conversions_consent in ('wait', 'always'));

comment on column public.brands.conversions_enabled is
  'CE-017 (00286): the AI Traffic snippet follows AI visitors to conversions (ai_traffic_events). Off by default.';
comment on column public.brands.conversions_consent is
  'CE-017 (00286): ''wait'' keeps the snippet''s visitor id only after the site''s consent, ''always'' at once.';

create table if not exists public.ai_traffic_events (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  visitor_id text not null check (visitor_id ~ '^[A-Za-z0-9_-]{16,64}$'),
  kind text not null check (kind in ('page', 'conversion')),
  url text not null check (char_length(url) between 1 and 2048),
  goal text check (goal in ('signup', 'demo', 'order', 'booking', 'newsletter', 'custom')),
  -- The form's or the call's own name ("pricing-demo"), never what was typed in it.
  label text check (label is null or char_length(label) between 1 and 80),
  origin text check (origin in ('call', 'form', 'shopify')),
  value numeric(14, 2) check (value is null or value >= 0),
  currency text check (currency is null or currency ~ '^[A-Z]{3}$'),
  units integer check (units is null or units between 0 and 100000),
  order_ref text check (order_ref is null or char_length(order_ref) between 1 and 128),
  first_source text not null check (char_length(first_source) between 1 and 64),
  first_url text not null check (char_length(first_url) between 1 and 2048),
  first_at timestamptz not null,
  occurred_at timestamptz not null default now(),
  -- The pages' keys as journeys read them (lower(normalize_page_path), as in
  -- 00209 / 00210): made once when the row is stored, so a journey's reads
  -- (00287, 00288) compare keys rather than work each address out again.
  page_key text generated always as (lower(public.normalize_page_path(url))) stored,
  first_key text generated always as (lower(public.normalize_page_path(first_url))) stored,
  -- A conversion says what it was and where it came from; a pageview neither.
  constraint ai_traffic_events_kind check (
    (kind = 'conversion' and goal is not null and origin is not null)
    or (kind = 'page' and goal is null and origin is null and order_ref is null)
  )
);

-- A database that ran this file before the keys were added gets them, and
-- loses the brand-time index nothing reads.
alter table public.ai_traffic_events
  add column if not exists page_key text
    generated always as (lower(public.normalize_page_path(url))) stored,
  add column if not exists first_key text
    generated always as (lower(public.normalize_page_path(first_url))) stored;
drop index if exists public.ai_traffic_events_brand_time;

-- An order counts once however often its visitor's browser sends it.
create unique index if not exists ai_traffic_events_order
  on public.ai_traffic_events (brand_id, visitor_id, order_ref)
  where order_ref is not null;

create index if not exists ai_traffic_events_journey
  on public.ai_traffic_events (brand_id, visitor_id, occurred_at);

alter table public.ai_traffic_events enable row level security;
revoke all on table public.ai_traffic_events from anon, authenticated;
grant select on table public.ai_traffic_events to authenticated;
grant all on table public.ai_traffic_events to service_role;

drop policy if exists "ai_traffic_events: member select" on public.ai_traffic_events;
create policy "ai_traffic_events: member select"
  on public.ai_traffic_events
  for select
  using (
    brand_id in (
      select b.id from public.brands b
      join public.profiles p on p.organization_id = b.organization_id
      where p.id = auth.uid()
    )
  );

comment on table public.ai_traffic_events is
  'CE-017 (00286): journeys of visitors who came from an AI assistant, as the AI Traffic snippet sends them with conversions on: pageviews and conversions (goal, value, units; an order once by the hash of its id, order_ref), each credited to the first AI visit (first_source, first_url, first_at). A random first-party visitor id; no IP, name or email. Members read; the server writes.';

notify pgrst, 'reload schema';
