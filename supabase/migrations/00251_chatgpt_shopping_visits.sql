-- ============================================================================
-- 00251: ChatGPT Shopping visits, from feed links tagged utm_medium=feed (#1283)
-- ============================================================================
-- A product URL in a merchant's feed tagged utm_source=chatgpt.com and
-- utm_medium=feed tells a visit from a ChatGPT Shopping product card apart
-- from one through a ChatGPT answer. Until now both were ChatGPT and nothing
-- read the medium. The AI source list (backend/src/lib/ai-sources.json,
-- version 3) gives ChatGPT a shopping surface: utm_medium = feed.
--
--   * ai_traffic_logs.source_surface: 'shopping' for a snippet visit from
--     ChatGPT whose landing URL's utm_medium is feed. The server decides it
--     from the URL it stores, so a cached older snippet's visits are marked
--     too. The visit stays source_platform = 'chatgpt.com', so ChatGPT's
--     totals don't change. The rows stored before are marked below, once,
--     from their URL.
--   * ga_ai_traffic_stats.medium and surface: GA4's session medium, which
--     the sync now reads, and the surface it marks, from the list as for the
--     snippet. One source can bring sessions of several mediums to one page
--     on one day, so the medium is part of a row's key. Rows synced before
--     have none: the sync replaces them as it re-reads their days (the last
--     few each day; all of them with backfillGaAiHistory.js).
--   * ai_traffic_merged (00176) also returns the visits by platform and
--     surface. Its platforms keep counting every visit, surfaces included.
--   * ga_platform_value (00177) also returns each platform's figures by
--     surface. Its platform rows keep counting every session, as before.
--
-- Deploy the server right after applying this: the running server's Google
-- Analytics sync upserts on the old key, which is gone, so its brands fail
-- to sync until then (the next run re-reads the last few days). The new
-- server writes source_surface, so it must not run before this.

-- ─── The snippet's visits ───────────────────────────────────────────────────

alter table public.ai_traffic_logs
  add column if not exists source_surface text
    constraint ai_traffic_logs_source_surface_check
      check (source_surface is null or source_surface in ('shopping'));

comment on column public.ai_traffic_logs.source_surface is
  'The part of the AI source the visit came through, from the AI source list (backend/src/lib/ai-sources.json): shopping for a ChatGPT Shopping product card (a ChatGPT visit whose landing URL has utm_medium=feed). Null for the source''s ordinary links. The visit still counts under source_platform (00251).';

-- Visits stored before: a ChatGPT visit whose landing URL's first
-- utm_medium parameter (its name in any case) is feed, in any case, as the
-- server reads a new visit's URL (landingMedium in aiSources.js).
update public.ai_traffic_logs l
set source_surface = 'shopping'
where l.source_platform = 'chatgpt.com'
  and l.source_surface is null
  and l.url ilike '%utm_medium%'
  and (
    select lower(substring(p.pair from '=(.*)$'))
    from regexp_split_to_table(substring(l.url from '\?([^#]*)'), '&') with ordinality as p (pair, n)
    where lower(split_part(p.pair, '=', 1)) = 'utm_medium'
    order by p.n
    limit 1
  ) = 'feed';

-- ─── Google Analytics' sessions ─────────────────────────────────────────────

alter table public.ga_ai_traffic_stats
  add column if not exists medium text;

alter table public.ga_ai_traffic_stats
  add column if not exists surface text
    constraint ga_ai_traffic_stats_surface_check
      check (surface is null or surface in ('shopping'));

comment on column public.ga_ai_traffic_stats.medium is
  'GA4''s session medium, as reported (feed, referral, (none), …). Part of the row''s key. Null on rows synced before the sync read it (00251), which a re-read of their day replaces.';

comment on column public.ga_ai_traffic_stats.surface is
  'The part of the platform the sessions came through, from the AI source list (backend/src/lib/ai-sources.json): shopping for ChatGPT Shopping (chatgpt.com with medium feed). Null otherwise. The sessions still count under platform (00251).';

-- The key adds the medium. A null medium is one key, not many, so the rows
-- from before stay one per (date, source, entry URL) until they're replaced.
alter table public.ga_ai_traffic_stats
  drop constraint if exists ga_ai_traffic_stats_brand_id_date_source_landing_page_query_key;

alter table public.ga_ai_traffic_stats
  drop constraint if exists ga_ai_traffic_stats_brand_date_source_medium_page_key;

alter table public.ga_ai_traffic_stats
  add constraint ga_ai_traffic_stats_brand_date_source_medium_page_key
    unique nulls not distinct (brand_id, date, source, medium, landing_page_query);

-- ─── The AI Traffic page's visits, with their surfaces ──────────────────────

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
      l.source_surface as surface,
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
      g.surface,
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
    select day, platform, surface, page, 1::bigint as visits, 'snippet' as origin from snippet
    union all
    select day, platform, surface, page, visits::bigint, 'analytics' from analytics
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
    -- Part of their platform's visits above, never added to them.
    'surfaces', (
      select coalesce(jsonb_agg(jsonb_build_object('platform', platform, 'surface', surface, 'visits', visits) order by visits desc, platform, surface), '[]'::jsonb)
      from (
        select platform, surface, sum(visits) as visits
        from merged
        where surface is not null
        group by platform, surface
      ) t
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
  'AI Traffic (AT-004, spec §5.2): AI-referred visits for one brand in a window, from the tracking snippet on days it was active and from Google Analytics on other whole days, never summed. Returns visits, the snippet''s pageviews, the days Analytics filled, and visits by platform, by platform and surface (ChatGPT Shopping, 00251; part of the platform''s visits), page and day. Security invoker: RLS decides the brand.';

-- ─── Per AI platform, with its surfaces, for the Referrals by Platform table ─

-- A new column in the result: dropped and made again, with its grants.
drop function if exists public.ga_platform_value(uuid, date, date);

create function public.ga_platform_value(
  p_brand_id uuid,
  p_since date,
  p_until date
)
returns table (
  platform text,
  sessions bigint,
  engaged_sessions bigint,
  key_events bigint,
  key_event_sessions bigint,
  surfaces jsonb
)
language sql
stable
security invoker
set search_path to 'public'
as $$
  with by_surface as (
    select
      coalesce(gat.platform, gat.source) as platform,
      gat.surface,
      coalesce(sum(gat.sessions), 0)::bigint as sessions,
      coalesce(sum(gat.engaged_sessions), 0)::bigint as engaged_sessions,
      coalesce(sum(gat.key_events), 0)::bigint as key_events,
      coalesce(sum(gat.key_event_sessions), 0)::bigint as key_event_sessions
    from public.ga_ai_traffic_stats gat
    where gat.brand_id = p_brand_id
      and gat.date >= coalesce(p_since, '-infinity'::date)
      and gat.date <= p_until
    group by 1, 2
  )
  select
    s.platform,
    sum(s.sessions)::bigint,
    sum(s.engaged_sessions)::bigint,
    sum(s.key_events)::bigint,
    sum(s.key_event_sessions)::bigint,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'surface', s.surface,
          'sessions', s.sessions,
          'engaged_sessions', s.engaged_sessions,
          'key_events', s.key_events,
          'key_event_sessions', s.key_event_sessions
        )
        order by s.surface
      ) filter (where s.surface is not null),
      '[]'::jsonb
    )
  from by_surface s
  group by s.platform;
$$;

revoke all on function public.ga_platform_value(uuid, date, date) from public, anon;
grant execute on function public.ga_platform_value(uuid, date, date) to authenticated, service_role;

comment on function public.ga_platform_value(uuid, date, date) is
  'AI Traffic (AT-005): Google Analytics'' sessions, engaged sessions, key events and sessions with a key event per AI platform, and the same per surface of the platform (ChatGPT Shopping, 00251; part of the platform''s figures), for one brand between two days (p_since null = from the start). Security invoker: RLS decides the brand.';

notify pgrst, 'reload schema';
