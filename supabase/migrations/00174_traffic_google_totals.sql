-- ============================================================================
-- 00174: Google Analytics and Search Console totals for the AI Traffic KPIs
-- ============================================================================
-- The AI Traffic page's second row of KPI cards (AT-017, spec §3.2) reads
-- Google: AI share of traffic and engaged visits and key events from AI
-- (Analytics), and Google clicks (Search Console). The tables hold a row per
-- page or query per day — up to 5,000 pages a day for Analytics — so the
-- sums are taken here rather than shipped to the browser row by row.
--
-- Both read as the caller (security invoker), so the tables' member select
-- policies decide whose brand they see, and both are granted to signed-in
-- members: the page calls them through the member's session. A null p_since
-- reads from the start (all time).

-- ─── Analytics: all sessions, and the AI channel's ─────────────────────────

create or replace function public.ga_traffic_totals(
  p_brand_id uuid,
  p_since date,
  p_until date
)
returns table (
  sessions bigint,
  ai_sessions bigint,
  ai_engaged_sessions bigint,
  ai_key_events bigint
)
language sql
stable
security invoker
set search_path to 'public'
as $$
  select
    (
      select coalesce(sum(gps.sessions), 0)::bigint
      from public.ga_page_stats gps
      where gps.brand_id = p_brand_id
        and gps.date >= coalesce(p_since, '-infinity'::date)
        and gps.date <= p_until
    ),
    coalesce(sum(gat.sessions), 0)::bigint,
    coalesce(sum(gat.engaged_sessions), 0)::bigint,
    coalesce(sum(gat.key_events), 0)::bigint
  from public.ga_ai_traffic_stats gat
  where gat.brand_id = p_brand_id
    and gat.date >= coalesce(p_since, '-infinity'::date)
    and gat.date <= p_until;
$$;

-- ─── Search Console: clicks, against the period before ─────────────────────
--
-- Google reports with about a two-day delay, so a short range ending today
-- would read as zero clicks. With p_latest the window ends on the latest day
-- Google has reported instead, keeping its length, and the result says which
-- days it covers so the card can label them (spec §3.01). The previous
-- period is the same length, just before; all time has none.

create or replace function public.gsc_click_totals(
  p_brand_id uuid,
  p_since date,
  p_until date,
  p_latest boolean default false
)
returns table (
  since date,
  until date,
  clicks bigint,
  prev_clicks bigint,
  last_date date
)
language sql
stable
security invoker
set search_path to 'public'
as $$
  with latest as (
    select max(g.date) as d
    from public.gsc_query_stats g
    where g.brand_id = p_brand_id
  ),
  w as (
    select
      case
        when p_latest and l.d < p_until then l.d - (p_until - p_since)
        else p_since
      end as since,
      case when p_latest and l.d < p_until then l.d else p_until end as until,
      l.d as last_date
    from latest l
  )
  select
    w.since,
    w.until,
    (
      select coalesce(sum(g.clicks), 0)::bigint
      from public.gsc_query_stats g
      where g.brand_id = p_brand_id
        and g.date >= coalesce(w.since, '-infinity'::date)
        and g.date <= w.until
    ),
    case
      when w.since is null then null
      else (
        select coalesce(sum(g.clicks), 0)::bigint
        from public.gsc_query_stats g
        where g.brand_id = p_brand_id
          and g.date >= w.since - (w.until - w.since) - 1
          and g.date < w.since
      )
    end,
    w.last_date
  from w;
$$;

revoke all on function public.ga_traffic_totals(uuid, date, date) from public, anon;
grant execute on function public.ga_traffic_totals(uuid, date, date) to authenticated, service_role;

revoke all on function public.gsc_click_totals(uuid, date, date, boolean) from public, anon;
grant execute on function public.gsc_click_totals(uuid, date, date, boolean)
  to authenticated, service_role;

comment on function public.ga_traffic_totals(uuid, date, date) is
  'AI Traffic KPIs (AT-017): all sessions and the AI channel''s sessions, engaged sessions and key events for one brand between two days (p_since null = from the start). Security invoker: RLS decides the brand.';

comment on function public.gsc_click_totals(uuid, date, date, boolean) is
  'AI Traffic KPIs (AT-017): Search Console clicks for one brand and the same-length period before. p_latest ends the window on the latest reported day. Security invoker: RLS decides the brand.';

notify pgrst, 'reload schema';
