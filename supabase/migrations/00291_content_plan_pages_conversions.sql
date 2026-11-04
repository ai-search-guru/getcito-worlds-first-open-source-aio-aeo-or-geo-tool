-- ============================================================================
-- 00291: content_plan_pages with each page's conversions from AI journeys
-- ============================================================================
-- The Content Plan's Priority Score weighs a page's value by its AI visits
-- (#1356). With conversions on (CE-017, 00286), it weighs the conversions
-- the page took part in too, as the editor's Live page tab counts them
-- (00287): a conversion whose AI journey landed on the page, went through
-- it, or converted on it, in the window, of the latest 2,000.
--
-- Each page of the list gets 'conversions': that count, or null for a brand
-- with conversions off (unknown, never zero). Everything else is 00238's,
-- with the same signature, so its grants carry over (create or replace); its
-- comment is brought up to date below. The conversions are read only with
-- conversions on: through 00287's partial index, then, as 00287 reads them,
-- when each visitor id first saw each listed page, once per visitor and page
-- on the journey index (00286), so a sender's many pageviews can't multiply
-- the rows.

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
  v_conversions_on boolean;
  v_result jsonb;
begin
  if not exists (
    select 1 from public.brands b
    join public.profiles pf on pf.organization_id = b.organization_id
    where b.id = p_brand_id and pf.id = auth.uid()
  ) and auth.role() is distinct from 'service_role' then
    return null;
  end if;
  if p_days not in (7, 30, 90) then
    raise exception 'p_days must be 7, 30 or 90';
  end if;

  v_cur_day := v_last - p_days + 1;
  v_prev_day := v_cur_day - p_days;
  v_cur := v_cur_day::timestamp at time zone 'utc';
  v_until := (v_last + 1)::timestamp at time zone 'utc';
  v_conversions_on := coalesce(
    (select b.conversions_enabled from public.brands b where b.id = p_brand_id), false);

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
  ),
  -- Conversions from AI journeys in the window, with conversions on (00286):
  -- the latest 2,000, as 00287 and 00288 bound their journeys, through 00287's
  -- partial index (brand_id, occurred_at desc), so the read stops there. The
  -- score counts 20 in full; past 2,000, a page's count is of the latest.
  conversions as materialized (
    select c.id, c.visitor_id, c.first_key, c.page_key, c.first_at, c.occurred_at
    from public.ai_traffic_events c
    where v_conversions_on
      and c.brand_id = p_brand_id
      and c.kind = 'conversion'
      and c.occurred_at >= v_cur
      and c.occurred_at < v_until
    order by c.occurred_at desc
    limit 2000
  ),
  -- When each visitor id first saw each listed page, from a day before its
  -- first AI visit to its last conversion: 00287's `seen`, for every listed
  -- page at once (the journey index), one row per visitor and page.
  seen as (
    select e.visitor_id, e.page_key, min(e.occurred_at) as at
    from (
      select visitor_id, min(first_at) - interval '1 day' as since, max(occurred_at) as last_at
      from conversions
      group by visitor_id
    ) v
    join public.ai_traffic_events e
      on e.brand_id = p_brand_id
     and e.visitor_id = v.visitor_id
     and e.kind = 'page'
     and e.occurred_at >= v.since
     and e.occurred_at <= v.last_at
    where e.page_key in (select p.page_key from pages p)
    group by e.visitor_id, e.page_key
  ),
  -- A conversion counts for each page its journey landed on, went through
  -- or converted on: the Live page tab's count (00287), once per page.
  touched as (
    select c.id, c.first_key as page_key from conversions c
    union
    select c.id, c.page_key from conversions c
    union
    select c.id, s.page_key
    from conversions c
    join seen s
      on s.visitor_id = c.visitor_id
     and s.at <= c.occurred_at
     and s.at >= c.first_at - interval '1 day'
  ),
  page_conversions as (
    select t.page_key, count(*)::bigint as n
    from touched t
    where t.page_key in (select p.page_key from pages p)
    group by t.page_key
  )
  select jsonb_build_object(
    'days', p_days,
    -- The earlier window's first day, and the brand's first tracked day: a
    -- window before it is only partly tracked, or not at all.
    'prevFrom', v_prev_day,
    'trackedSince', (
      select min(r.day) from public.citation_result_daily r where r.brand_id = p_brand_id
    ),
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
          -- Null with conversions off: unknown, never zero.
          'conversions', case when v_conversions_on then coalesce(pc.n, 0) end
        )
        order by p.cur + p.prev desc, p.page
      )
      from pages p
      left join down d on d.page_key = p.page_key
      left join page_visits pv on pv.page_key = p.page_key
      left join page_conversions pc on pc.page_key = p.page_key
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;

comment on function public.content_plan_pages(uuid, integer) is
  'Content Editor (CE-014): the brand''s 100 most cited pages over the last N (7, 30 or 90) whole UTC days to yesterday and the N before, from the daily rollups: citations, the brand''s answers in each window, platforms citing at a lower rate, AI visits and, with conversions on (00291), the conversions from AI journeys that landed on, went through or converted on each page, of the latest 2,000 (null with conversions off); with the earlier window''s first day and the brand''s first tracked day. Security definer with an organization check.';
