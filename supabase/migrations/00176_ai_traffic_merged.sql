-- ============================================================================
-- 00176: AI traffic from the snippet and Google Analytics, day by day (AT-004)
-- ============================================================================
-- The AI Traffic page counted only the tracking snippet, so a brand saw no
-- history from before it installed the snippet, and nothing for days the
-- snippet was missing, although Google Analytics had those visits. Spec §5.2:
-- the snippet is the primary source for days when it was active; Google
-- Analytics fills the history before installation and any days the snippet
-- was missing. The two are never added together.
--
-- A UTC day is the snippet's when the brand has at least one snippet visit
-- that day; any other day is Google Analytics' (its AI sessions, as
-- ga_ai_traffic_stats stores them). Both now name engines by the same keys
-- (00175), so a day's platforms read the same whichever origin it came from.
--
--   * The window is [p_from, p_to] (p_to included unless p_to_inclusive is
--     false, as the previous period ends where the current one starts; a
--     null p_from reads from the start, a null p_to up to now). Snippet visits are counted by their
--     time; Analytics counts whole days, so it fills only the days fully
--     inside the window — the partial first day is left to the snippet — up
--     to p_to's day, today included.
--   * p_analytics = false reads the snippet alone: the 24-hour range trends
--     hour by hour, which Analytics can't fill.
--   * Pages are keyed by normalize_page_path (path, no query or trailing
--     slash), so a snippet URL and an Analytics landing page name one page.
--
-- Returns one jsonb value — no row cap applies — with the visits, the
-- snippet's pageviews in the window, the days Analytics filled, and the
-- visits by platform, by page and by day and platform. Security invoker: the
-- tables' member select policies decide whose brand it reads.

create or replace function public.ai_traffic_merged(
  p_brand_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_to_inclusive boolean default true,
  p_analytics boolean default true
)
returns jsonb
language sql
stable
security invoker
set search_path to 'public'
as $$
  with bounds as (
    select
      -- The first whole UTC day inside the window.
      case
        when p_from is null then null
        when (p_from at time zone 'utc')::time = time '00:00' then (p_from at time zone 'utc')::date
        else (p_from at time zone 'utc')::date + 1
      end as first_day,
      coalesce((p_to at time zone 'utc')::date, (now() at time zone 'utc')::date) as last_day
  ),
  snippet as (
    select
      (l.created_at at time zone 'utc')::date as day,
      coalesce(nullif(l.source_platform, ''), 'unknown') as platform,
      public.normalize_page_path(l.url) as page
    from public.ai_traffic_logs l
    where l.brand_id = p_brand_id
      and l.visit_of is null
      and l.created_at >= coalesce(p_from, '-infinity'::timestamptz)
      and (p_to is null or l.created_at < p_to or (p_to_inclusive and l.created_at = p_to))
  ),
  -- Days the snippet was active, over the whole day, not just the window.
  snippet_days as (
    select distinct (l.created_at at time zone 'utc')::date as day
    from public.ai_traffic_logs l, bounds b
    where p_analytics
      and l.brand_id = p_brand_id
      and l.visit_of is null
      and l.created_at >= coalesce((b.first_day::timestamp at time zone 'utc'), '-infinity'::timestamptz)
      and l.created_at < ((b.last_day + 1)::timestamp at time zone 'utc')
  ),
  analytics as (
    select
      g.date as day,
      coalesce(g.platform, g.source) as platform,
      public.normalize_page_path(g.landing_page) as page,
      g.sessions as visits
    from public.ga_ai_traffic_stats g, bounds b
    where p_analytics
      and g.brand_id = p_brand_id
      and g.sessions > 0
      and g.date >= coalesce(b.first_day, '-infinity'::date)
      and g.date <= b.last_day
      and not exists (select 1 from snippet_days s where s.day = g.date)
  ),
  merged as (
    select day, platform, page, 1::bigint as visits, 'snippet' as origin from snippet
    union all
    select day, platform, page, visits::bigint, 'analytics' from analytics
  )
  select jsonb_build_object(
    'visits', (select coalesce(sum(visits), 0) from merged),
    'pageviews', (
      select count(*)
      from public.ai_traffic_logs l
      where l.brand_id = p_brand_id
        and l.created_at >= coalesce(p_from, '-infinity'::timestamptz)
        and (p_to is null or l.created_at < p_to or (p_to_inclusive and l.created_at = p_to))
    ),
    'analytics_days', (
      select coalesce(jsonb_agg(distinct day order by day), '[]'::jsonb) from analytics
    ),
    'platforms', (
      select coalesce(jsonb_agg(jsonb_build_object('platform', platform, 'visits', visits) order by visits desc, platform), '[]'::jsonb)
      from (select platform, sum(visits) as visits from merged group by platform) t
    ),
    'pages', (
      select coalesce(jsonb_agg(jsonb_build_object('page', page, 'visits', visits) order by visits desc, page), '[]'::jsonb)
      from (select page, sum(visits) as visits from merged group by page) t
    ),
    'days', (
      select coalesce(jsonb_agg(jsonb_build_object('day', day, 'platform', platform, 'visits', visits) order by day, platform), '[]'::jsonb)
      from (select day, platform, sum(visits) as visits from merged group by day, platform) t
    )
  );
$$;

revoke all on function public.ai_traffic_merged(uuid, timestamptz, timestamptz, boolean, boolean)
  from public, anon;
grant execute on function public.ai_traffic_merged(uuid, timestamptz, timestamptz, boolean, boolean)
  to authenticated, service_role;

comment on function public.ai_traffic_merged(uuid, timestamptz, timestamptz, boolean, boolean) is
  'AI Traffic (AT-004, spec §5.2): AI-referred visits for one brand in a window, from the tracking snippet on days it was active and from Google Analytics on other whole days, never summed. Returns visits, the snippet''s pageviews, the days Analytics filled, and visits by platform, page and day. Security invoker: RLS decides the brand.';

notify pgrst, 'reload schema';
