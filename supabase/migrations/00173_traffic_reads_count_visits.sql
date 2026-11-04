-- ============================================================================
-- 00173: the Action Center's traffic reads count visits, not pageviews
-- ============================================================================
-- 00172 made a visit one session: a row of ai_traffic_logs whose visit_of is
-- null starts a visit, and the rows pointing at it are its reloads and
-- further links. The AI Traffic page counts visits since then, but the two
-- detector reads below still counted every row as a session, so a signal
-- could rest on a number the page no longer shows.
--
-- Each now reads the snippet's visit starts only. Analytics' side is
-- unchanged: it already reports sessions. The bodies are otherwise 00091's
-- (ae_ai_traffic_pages) and 00143's (ae_page_traffic_evidence); the
-- signatures and return types are the same, so CREATE OR REPLACE keeps their
-- grants, and their settings are restated as they were.
--
-- Counts fall where visitors reloaded or followed a second link (14,777
-- rows were 8,983 visits on production when 00172 ran), so a detector
-- threshold is reached later on the same traffic.

create or replace function public.ae_ai_traffic_pages(
  p_brand_id uuid, p_cur_from date, p_cur_to date, p_prev_from date, p_prev_to date
) returns jsonb
language sql stable
as $$
  with ga as (
    select landing_page as page,
      sum(sessions) filter (where date between p_cur_from and p_cur_to) as cur_sessions,
      sum(sessions) filter (where date between p_prev_from and p_prev_to) as prev_sessions,
      sum(engaged_sessions) filter (where date between p_cur_from and p_cur_to) as cur_engaged,
      sum(key_events) filter (where date between p_cur_from and p_cur_to) as cur_key_events,
      sum(key_events) filter (where date between p_prev_from and p_prev_to) as prev_key_events
    from public.ga_ai_traffic_stats
    where brand_id = p_brand_id and date between p_prev_from and p_cur_to
    group by landing_page
  ),
  snippet as (
    select url as page,
      count(*) filter (where created_at::date between p_cur_from and p_cur_to) as cur_sessions,
      count(*) filter (where created_at::date between p_prev_from and p_prev_to) as prev_sessions
    from public.ai_traffic_logs
    where brand_id = p_brand_id and created_at >= p_prev_from
      and visit_of is null
    group by url
  )
  select jsonb_build_object(
    'analytics', (select coalesce(jsonb_agg(row_to_json(g)), '[]'::jsonb) from (select * from ga order by cur_sessions desc nulls last limit 300) g),
    'snippet', (select coalesce(jsonb_agg(row_to_json(s)), '[]'::jsonb) from (select * from snippet order by cur_sessions desc nulls last limit 300) s)
  )
$$;

create or replace function public.ae_page_traffic_evidence(
  p_brand_id uuid,
  p_pages text[],
  p_cur_from date,
  p_cur_to date,
  p_prev_from date,
  p_prev_to date,
  p_exact boolean default false
) returns jsonb
language sql
stable
set search_path = public
as $$
  with pages as (
    select distinct page,
      case when p_exact then page else lower(normalize_page_path(page)) end as match_key,
      lower(normalize_page_path(page)) as page_key
    from unnest(p_pages) as page
  ),
  -- Each visit row's key is computed once, so the join below is an equality
  -- the planner can hash, not a function call per row and page.
  ga_rows as (
    select platform, date, sessions,
      case
        when p_pages is null then null
        when p_exact then landing_page
        else lower(normalize_page_path(landing_page))
      end as match_key
    from ga_ai_traffic_stats
    where brand_id = p_brand_id
      and date between p_prev_from and p_cur_to
      and (p_pages is null or landing_page <> '')
  ),
  -- A visit's first pageview only (00172): its reloads are not more visits.
  log_rows as (
    select source_platform as platform, created_at,
      case
        when p_pages is null then null
        when p_exact then url
        else lower(normalize_page_path(url))
      end as match_key
    from ai_traffic_logs
    where brand_id = p_brand_id
      and created_at >= p_prev_from
      and visit_of is null
      and (p_pages is null or not p_exact or url = any(p_pages))
  ),
  analytics as (
    select pg.page, r.platform,
      coalesce(sum(r.sessions) filter (where r.date between p_cur_from and p_cur_to), 0) as cur_sessions,
      coalesce(sum(r.sessions) filter (where r.date between p_prev_from and p_prev_to), 0) as prev_sessions
    from ga_rows r
    left join pages pg on pg.match_key = r.match_key
    where p_pages is null or pg.page is not null
    group by pg.page, r.platform
  ),
  snippet as (
    select pg.page, r.platform,
      count(*) filter (where r.created_at::date between p_cur_from and p_cur_to) as cur_sessions,
      count(*) filter (where r.created_at::date between p_prev_from and p_prev_to) as prev_sessions
    from log_rows r
    left join pages pg on pg.match_key = r.match_key
    where p_pages is null or pg.page is not null
    group by pg.page, r.platform
  ),
  targeted as (
    -- Explicit targeting only, as in 00075: a URL a customer attached to a
    -- prompt is a fact; "a prompt covers this page's topic" is a guess. A
    -- paused prompt is not asked, so the page can't be cited on it.
    select distinct pg.page, p.id as prompt_id, p.text
    from prompt_target_urls ptu
    join prompts p on p.id = ptu.prompt_id
    join prompt_sets ps on ps.id = p.prompt_set_id
    join pages pg on pg.page_key = lower(normalize_page_path(ptu.url))
    where ps.brand_id = p_brand_id
      and p.is_active
  )
  select jsonb_build_object(
    'analytics', coalesce((select jsonb_agg(a) from analytics a), '[]'::jsonb),
    'snippet', coalesce((select jsonb_agg(s) from snippet s), '[]'::jsonb),
    'prompts', coalesce(
      (select jsonb_agg(t order by t.page, t.text, t.prompt_id) from targeted t),
      '[]'::jsonb
    )
  )
$$;
