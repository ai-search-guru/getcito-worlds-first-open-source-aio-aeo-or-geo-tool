-- ============================================================================
-- 00287: conversions from AI journeys through a page, for the editor's Live page tab
-- ============================================================================
-- With conversions on (00286), the AI Traffic snippet follows a visitor who
-- came from an AI assistant to a goal. The Live page tab (CE-016) shows what
-- the page a draft optimizes took part in (Content Editor spec v2 §7, CE-017).
--
-- content_page_conversions(brand, page, days) returns one jsonb over the last
-- N whole UTC days, ending yesterday, as content_page_results (00210):
--   * enabled: whether the brand has conversions on;
--   * page: the page's key, for the tab to find it in the journeys;
--   * goals: per goal, the conversions and their units, of journeys through
--     the page: a conversion whose journey (its visitor id: the snippet
--     makes a new one for each journey) landed on the page, went through it
--     before, or converted on it;
--   * revenue: the value of their orders and bookings per currency (a value
--     without one isn't summed);
--   * sources: per AI source the journey started from (first touch), its
--     conversions;
--   * journeys: the five most frequent (the latest first among as many), each
--     its source, its pages in order (the landing page, the pages after
--     without repeats in a row, the page it converted on, as
--     lower(normalize_page_path) keys), its goal and how many.
-- The journey's first AI visit isn't its key: the server keeps a browser's
-- clock from dating it after the event, so first_at may differ within one.
-- Conversions are read through their own partial index: most events are
-- pageviews. Pages are compared by the keys stored with each event
-- (page_key, first_key, 00286). The reads are bounded whatever a sender
-- stored: a visitor id's pageviews are read once for the page, from a day
-- before its first AI visit; a journey's steps are the latest 100 pageviews
-- before its conversion; and the journeys are the latest 2,000
-- conversions' (the counts take all).
-- A page is one lower(normalize_page_path) key, as in 00209 / 00210.
--
-- Security definer with an organization check, as content_page_results, and
-- planned for each call's own values (plan_cache_mode).

create index if not exists ai_traffic_events_conversions
  on public.ai_traffic_events (brand_id, occurred_at desc)
  where kind = 'conversion';

create or replace function public.content_page_conversions(
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
    raise exception 'content_page_conversions: a page and 1 to 366 days are needed'
      using errcode = '22023';
  end if;

  v_from := (v_last_day - p_days + 1)::timestamp at time zone 'utc';
  v_until := (v_last_day + 1)::timestamp at time zone 'utc';

  with conversions as (
    select c.*
    from public.ai_traffic_events c
    where c.brand_id = p_brand_id
      and c.kind = 'conversion'
      and c.occurred_at >= v_from
      and c.occurred_at < v_until
  ),
  -- When each visitor id first saw the page in its journey: read once per
  -- visitor id however many conversions it has, from a day before its first
  -- AI visit (first_at is clamped per event, within the server's clock
  -- allowance) to its last conversion, by the stored keys.
  seen as (
    select v.visitor_id, (
      select min(e.occurred_at)
      from public.ai_traffic_events e
      where e.brand_id = p_brand_id
        and e.visitor_id = v.visitor_id
        and e.kind = 'page'
        and e.page_key = v_key
        and e.occurred_at >= v.since
        and e.occurred_at <= v.last_at
    ) as at
    from (
      select visitor_id, min(first_at) - interval '1 day' as since, max(occurred_at) as last_at
      from conversions
      group by visitor_id
    ) v
  ),
  -- A conversion whose journey landed on the page, went through it, or converted on it.
  through as (
    select c.*
    from conversions c
    left join seen s on s.visitor_id = c.visitor_id
    where c.first_key = v_key
      or c.page_key = v_key
      or (s.at is not null and s.at <= c.occurred_at and s.at >= c.first_at - interval '1 day')
  ),
  -- The paths of the latest 2,000 (the counts above take all): the landing
  -- page, the latest 100 pageviews before the conversion, the page it
  -- converted on.
  paths as (
    select t.first_source, t.goal, t.occurred_at, (
      select array_agg(s.page order by s.ord <> 0, s.at, s.ord)
      from (
        select steps.page, steps.at, steps.ord,
          lag(steps.page) over (order by steps.ord <> 0, steps.at, steps.ord) as before
        from (
          select t.first_key as page, t.first_at as at, 0 as ord
          union all
          select p.page_key, p.occurred_at, 1
          from (
            select e.page_key, e.occurred_at
            from public.ai_traffic_events e
            where e.brand_id = p_brand_id
              and e.visitor_id = t.visitor_id
              and e.kind = 'page'
              and e.occurred_at >= t.first_at - interval '1 day'
              and e.occurred_at <= t.occurred_at
            order by e.occurred_at desc
            limit 100
          ) p
          union all
          select t.page_key, t.occurred_at, 2
        ) steps
      ) s
      where s.before is distinct from s.page
    ) as pages
    from (select * from through order by occurred_at desc limit 2000) t
  )
  select jsonb_build_object(
    'page', v_key,
    'enabled', coalesce((select b.conversions_enabled from public.brands b where b.id = p_brand_id), false),
    'goals', coalesce((
      select jsonb_agg(jsonb_build_object('goal', g.goal, 'count', g.n, 'units', g.units)
        order by g.n desc, g.goal)
      from (
        select goal, count(*)::bigint as n, coalesce(sum(units), 0)::bigint as units
        from through group by goal
      ) g
    ), '[]'::jsonb),
    'revenue', coalesce((
      select jsonb_agg(jsonb_build_object('currency', r.currency, 'value', r.value)
        order by r.value desc, r.currency)
      from (
        select currency, sum(value)::numeric as value
        from through
        where goal in ('order', 'booking') and value is not null and currency is not null
        group by currency
      ) r
    ), '[]'::jsonb),
    'sources', coalesce((
      select jsonb_agg(jsonb_build_object('platform', s.first_source, 'conversions', s.n)
        order by s.n desc, s.first_source)
      from (select first_source, count(*)::bigint as n from through group by first_source) s
    ), '[]'::jsonb),
    'journeys', coalesce((
      select jsonb_agg(jsonb_build_object('source', j.first_source, 'pages', to_jsonb(j.pages),
          'goal', j.goal, 'count', j.n)
        order by j.n desc, j.latest desc, j.first_source, j.goal)
      from (
        select first_source, pages, goal, count(*)::bigint as n, max(occurred_at) as latest
        from paths
        group by first_source, pages, goal
        order by count(*) desc, max(occurred_at) desc, first_source, goal
        limit 5
      ) j
    ), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

revoke all on function public.content_page_conversions(uuid, text, integer) from public, anon;
grant execute on function public.content_page_conversions(uuid, text, integer)
  to authenticated, service_role;

comment on function public.content_page_conversions(uuid, text, integer) is
  'Content Editor (CE-017, 00287): conversions of AI journeys through one page over the last N whole UTC days (ending yesterday), from the AI Traffic snippet (ai_traffic_events, 00286): per goal with units, value per currency, per first AI source, and the five most frequent journeys (source, pages, goal). Security definer with an organization check.';
