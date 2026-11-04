-- ============================================================================
-- 00220: the brand's pages for the Content plan (Content Editor, CE-014)
-- ============================================================================
-- The Plan (spec v2 §4) answers what to work on first. Content Opportunities
-- name the new pages AI needs; this reads the brand's own pages, so the Plan
-- can tell which to optimize, which to protect and which compete:
--
--   * answers {cur, prev}: the brand's tracked answers in each window, the
--     denominator that makes the two windows comparable (a brand tracked
--     weekly, prompts added or removed);
--   * citations {cur, prev}: AI answers' citations of the page over the last
--     p_days whole UTC days to yesterday and the p_days before. Today is left
--     out: its runs land through the morning (UTC), so it would read short;
--   * platformsDown: the platforms citing it at a lower rate (citations per
--     answer of that platform) than before, the biggest drop first;
--   * aiVisits: AI-referred visits in the current window, by
--     ai_traffic_merged's rule (00176): the snippet's visits, and Analytics'
--     sessions on days the snippet has none;
--   * overlaps: how many of the brand's other pages are cited for at least
--     two of the same prompts in the current window (pages competing).
--
-- Citations come from the daily rollups (citation_url_daily, answers from
-- citation_result_daily), as ai_traffic_page_citations reads them, so the
-- cost follows the window and not the brand's history; ChatGPT Shopping is
-- left out, as there. Only the overlaps need each citation's prompt: raw
-- rows of the current window, for the chosen pages, through the covering
-- indexes (00207, 00209).
--
-- The 100 pages cited most over both windows. Security definer with an
-- organization check, as 00209; null outside the member's organization.

