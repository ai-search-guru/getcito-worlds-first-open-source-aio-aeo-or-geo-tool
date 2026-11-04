-- ============================================================================
-- 00226: the Content Editor's reads, bounded by their window
-- ============================================================================
-- Four content reads, redefined after they were timed on production (the
-- reviews of #1287, #1292, #1308 and #1309). Each returns what it did; each
-- reads less to get there.
--
--   * content_page_overlap (00207): the window's answers come from
--     idx_prompt_results_brand_created_cover alone (an index-only scan), and
--     the prompts are picked where the citations meet them. A prompt filter
--     on the answers made the planner combine the prompt_id index with the
--     brand's and read about 16k heap blocks a call.
--   * content_draft_sources (00211) read every answer each source prompt
--     ever had, through the prompt_id index, and the citations' primary key
--     once per answer (8 s cold for a 92-prompt draft):
--       - the window's answers come from the cover index alone, for a draft
--         with prompts as well as one with a page, and the source prompts
--         are picked from them after;
--       - each prompt's answers are counted on that index; those naming the
--         brand come from the Mentions rollup (mentions_prompt_daily, 00157)
--         for the window's whole UTC days, and from the answer rows of its
--         first, partial day only;
--       - the fan-outs and the cited pages are read from each prompt's
--         latest 30 answers in the window, so "searched N×" and a page's
--         citations count those: they are the only answer rows fetched whole
--         (search_queries), and their citations a fifth of the window's.
--   * content_plan_pages (00220, as 00221 redefined it): the overlaps' pairs
--     take their window from the current answers alone. A date bound on the
--     citations too is estimated from prompt_result_citations' last analyze
--     (no index leads with created_at), at about one row for recent days,
--     and that plan rescanned the own addresses once per citation (15–19 s
--     at 7 days on the largest brand).
--   * content_plan_insights (00221) joined every address the brand had cited
--     in the window to citation_urls before keeping its own and the top
--     1,000. Now the own ids come from citation_urls' domain index first, the
--     rows are picked on the rollup's url ids, and only those picked are read
--     from citation_urls. The own list keeps the 5,000 cited most (a brand on
--     a large platform's domain has more), and each call is planned for its
--     own values (plan_cache_mode), as content_plan_pages is.
--
-- The index-only scans stay off the heap once prompt_results and
-- prompt_result_citations are vacuumed daily (00224), and that migration's
-- daily analyze keeps the planner's estimate of a recent window current.
-- Grants and comments carry over from 00207–00221 (create or replace); the
-- insights' comment is restated for its cap.

create or replace function public.content_page_overlap(
  p_brand_id uuid,
  p_prompt_ids uuid[],
  p_since timestamptz default now() - interval '30 days'
)
returns table (
  page text,
  title text,
  prompts_in_common integer,
  citations bigint,
  gsc_position numeric
)
language plpgsql
stable
security definer
set search_path to 'public'
set plan_cache_mode to 'force_custom_plan'
as $$
begin
  if not exists (
    select 1 from public.brands b
    join public.profiles pf on pf.organization_id = b.organization_id
    where b.id = p_brand_id and pf.id = auth.uid()
  ) and auth.role() is distinct from 'service_role' then
    return;
  end if;
  if coalesce(cardinality(p_prompt_ids), 0) = 0 then
    return;
  end if;

  return query
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
  -- The window's answers, from the (brand_id, created_at) cover index
  -- alone. The prompts are picked in `cited`: a prompt filter here makes the
  -- planner combine the prompt_id index with the brand's and read the heap.
  answers as materialized (
    select pr.id, pr.prompt_id
    from public.prompt_results pr
    where pr.brand_id = p_brand_id
      and pr.created_at >= p_since
      and pr.platform is distinct from 'chatgpt-shopping'
  ),
  cited as (
    select ou.page_key, ou.url, ou.title, a.prompt_id
    from public.prompt_result_citations prc
    join answers a on a.id = prc.prompt_result_id
    join own_urls ou on ou.id = prc.url_id
    where prc.brand_id = p_brand_id
      and prc.created_at >= p_since
      and a.prompt_id = any(p_prompt_ids)
  ),
  pages as (
    select
      c.page_key,
      -- The address cited most often stands for the page.
      mode() within group (order by c.url) as page,
      max(c.title) as title,
      count(distinct c.prompt_id)::integer as prompts_in_common,
      count(*)::bigint as citations
    from cited c
    group by c.page_key
  ),
  google as (
    select
      g.page_key,
      round((sum(g.position * g.impressions) / nullif(sum(g.impressions), 0))::numeric, 1)
        as position
    from public.gsc_page_stats g
    where g.brand_id = p_brand_id
      and g.date >= (now() at time zone 'utc')::date - 28
      and g.page_key in (select p.page_key from pages p)
    group by g.page_key
  )
  select p.page, p.title, p.prompts_in_common, p.citations, gl.position
  from pages p
  left join google gl on gl.page_key = p.page_key
  order by p.prompts_in_common desc, p.citations desc, p.page
  limit 10;
end;
$$;

create or replace function public.content_draft_sources(
  p_draft_id uuid,
  p_days integer default 30
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
set plan_cache_mode to 'force_custom_plan'
as $$
declare
  v_brand_id uuid;
  v_prompt_ids uuid[];
  v_page_key text;
  v_host text;
  v_since timestamptz;
  -- The window's first whole UTC day.
  v_first_day date;
  v_result jsonb;
begin
  select d.brand_id, d.prompt_ids, lower(public.normalize_page_path(d.source_url)),
    -- Lower-cased first: a scheme may be written HTTPS://.
    regexp_replace(substring(lower(d.source_url) from '^https?://([^/:?#]+)'), '^www\.', '')
    into v_brand_id, v_prompt_ids, v_page_key, v_host
  from public.content_drafts d
  where d.id = p_draft_id;

  if v_brand_id is null or (
    not exists (
      select 1 from public.brands b
      join public.profiles pf on pf.organization_id = b.organization_id
      where b.id = v_brand_id and pf.id = auth.uid()
    ) and auth.role() is distinct from 'service_role'
  ) then
    return null;
  end if;
  if p_days is null or p_days < 1 or p_days > 90 then
    raise exception 'content_draft_sources: 1 to 90 days are needed' using errcode = '22023';
  end if;

  v_since := now() - make_interval(days => p_days);
  v_first_day := (v_since at time zone 'utc')::date + 1;
  -- A page on a site that isn't the brand's is no page of the brand's.
  if v_host is null or not exists (
    select 1 from public.brand_domains bd
    where bd.brand_id = v_brand_id
      and lower(regexp_replace(bd.domain, '^www\.', '')) = v_host
  ) then
    v_page_key := null;
  end if;

  with own_domains as (
    select lower(regexp_replace(bd.domain, '^www\.', '')) as domain
    from public.brand_domains bd
    where bd.brand_id = v_brand_id
  ),
  -- The page's addresses: its path on its host.
  page_urls as materialized (
    select cu.id
    from public.citation_urls cu
    where v_page_key is not null
      and cu.domain = v_host
      and lower(public.normalize_page_path(cu.url)) = v_page_key
  ),
  -- The window's answers, from idx_prompt_results_brand_created_cover alone
  -- (an index-only scan). The prompts are picked after this read: a prompt
  -- filter here makes the planner combine the prompt_id index with the
  -- brand's and read every answer each prompt ever had.
  window_answers as materialized (
    select pr.id, pr.prompt_id, pr.created_at
    from public.prompt_results pr
    where (v_page_key is not null or coalesce(cardinality(v_prompt_ids), 0) > 0)
      and pr.brand_id = v_brand_id
      and pr.created_at >= v_since
      and pr.platform is distinct from 'chatgpt-shopping'
  ),
  -- The prompts whose answers cited the page the draft optimizes.
  page_prompts as (
    select distinct wa.prompt_id
    from public.prompt_result_citations prc
    join window_answers wa on wa.id = prc.prompt_result_id
    where prc.url_id in (select pu.id from page_urls pu)
      and prc.brand_id = v_brand_id
      and prc.created_at >= v_since
  ),
  source_prompts as (
    select p.id, p.text, p.id = any(v_prompt_ids) as in_draft,
      p.id in (select prompt_id from page_prompts) as cites_page
    from public.prompts p
    join public.prompt_sets ps on ps.id = p.prompt_set_id
    where ps.brand_id = v_brand_id
      and (p.id = any(v_prompt_ids) or p.id in (select prompt_id from page_prompts))
  ),
  -- The source prompts' answers in the window, newest first per prompt.
  answers as materialized (
    select wa.id, wa.prompt_id, wa.created_at,
      row_number() over (partition by wa.prompt_id order by wa.created_at desc) as recency
    from window_answers wa
    where wa.prompt_id in (select sp.id from source_prompts sp)
  ),
  -- The answers naming the brand: the window's whole UTC days from the
  -- Mentions rollup (mentions_prompt_daily, 00157), and its first, partial
  -- day from those answers' rows. A run still in progress joins the rollup
  -- when it completes.
  named as (
    select m.prompt_id, m.mention_answers as answers
    from public.mentions_prompt_daily m
    where m.brand_id = v_brand_id
      and m.day >= v_first_day
      and m.prompt_id in (select sp.id from source_prompts sp)
    union all
    select a.prompt_id, 1
    from answers a
    join public.prompt_results pr on pr.id = a.id
    where a.created_at < v_first_day::timestamp at time zone 'utc'
      and pr.mention_count > 0
  ),
  prompt_counts as (
    select a.prompt_id, a.answers, coalesce(n.mentioned, 0) as mentioned
    from (select prompt_id, count(*) as answers from answers group by prompt_id) a
    left join (
      select prompt_id, sum(answers) as mentioned from named group by prompt_id
    ) n on n.prompt_id = a.prompt_id
  ),
  -- The only answer rows read: each prompt's latest 30.
  sampled as (
    select pr.id, pr.platform, pr.search_queries
    from answers a
    join public.prompt_results pr on pr.id = a.id
    where a.recency <= 30
  ),
  fanout_rows as (
    select
      a.id as answer_id,
      lower(trim(regexp_replace(q.item->>'query', '\s+', ' ', 'g'))) as norm,
      trim(regexp_replace(q.item->>'query', '\s+', ' ', 'g')) as query,
      coalesce(nullif(q.item->>'source_platform', ''), a.platform) as platform
    from sampled a
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(a.search_queries) = 'array' then a.search_queries else '[]'::jsonb end
    ) as q(item)
    where coalesce(trim(q.item->>'query'), '') <> ''
  ),
  fanouts as (
    select min(query) as query, array_agg(distinct platform order by platform) as platforms,
      count(distinct answer_id) as searched
    from fanout_rows
    group by norm
    order by count(distinct answer_id) desc, min(query)
    limit 30
  ),
  -- The citations of the same sample as the fan-outs, each prompt's latest
  -- 30 answers: every answer in the window is 100k+ citations on a large
  -- brand, read one answer at a time. Grouped by address first; only the
  -- top 20 addresses are read.
  cited_ids as (
    select prc.url_id, count(*) as citations, count(distinct prc.prompt_result_id) as answers
    from answers a
    join public.prompt_result_citations prc
      on prc.prompt_result_id = a.id
     and prc.brand_id = v_brand_id
     and prc.created_at >= v_since
    where a.recency <= 30
    group by prc.url_id
    order by count(*) desc, count(distinct prc.prompt_result_id) desc, prc.url_id
    limit 20
  ),
  cited as (
    select cu.url, cu.title, cu.domain, ci.citations, ci.answers
    from cited_ids ci
    join public.citation_urls cu on cu.id = ci.url_id
  ),
  queries as (
    select g.query, sum(g.clicks)::bigint as clicks, sum(g.impressions)::bigint as impressions
    from public.gsc_query_stats g
    where g.brand_id = v_brand_id
      and g.date >= (now() at time zone 'utc')::date - 28
    group by g.query
    order by sum(g.clicks) desc, sum(g.impressions) desc, g.query
    limit 300
  )
  select jsonb_build_object(
    'prompts', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', sp.id,
          'text', sp.text,
          'inDraft', sp.in_draft,
          'citesPage', sp.cites_page,
          'answers', coalesce(pc.answers, 0),
          'mentioned', coalesce(pc.mentioned, 0)
        ) order by sp.in_draft desc, sp.text)
      from source_prompts sp
      left join prompt_counts pc on pc.prompt_id = sp.id
    ), '[]'::jsonb),
    'fanouts', coalesce((
      select jsonb_agg(jsonb_build_object(
          'query', f.query, 'platforms', to_jsonb(f.platforms), 'searched', f.searched
        ) order by f.searched desc, f.query)
      from fanouts f
    ), '[]'::jsonb),
    'citedPages', coalesce((
      select jsonb_agg(jsonb_build_object(
          'url', c.url, 'title', c.title, 'domain', c.domain,
          'citations', c.citations, 'answers', c.answers
        ) order by c.citations desc, c.answers desc, c.url)
      from cited c
    ), '[]'::jsonb),
    'gscQueries', coalesce((
      select jsonb_agg(jsonb_build_object(
          'query', q.query, 'clicks', q.clicks, 'impressions', q.impressions
        ) order by q.clicks desc, q.impressions desc, q.query)
      from queries q
    ), '[]'::jsonb),
    'brandDomains', coalesce((select jsonb_agg(domain order by domain) from own_domains), '[]'::jsonb),
    'competitorDomains', coalesce((
      select jsonb_agg(distinct lower(regexp_replace(c.domain, '^www\.', '')))
      from public.competitors c
      where c.brand_id = v_brand_id and coalesce(c.domain, '') <> ''
    ), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

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
  -- The window comes from cur_answers: a citation carries its answer's
  -- created_at. A date bound on prc too would be estimated from
  -- prompt_result_citations' last analyze (no index leads with created_at),
  -- at about one row for recent days, and that plan rescans own_urls once
  -- per citation.
  page_prompts as (
    select distinct u.page_key, a.prompt_id
    from public.prompt_result_citations prc
    join own_urls u on u.id = prc.url_id
    join cur_answers a on a.id = prc.prompt_result_id
    where prc.brand_id = p_brand_id
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

create or replace function public.content_plan_insights(
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
  -- The brand's own addresses, through citation_urls' domain index, as
  -- content_plan_pages' own_urls (00220).
  own_ids as materialized (
    select cu.id
    from public.citation_urls cu
    where cu.domain in (select domain from own_domains)
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
  chosen as (
    (
      select c.url_id, c.citations, true as own
      from cited c
      where exists (select 1 from own_ids o where o.id = c.url_id)
      order by c.citations desc, c.url_id
      limit 5000
    )
    union all
    (
      select c.url_id, c.citations, false
      from cited c
      where not exists (select 1 from own_ids o where o.id = c.url_id)
      order by c.citations desc, c.url_id
      limit 1000
    )
  ),
  top_urls as (
    select ch.url_id, ch.citations, ch.own, cu.url, cu.title
    from chosen ch
    join public.citation_urls cu on cu.id = ch.url_id
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

comment on function public.content_plan_insights(uuid, integer) is
  'Content Editor (CE-014): the addresses AI answers cite for the brand over the last N (7, 30 or 90) whole UTC days to yesterday (from citation_url_daily): its own pages (the 5,000 cited most) and the 1,000 others cited most, with the total; and what AI-referred visitors did on the site: visits, Google Analytics AI key events, purchases and revenue. Security definer with an organization check.';
