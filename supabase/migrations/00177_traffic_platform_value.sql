-- ============================================================================
-- 00177: what AI visitors are worth, per platform and against Google organic (AT-005)
-- ============================================================================
-- Spec §1 question 2, "are those visitors worth anything?": engagement, key
-- events and revenue per AI platform, compared with Google organic (F6).
--
--   * ga_channel_stats: Google Analytics' sessions per day and default
--     channel group (Organic Search, Direct, AI Assistant, …) for every
--     mapped brand, synced with the AI report. Organic Search is the
--     comparison the AI Traffic page draws; a dozen rows a day per brand.
--   * key_event_sessions: the sessions with at least one key event, from
--     GA4's session key event rate. Key events alone can't give a rate — one
--     session can hold several — so the rate is this count over sessions,
--     the figure GA4's own reports show. Added to the AI and page tables
--     too; rows synced before it stay 0 until the history backfill
--     (backfillGaAiHistory.js) re-reads them.
--   * ga_traffic_totals (00174) also returns the AI sessions with a key
--     event, the AI purchase revenue, and Google organic's sessions, engaged
--     sessions and sessions with a key event, for the KPI cards.
--   * ga_platform_value: per AI platform, Analytics' sessions, engaged
--     sessions, key events and sessions with a key event, for the Referrals
--     by Platform table.
--
-- Both functions read as the caller (security invoker), so the tables'
-- member select policies decide whose brand they see.

-- ─── Channel totals ─────────────────────────────────────────────────────────

create table if not exists public.ga_channel_stats (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  date date not null,
  channel text not null,
  sessions integer not null default 0,
  engaged_sessions integer not null default 0,
  key_events integer not null default 0,
  key_event_sessions integer not null default 0,
  total_users integer not null default 0,
  transactions integer not null default 0,
  purchase_revenue double precision not null default 0,
  engagement_duration_seconds integer not null default 0,
  created_at timestamptz not null default now(),
  unique (brand_id, date, channel)
);

create index if not exists ga_channel_stats_brand_date_idx
  on public.ga_channel_stats (brand_id, date desc);

alter table public.ga_channel_stats enable row level security;

create policy "ga_channel_stats: member select" on public.ga_channel_stats
  for select using (
    brand_id in (
      select b.id
      from public.brands b
      join public.profiles p on p.organization_id = b.organization_id
      where p.id = auth.uid()
    )
  );

grant select on public.ga_channel_stats to authenticated;

comment on table public.ga_channel_stats is
  'Google Analytics sessions per day and default channel group, per brand (AT-005). Written by the GA sync with the service role; Organic Search is the AI Traffic page''s comparison.';

-- ─── Sessions with a key event ──────────────────────────────────────────────

alter table public.ga_ai_traffic_stats
  add column if not exists key_event_sessions integer not null default 0;

alter table public.ga_page_stats
  add column if not exists key_event_sessions integer not null default 0;

comment on column public.ga_ai_traffic_stats.key_event_sessions is
  'Sessions with at least one key event (GA4 session key event rate × sessions), for a rate GA4''s reports agree with (AT-005).';

comment on column public.ga_page_stats.key_event_sessions is
  'Sessions with at least one key event (GA4 session key event rate × sessions), for a rate GA4''s reports agree with (AT-005).';

-- ─── The KPI cards' Analytics totals, with Google organic ───────────────────

drop function if exists public.ga_traffic_totals(uuid, date, date);

create function public.ga_traffic_totals(
  p_brand_id uuid,
  p_since date,
  p_until date
)
returns table (
  sessions bigint,
  ai_sessions bigint,
  ai_engaged_sessions bigint,
  ai_key_events bigint,
  ai_key_event_sessions bigint,
  ai_revenue double precision,
  organic_sessions bigint,
  organic_engaged_sessions bigint,
  organic_key_events bigint,
  organic_key_event_sessions bigint
)
language sql
stable
security invoker
set search_path to 'public'
as $$
  with ai as (
    select
      coalesce(sum(gat.sessions), 0)::bigint as sessions,
      coalesce(sum(gat.engaged_sessions), 0)::bigint as engaged_sessions,
      coalesce(sum(gat.key_events), 0)::bigint as key_events,
      coalesce(sum(gat.key_event_sessions), 0)::bigint as key_event_sessions,
      coalesce(sum(gat.purchase_revenue), 0)::double precision as revenue
    from public.ga_ai_traffic_stats gat
    where gat.brand_id = p_brand_id
      and gat.date >= coalesce(p_since, '-infinity'::date)
      and gat.date <= p_until
  ),
  organic as (
    select
      coalesce(sum(gcs.sessions), 0)::bigint as sessions,
      coalesce(sum(gcs.engaged_sessions), 0)::bigint as engaged_sessions,
      coalesce(sum(gcs.key_events), 0)::bigint as key_events,
      coalesce(sum(gcs.key_event_sessions), 0)::bigint as key_event_sessions
    from public.ga_channel_stats gcs
    where gcs.brand_id = p_brand_id
      and gcs.channel = 'Organic Search'
      and gcs.date >= coalesce(p_since, '-infinity'::date)
      and gcs.date <= p_until
  )
  select
    (
      select coalesce(sum(gps.sessions), 0)::bigint
      from public.ga_page_stats gps
      where gps.brand_id = p_brand_id
        and gps.date >= coalesce(p_since, '-infinity'::date)
        and gps.date <= p_until
    ),
    ai.sessions,
    ai.engaged_sessions,
    ai.key_events,
    ai.key_event_sessions,
    ai.revenue,
    organic.sessions,
    organic.engaged_sessions,
    organic.key_events,
    organic.key_event_sessions
  from ai, organic;
$$;

revoke all on function public.ga_traffic_totals(uuid, date, date) from public, anon;
grant execute on function public.ga_traffic_totals(uuid, date, date) to authenticated, service_role;

comment on function public.ga_traffic_totals(uuid, date, date) is
  'AI Traffic KPIs (AT-017, AT-005): all sessions; the AI channel''s sessions, engaged sessions, key events, sessions with a key event and purchase revenue; and Google organic''s sessions, engaged sessions, key events and sessions with a key event — for one brand between two days (p_since null = from the start). Security invoker: RLS decides the brand.';

-- ─── Per AI platform, for the Referrals by Platform table ───────────────────

create or replace function public.ga_platform_value(
  p_brand_id uuid,
  p_since date,
  p_until date
)
returns table (
  platform text,
  sessions bigint,
  engaged_sessions bigint,
  key_events bigint,
  key_event_sessions bigint
)
language sql
stable
security invoker
set search_path to 'public'
as $$
  select
    coalesce(gat.platform, gat.source) as platform,
    coalesce(sum(gat.sessions), 0)::bigint,
    coalesce(sum(gat.engaged_sessions), 0)::bigint,
    coalesce(sum(gat.key_events), 0)::bigint,
    coalesce(sum(gat.key_event_sessions), 0)::bigint
  from public.ga_ai_traffic_stats gat
  where gat.brand_id = p_brand_id
    and gat.date >= coalesce(p_since, '-infinity'::date)
    and gat.date <= p_until
  group by 1;
$$;

revoke all on function public.ga_platform_value(uuid, date, date) from public, anon;
grant execute on function public.ga_platform_value(uuid, date, date) to authenticated, service_role;

comment on function public.ga_platform_value(uuid, date, date) is
  'AI Traffic (AT-005): Google Analytics'' sessions, engaged sessions, key events and sessions with a key event per AI platform, for one brand between two days (p_since null = from the start). Security invoker: RLS decides the brand.';

notify pgrst, 'reload schema';