create or replace function public.content_plan_pages(
  p_brand_id uuid,
  p_days integer default 30
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
-- A cached generic plan can't see the brand's size (00207).
set plan_cache_mode to 'force_custom_plan'
as $$
declare
  v_last date := (now() at time zone 'utc')::date - 1;
  v_cur_day date;
  v_prev_day date;
  v_cur timestamptz;
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
  if p_days not in (7, 30) then
    raise exception 'p_days must be 7 or 30';
  end if;

  v_cur_day := v_last - p_days + 1;
  v_prev_day := v_cur_day - p_days;
  v_cur := v_cur_day::timestamp at time zone 'utc';
  v_until := (v_last + 1)::timestamp at time zone 'utc';

  with own_domains as (
    select lower(regexp_replace(bd.domain, '^www\.', '')) as domain
    from public.brand_domains bd
    where bd.brand_id = p_brand_id
  ),
  own_urls as materialized (
    select cu.id, cu.url, cu.title, lower(public.normalize_page_path(cu.url)) as page_key
    from public.citation_urls cu
    where cu.domain in (select domain from own_domains)
  ),
  url_counts as materialized (
    select d.url_id, d.platform, d.day >= v_cur_day as is_cur, sum(d.citations)::bigint as n
    from public.citation_url_daily d
    where d.brand_id = p_brand_id
      and d.day >= v_prev_day
      and d.day <= v_last
      and d.url_id in (select id from own_urls)
      and d.platform is distinct from 'chatgpt-shopping'
    group by d.url_id, d.platform, d.day >= v_cur_day
  ),
  url_totals as (
    select
      u.page_key,
      u.url,
      u.title,
      coalesce(sum(c.n) filter (where c.is_cur), 0) as cur,
      coalesce(sum(c.n) filter (where not c.is_cur), 0) as prev
    from url_counts c
    join own_urls u on u.id = c.url_id
    group by u.page_key, u.url, u.title
  ),
  pages as materialized (
    select
      t.page_key,
      -- The address cited most often stands for the page.
      (array_agg(t.url order by t.cur + t.prev desc, t.url))[1] as page,
      max(t.title) as title,
      sum(t.cur)::bigint as cur,
      sum(t.prev)::bigint as prev
    from url_totals t
    group by t.page_key
    order by sum(t.cur + t.prev) desc, t.page_key
    limit 100
  ),
  answers as (
    select
      r.platform,
      coalesce(sum(r.answers) filter (where r.day >= v_cur_day), 0)::bigint as cur,
      coalesce(sum(r.answers) filter (where r.day < v_cur_day), 0)::bigint as prev
    from public.citation_result_daily r
    where r.brand_id = p_brand_id
      and r.day >= v_prev_day
      and r.day <= v_last
      and r.platform is distinct from 'chatgpt-shopping'
    group by r.platform
  ),
  per_platform as (
    select
      u.page_key,
      c.platform,
      coalesce(sum(c.n) filter (where c.is_cur), 0) as cur,
      coalesce(sum(c.n) filter (where not c.is_cur), 0) as prev
    from url_counts c
    join own_urls u on u.id = c.url_id
    where u.page_key in (select p.page_key from pages p)
      and c.platform is not null
    group by u.page_key, c.platform
  ),
  down as (
    -- A platform tracked in both windows, citing the page at a lower rate.
    select
      pp.page_key,
      array_agg(
        pp.platform
        order by pp.prev::numeric / a.prev - pp.cur::numeric / a.cur desc, pp.platform
      ) as platforms
    from per_platform pp
    join answers a on a.platform = pp.platform
    where a.prev > 0
      and a.cur > 0
      and pp.prev::numeric / a.prev > pp.cur::numeric / a.cur
    group by pp.page_key
  ),
  cur_answers as materialized (
    select pr.id, pr.prompt_id
    from public.prompt_results pr
    where pr.brand_id = p_brand_id
      and pr.created_at >= v_cur
      and pr.created_at < v_until
      and pr.platform is distinct from 'chatgpt-shopping'
  ),
  page_prompts as (
    select distinct u.page_key, a.prompt_id
    from public.prompt_result_citations prc
    join own_urls u on u.id = prc.url_id
    join cur_answers a on a.id = prc.prompt_result_id
    where prc.brand_id = p_brand_id
      and prc.created_at >= v_cur
      and prc.created_at < v_until
      and u.page_key in (select p.page_key from pages p)
  ),
  competing as (
    select a.page_key, b.page_key as other
    from page_prompts a
    join page_prompts b on b.prompt_id = a.prompt_id and b.page_key <> a.page_key
    group by a.page_key, b.page_key
    having count(*) >= 2
  ),
  page_overlaps as (
    select cm.page_key, count(*) as pages
    from competing cm
    group by cm.page_key
  ),
  snippet_days as (
    select distinct (l.created_at at time zone 'utc')::date as day
    from public.ai_traffic_logs l
    where l.brand_id = p_brand_id
      and l.visit_of is null
      and l.created_at >= v_cur
      and l.created_at < v_until
  ),
  visits as (
    select lower(public.normalize_page_path(l.url)) as page_key, 1::bigint as n
    from public.ai_traffic_logs l
    where l.brand_id = p_brand_id
      and l.visit_of is null
      and l.created_at >= v_cur
      and l.created_at < v_until
    union all
    select lower(public.normalize_page_path(g.landing_page)), g.sessions::bigint
    from public.ga_ai_traffic_stats g
    where g.brand_id = p_brand_id
      and g.sessions > 0
      -- A session without a landing page would read as the home page.
      and g.landing_page <> ''
      and g.date >= v_cur_day
      and g.date <= v_last
      and not exists (select 1 from snippet_days s where s.day = g.date)
  ),
  page_visits as (
    select v.page_key, sum(v.n) as visits
    from visits v
    where v.page_key in (select p.page_key from pages p)
    group by v.page_key
  )
  select jsonb_build_object(
    'days', p_days,
    'answers', (
      select jsonb_build_object(
        'cur', coalesce(sum(a.cur), 0),
        'prev', coalesce(sum(a.prev), 0)
      )
      from answers a
    ),
    'pages', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'page', p.page,
          'title', p.title,
          'citations', jsonb_build_object('cur', p.cur, 'prev', p.prev),
          'platformsDown', coalesce(to_jsonb(d.platforms[1:3]), '[]'::jsonb),
          'aiVisits', coalesce(pv.visits, 0),
          'overlaps', coalesce(o.pages, 0)
        )
        order by p.cur + p.prev desc, p.page
      )
      from pages p
      left join down d on d.page_key = p.page_key
      left join page_overlaps o on o.page_key = p.page_key
      left join page_visits pv on pv.page_key = p.page_key
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;

revoke all on function public.content_plan_pages(uuid, integer) from public, anon;
grant execute on function public.content_plan_pages(uuid, integer) to authenticated, service_role;

comment on function public.content_plan_pages(uuid, integer) is
  'Content Editor (CE-014): the brand''s 100 most cited pages over the last N (7 or 30) whole UTC days to yesterday and the N before, from the daily rollups: citations, the brand''s answers in each window, platforms citing at a lower rate, AI visits and how many of its other pages compete for the same prompts. Security definer with an organization check.';
