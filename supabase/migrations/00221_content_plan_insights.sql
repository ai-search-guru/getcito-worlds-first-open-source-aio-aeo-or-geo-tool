-- ============================================================================
-- 00221: what AI cites, and what AI visits bring in, for the Content plan
-- ============================================================================
-- The Plan (Content Editor CE-014, spec v2 §4) shows, under its cards:
--
--   * "What AI cites in your topics": one row per page type with the share
--     of AI citations in the brand's tracked answers going to that type of
--     page, and the brand's own mix. Page types are read from the address
--     and title (lib/content/pageTypes.ts), so this returns the addresses
--     over the last p_days whole UTC days to yesterday (as the Plan's pages,
--     00220), from the nightly rollup (citation_url_daily, 00118), ChatGPT
--     Shopping left out: every one of the brand's own (at most a few
--     thousand, so its mix is whole), and the 1,000 others cited most; with
--     the total, so the share the list covers is known;
--   * the AI results strip: what AI-referred visitors did on the whole site
--     over the same days, as the Impact tab's results (00210) read one page:
--     visits by ai_traffic_merged's rule (00176), and Google Analytics' AI
--     key events, purchases and revenue; whether a property is set (the app
--     checks the connection too), and whether it reported any purchase.
--
-- The Plan's period is now 7, 30 or 90 days (a quarter), so
-- content_plan_pages (00220) is redefined to take 90 as well, and to say
-- since when the brand is tracked: few brands have 180 days of history, so
-- at 90 days the earlier window is often only partly tracked, or not at all.
--
-- Security definer with an organization check, as 00209–00220.

create or replace function public.content_plan_insights(
  p_brand_id uuid,
  p_days integer default 30
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  -- Whole days to yesterday, as the Plan's pages (00220).
  v_last date := (now() at time zone 'utc')::date - 1;
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
  if p_days not in (7, 30, 90) then
    raise exception 'p_days must be 7, 30 or 90';
  end if;

  v_day := v_last - p_days + 1;
  v_from := v_day::timestamp at time zone 'utc';
  v_until := (v_last + 1)::timestamp at time zone 'utc';

  with own_domains as (
    select lower(regexp_replace(bd.domain, '^www\.', '')) as domain
    from public.brand_domains bd
    where bd.brand_id = p_brand_id
  ),
  cited as materialized (
    select d.url_id, sum(d.citations)::bigint as citations
    from public.citation_url_daily d
    where d.brand_id = p_brand_id
      and d.day >= v_day
      and d.day <= v_last
      and d.platform is distinct from 'chatgpt-shopping'
    group by d.url_id
  ),
  addresses as (
    select c.url_id, c.citations, cu.url, cu.title, cu.domain in (select domain from own_domains) as own
    from cited c
    join public.citation_urls cu on cu.id = c.url_id
  ),
  top_urls as (
    select a.* from addresses a where a.own
    union all
    (
      select a.* from addresses a
      where not a.own
      order by a.citations desc, a.url_id
      limit 1000
    )
  ),
  snippet_days as (
    select distinct (l.created_at at time zone 'utc')::date as day
    from public.ai_traffic_logs l
    where l.brand_id = p_brand_id
      and l.visit_of is null
      and l.created_at >= v_from
      and l.created_at < v_until
  ),
  visits as (
    select count(*)::bigint as n
    from public.ai_traffic_logs l
    where l.brand_id = p_brand_id
      and l.visit_of is null
      and l.created_at >= v_from
      and l.created_at < v_until
    union all
    select coalesce(sum(g.sessions), 0)::bigint
    from public.ga_ai_traffic_stats g
    where g.brand_id = p_brand_id
      and g.sessions > 0
      and g.date >= v_day
      and g.date <= v_last
      and not exists (select 1 from snippet_days s where s.day = g.date)
  ),
  analytics as (
    select
      coalesce(sum(g.key_events), 0)::bigint as key_events,
      coalesce(sum(g.transactions), 0)::bigint as transactions,
      coalesce(sum(g.purchase_revenue), 0)::numeric as revenue
    from public.ga_ai_traffic_stats g
    where g.brand_id = p_brand_id
      and g.date >= v_day
      and g.date <= v_last
  )
  select jsonb_build_object(
    'days', p_days,
    'totalCitations', (select coalesce(sum(c.citations), 0) from cited c),
    'citations', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'url', t.url,
          'title', t.title,
          'own', t.own,
          'citations', t.citations
        )
        order by t.citations desc, t.url
      )
      from top_urls t
    ), '[]'::jsonb),
    'results', (
      select jsonb_build_object(
        'visits', (select coalesce(sum(v.n), 0) from visits v),
        'keyEvents', a.key_events,
        'transactions', a.transactions,
        'revenue', a.revenue,
        'analytics', (
          select nullif(b.ga_property_id, '') is not null
          from public.brands b where b.id = p_brand_id
        ),
        'purchases', a.transactions > 0 or a.revenue > 0 or exists (
          select 1 from public.ga_channel_stats c
          where c.brand_id = p_brand_id
            and c.date >= v_day
            and c.date <= v_last
            and (c.transactions > 0 or c.purchase_revenue > 0)
        )
      )
      from analytics a
    )
  )
  into v_result;

  return v_result;
end;
$$;

revoke all on function public.content_plan_insights(uuid, integer) from public, anon;
grant execute on function public.content_plan_insights(uuid, integer) to authenticated, service_role;

comment on function public.content_plan_insights(uuid, integer) is
  'Content Editor (CE-014): the addresses AI answers cite for the brand over the last N (7, 30 or 90) whole UTC days to yesterday (from citation_url_daily): every own page and the 1,000 others cited most, with the total; and what AI-referred visitors did on the site: visits, Google Analytics AI key events, purchases and revenue. Security definer with an organization check.';

-- ─── content_plan_pages (00220), taking 90 days too ─────────────────────────
-- As 00220, with 90 days and the windows' tracking: 'prevFrom' and
-- 'trackedSince' tell the Plan when the earlier window isn't fully tracked.

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
  if p_days not in (7, 30, 90) then
    raise exception 'p_days must be 7, 30 or 90';
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
  'Content Editor (CE-014): the brand''s 100 most cited pages over the last N (7, 30 or 90) whole UTC days to yesterday and the N before, from the daily rollups: citations, the brand''s answers in each window, platforms citing at a lower rate, AI visits and how many of its other pages compete for the same prompts; with the earlier window''s first day and the brand''s first tracked day. Security definer with an organization check.';
