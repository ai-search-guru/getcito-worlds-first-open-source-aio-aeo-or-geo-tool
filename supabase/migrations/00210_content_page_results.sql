-- ============================================================================
-- 00210: results from AI visits per AI source, for the editor's Impact tab
-- ============================================================================
-- The Impact tab's "Results from AI visits" (Content Editor spec v2 §7,
-- CE-016) shows what visitors from AI assistants did after landing on the
-- page a draft optimizes, and which assistant sent them.
--
-- content_page_results(brand, page, days) returns one jsonb over the last N
-- whole UTC days, ending yesterday, as content_page_impact (00209) counts them:
--   * analytics: whether the brand has a Google Analytics property mapped;
--     conversions come only from it until the snippet records goals (CE-017);
--   * purchases: whether the property reported purchases in the window, on
--     any page or channel, so the tab shows orders and revenue even where
--     this page had none;
--   * sources: one row per AI source key (the AI source list's, 00175) with
--       - visits: AI-referred visits, by ai_traffic_merged's rule (00176):
--         the snippet on days it was active for the brand, Google Analytics
--         on other days, never both; they add up to the tab's AI visits;
--       - sessions, key_events, key_event_sessions, transactions, revenue:
--         Google Analytics' AI sessions that landed on the page, with their
--         key events, sessions with a key event (the rate, 00177), purchases
--         and purchase revenue, on every day of the window.
-- A page is one lower(normalize_page_path) key, as in 00209. Analytics rows
-- without a landing page are left out: normalize_page_path('') is '/'.
--
-- Security definer with an organization check, as content_page_impact, and
-- planned for each call's own values, as it is (plan_cache_mode).

create or replace function public.content_page_results(
  p_brand_id uuid,
  p_page text,
  p_days integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
set plan_cache_mode to 'force_custom_plan'
as $$
declare
  v_key text := lower(public.normalize_page_path(p_page));
  -- The last whole day.
  v_last_day date := (now() at time zone 'utc')::date - 1;
  v_day date;
  v_from timestamptz;
  v_until timestamptz;
  v_result jsonb;
begin
  if not exists (
    select 1 from public.brands b
    join public.profiles pf on pf.organization_id = b.organization_id
    where b.id = p_brand_id and pf.id = auth.uid()
  ) and auth.role() is distinct from 'service_role' then
    return null;
  end if;
  if p_days is null or p_days < 1 or p_days > 366 or p_page is null then
    raise exception 'content_page_results: a page and 1 to 366 days are needed'
      using errcode = '22023';
  end if;

  v_day := v_last_day - p_days + 1;
  v_from := v_day::timestamp at time zone 'utc';
  v_until := (v_last_day + 1)::timestamp at time zone 'utc';

  with snippet_days as (
    select distinct (l.created_at at time zone 'utc')::date as day
    from public.ai_traffic_logs l
    where l.brand_id = p_brand_id
      and l.visit_of is null
      and l.created_at >= v_from
      and l.created_at < v_until
  ),
  visits as (
    select coalesce(nullif(l.source_platform, ''), 'unknown') as platform, count(*)::bigint as n
    from public.ai_traffic_logs l
    where l.brand_id = p_brand_id
      and l.visit_of is null
      and l.created_at >= v_from
      and l.created_at < v_until
      and lower(public.normalize_page_path(l.url)) = v_key
    group by 1
    union all
    select coalesce(g.platform, g.source), sum(g.sessions)::bigint
    from public.ga_ai_traffic_stats g
    where g.brand_id = p_brand_id
      and g.sessions > 0
      and g.landing_page <> ''
      and g.date >= v_day
      and g.date <= v_last_day
      and lower(public.normalize_page_path(g.landing_page)) = v_key
      and not exists (select 1 from snippet_days s where s.day = g.date)
    group by 1
  ),
  analytics as (
    select
      coalesce(g.platform, g.source) as platform,
      sum(g.sessions)::bigint as sessions,
      sum(g.key_events)::bigint as key_events,
      sum(g.key_event_sessions)::bigint as key_event_sessions,
      sum(g.transactions)::bigint as transactions,
      coalesce(sum(g.purchase_revenue), 0)::numeric as revenue
    from public.ga_ai_traffic_stats g
    where g.brand_id = p_brand_id
      and g.landing_page <> ''
      and g.date >= v_day
      and g.date <= v_last_day
      and lower(public.normalize_page_path(g.landing_page)) = v_key
    group by 1
  ),
  sources as (
    select
      p.platform,
      coalesce(v.n, 0) as visits,
      coalesce(a.sessions, 0) as sessions,
      coalesce(a.key_events, 0) as key_events,
      coalesce(a.key_event_sessions, 0) as key_event_sessions,
      coalesce(a.transactions, 0) as transactions,
      coalesce(a.revenue, 0) as revenue
    from (select platform from visits union select platform from analytics) p
    left join (select platform, sum(n) as n from visits group by platform) v on v.platform = p.platform
    left join analytics a on a.platform = p.platform
  )
  select jsonb_build_object(
    'analytics', (
      select nullif(b.ga_property_id, '') is not null
      from public.brands b where b.id = p_brand_id
    ),
    'purchases', exists (
      select 1 from public.ga_ai_traffic_stats g
      where g.brand_id = p_brand_id
        and g.date >= v_day
        and g.date <= v_last_day
        and (g.transactions > 0 or g.purchase_revenue > 0)
    ) or exists (
      select 1 from public.ga_channel_stats c
      where c.brand_id = p_brand_id
        and c.date >= v_day
        and c.date <= v_last_day
        and (c.transactions > 0 or c.purchase_revenue > 0)
    ),
    'sources', coalesce((
      select jsonb_agg(jsonb_build_object(
          'platform', s.platform,
          'visits', s.visits,
          'sessions', s.sessions,
          'keyEvents', s.key_events,
          'keyEventSessions', s.key_event_sessions,
          'transactions', s.transactions,
          'revenue', s.revenue
        ) order by s.visits desc, s.sessions desc, s.platform)
      from sources s
    ), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

revoke all on function public.content_page_results(uuid, text, integer) from public, anon;
grant execute on function public.content_page_results(uuid, text, integer)
  to authenticated, service_role;

comment on function public.content_page_results(uuid, text, integer) is
  'Content Editor (CE-016): one page''s AI visits per AI source over the last N whole UTC days (ending yesterday), with Google Analytics'' AI sessions landing on it, their key events, purchases and revenue. Security definer with an organization check.';
