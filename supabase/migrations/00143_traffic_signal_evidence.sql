-- Where a traffic signal's AI visits come from, and the prompts its pages
-- could be cited on (AC-001).
--
-- A traffic signal ("AI traffic slipping on 3 pages", "High-value page
-- without AI traffic") named its pages and a session count, never which AI
-- engines send the visits or which prompts the page answers. The panel is to
-- show both. This reads, for the pages given, AI-referred sessions per
-- platform over two windows from Analytics (ga_ai_traffic_stats) and from the
-- tracking snippet (ai_traffic_logs), and the active prompts that name the
-- page as their target URL. With p_pages null it reads the whole site's
-- sessions per platform, for the site-wide signals.
--
-- Two ways to match a page's visits:
--   - p_exact: as written. The AI-traffic detector's pages are these tables'
--     own landing_page / url values (ae_ai_traffic_pages, 00091), so its
--     signals read the same rows their numbers came from.
--   - otherwise as the page-opportunity read matches them (00075), by
--     lower(normalize_page_path(...)): "/pricing/" in Analytics and a
--     snippet's full URL both name a page opportunity's "/pricing".
-- Target URLs always match the second way: they are typed in full by users.
-- Each row carries the page as it was asked for, so the caller can map it
-- back.
--
-- Both sources are returned as they are: the snippet counts the visits
-- Analytics counts again, so the caller picks one per page and never adds
-- them, as the detector does (mergeTrafficPages).

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

-- Service-role only, like the other detector reads.
revoke all on function public.ae_page_traffic_evidence(uuid, text[], date, date, date, date, boolean)
  from public, anon, authenticated;
grant execute on function public.ae_page_traffic_evidence(uuid, text[], date, date, date, date, boolean)
  to service_role;
