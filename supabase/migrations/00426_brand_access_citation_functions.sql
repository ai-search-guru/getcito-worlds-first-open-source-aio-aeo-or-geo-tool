-- ============================================================================
-- 00426: brand access — the citation and report functions
-- ============================================================================
-- 00389 narrowed the brands table, and every policy that reads a brand through
-- it follows. A security definer function doesn't: it reads past RLS and
-- checks the caller itself. These eleven still ask only whether the brand
-- belongs to the caller's organization (brands joined to the caller's profile
-- on organization_id), so a Selected-brands person could read the citations
-- of a brand they can't see through them. Each now asks can_access_brand
-- (00388) instead:
--   * the Citations page: citations_window_stats, citation_url_candidates,
--     citation_url_occurrences (00069), citations_domains, citations_urls,
--     citation_gap_domains, citation_competitor_sources (00111);
--   * its daily-rollup reads: citations_urls_daily (00119),
--     citation_gap_domains_daily, citation_competitor_sources_daily (00203);
--   * the report's evidence: report_citation_evidence (00063).
--
-- The first of three waves (BRAND-ACCESS PR 4–6); Insights, Mentions and
-- Topics come next, then AI traffic, content, shopping and the catalog.
-- frontend/src/lib/brandAccessFunctions.test.ts lists the functions still to do
-- and fails on a new one that checks only the organization.
--
-- Nothing changes yet: everyone has All brands until the Team screen narrows
-- someone, and for an All-brands person can_access_brand(brand) is true
-- exactly when the brand is their organization's, the check it replaces.
-- Without a person (anon, the service role) both answer no, so those callers
-- still read nothing: none of these lets the service role through.
--
-- How:
--   * Each function is its last definition, word for word, with only the
--     check changed. The sql ones keep their `allowed` CTE, which now selects
--     its one row when can_access_brand(p_brand_id); the plpgsql ones keep
--     their early return. It runs once per call, as before, not per row.
--   * create or replace resets the settings a definition doesn't repeat, so
--     each repeats its own: search_path, and work_mem and plan_cache_mode
--     where it had them. Grants stay as they were (create or replace keeps
--     them).
--   * The comments that said "members of the brand's organization" or "an
--     organization check" now say brand access, and the two functions that
--     had none (citations_urls_daily, report_citation_evidence) get one.
--   * can_access_brand runs as the function's owner here, so a caller who may
--     not run it directly (anon) still gets the empty answer, not an error.

-- ── citations_window_stats (00069) ─────────────────────────────────────────
-- The Citations page: answers scanned and regions in the window.

create or replace function public.citations_window_stats(
  p_brand_id uuid,
  p_date_from timestamptz default null,
  p_date_to timestamptz default null,
  p_models text[] default null,
  p_regions text[] default null,
  p_prompt_ids uuid[] default null,
  p_topic_ids uuid[] default null
)
returns table (results bigint, regions text[])
language sql
stable
security definer
set search_path = public
as $$
  with allowed as (
    select 1 where public.can_access_brand(p_brand_id)
  )
  select count(*)::bigint,
         coalesce(array_agg(distinct pr.region) filter (where pr.region is not null), '{}')
  from public.prompt_results pr
  where exists (select 1 from allowed)
    and pr.brand_id = p_brand_id
    and pr.platform <> 'chatgpt-shopping'
    and (p_date_from  is null or pr.created_at >= p_date_from)
    and (p_date_to    is null or pr.created_at <= p_date_to)
    and (p_models     is null or pr.model_used = any(p_models))
    and (p_regions    is null or pr.region = any(p_regions))
    and (p_prompt_ids is null or pr.prompt_id = any(p_prompt_ids))
    and (p_topic_ids  is null or pr.prompt_id in (
          select pp.id from public.prompts pp where pp.topic_id = any(p_topic_ids)));
$$;

-- ── citation_url_candidates (00069) ────────────────────────────────────────
-- The URL detail: URLs on one domain the brand has cited.

create or replace function public.citation_url_candidates(
  p_brand_id uuid,
  p_domain text
)
returns table (
  id bigint,
  url text,
  title text
)
language sql
stable
security definer
set search_path to 'public'
as $$
  with allowed as (
    select 1 where public.can_access_brand(p_brand_id)
  )
  select cu.id, cu.url, cu.title
  from public.citation_urls cu
  where exists (select 1 from allowed)
    and cu.domain = p_domain
    and exists (
      select 1 from public.prompt_result_citations c
      where c.url_id = cu.id and c.brand_id = p_brand_id
    );
$$;

-- ── citation_url_occurrences (00069) ───────────────────────────────────────
-- The URL detail: the answers citing the URLs.

create or replace function public.citation_url_occurrences(
  p_brand_id uuid,
  p_url_ids bigint[],
  p_date_from timestamptz default null,
  p_date_to timestamptz default null,
  p_models text[] default null,
  p_regions text[] default null,
  p_prompt_ids uuid[] default null,
  p_topic_ids uuid[] default null
)
returns table (
  result_id uuid,
  prompt_id uuid,
  prompt_text text,
  platform text,
  model_used text,
  region text,
  created_at timestamptz,
  sentiment text,
  brand_mentioned boolean,
  citations_in_answer int,
  rank int,
  total_sources int
)
language sql
stable
security definer
set search_path to 'public'
set work_mem to '96MB'
as $$
  with allowed as (
    select 1 where public.can_access_brand(p_brand_id)
  ),
  hits as (
    select c.prompt_result_id as rid,
           count(*)::int as cited,
           (min(c.position) + 1)::int as rnk
    from public.prompt_result_citations c
    where exists (select 1 from allowed)
      and c.brand_id = p_brand_id
      and c.url_id = any(p_url_ids)
      and (p_date_from is null or c.created_at >= p_date_from)
      and (p_date_to   is null or c.created_at <= p_date_to)
    group by c.prompt_result_id
  ),
  answers as (
    select h.rid, h.cited, h.rnk, pr.prompt_id, pr.platform, pr.model_used,
           pr.region, pr.created_at, pr.sentiment,
           coalesce(pr.mention_count, 0) > 0 as mentioned
    from hits h
    join public.prompt_results pr on pr.id = h.rid
    where pr.brand_id = p_brand_id
      and pr.platform <> 'chatgpt-shopping'
      and (p_date_from  is null or pr.created_at >= p_date_from)
      and (p_date_to    is null or pr.created_at <= p_date_to)
      and (p_models     is null or pr.model_used = any(p_models))
      and (p_regions    is null or pr.region = any(p_regions))
      and (p_prompt_ids is null or pr.prompt_id = any(p_prompt_ids))
      and (p_topic_ids  is null or pr.prompt_id in (
            select pp.id from public.prompts pp where pp.topic_id = any(p_topic_ids)))
  ),
  -- Grouped once and joined, rather than counted per answer in a correlated
  -- subselect: the subselect re-probed the index for each of the 2,084 rows
  -- the busiest URL returns.
  sizes as (
    select a.prompt_result_id as rid, count(*)::int as total
    from public.prompt_result_citations a
    where a.prompt_result_id in (select rid from answers)
    group by a.prompt_result_id
  )
  select a.rid, a.prompt_id, p.text, a.platform, a.model_used, a.region,
         a.created_at, a.sentiment, a.mentioned, a.cited, a.rnk,
         coalesce(s.total, a.cited)
  from answers a
  left join sizes s on s.rid = a.rid
  left join public.prompts p on p.id = a.prompt_id
  order by a.created_at desc;
$$;

-- ── citations_domains (00111) ──────────────────────────────────────────────
-- The Citations page: per-domain aggregates.

create or replace function public.citations_domains(
  p_brand_id uuid,
  p_date_from timestamptz default null,
  p_date_to timestamptz default null,
  p_models text[] default null,
  p_regions text[] default null,
  p_prompt_ids uuid[] default null,
  p_topic_ids uuid[] default null
)
returns table (domain text, total_citations bigint, results_citing bigint, models text[])
language plpgsql
stable
security definer
set search_path = public
set work_mem = '96MB'
set plan_cache_mode = force_custom_plan
as $$
#variable_conflict use_column
begin
  -- An end bound at or after now() excludes nothing, but it makes the
  -- planner estimate ~1 row for recent windows (see the header).
  if p_date_to >= now() then
    p_date_to := null;
  end if;

  return query
  with allowed as (
    select 1 where public.can_access_brand(p_brand_id)
  ),
  -- The brand's results in scope, read from the covering index.
  res as materialized (
    select pr.id, coalesce(pr.model_used, pr.platform) as m
    from public.prompt_results pr
    where exists (select 1 from allowed)
      and pr.brand_id = p_brand_id
      and pr.platform <> 'chatgpt-shopping'
      and (p_date_from  is null or pr.created_at >= p_date_from)
      and (p_date_to    is null or pr.created_at <= p_date_to)
      and (p_models     is null or pr.model_used = any(p_models))
      and (p_regions    is null or pr.region = any(p_regions))
      and (p_prompt_ids is null or pr.prompt_id = any(p_prompt_ids))
      and (p_topic_ids  is null or pr.prompt_id in (
            select pp.id from public.prompts pp where pp.topic_id = any(p_topic_ids)))
  ),
  -- Citations per (URL, result), before any URL is resolved to its domain.
  cites as materialized (
    select c.url_id, c.prompt_result_id as rid, count(*) as n
    from public.prompt_result_citations c
    where exists (select 1 from allowed)
      and c.brand_id = p_brand_id
      and (p_date_from is null or c.created_at >= p_date_from)
      and (p_date_to   is null or c.created_at <= p_date_to)
    group by c.url_id, c.prompt_result_id
  ),
  -- Each distinct URL's domain, looked up once.
  url_domains as materialized (
    select cu.id, cu.domain
    from public.citation_urls cu
    where cu.id in (select url_id from cites)
  ),
  pairs as (
    select ud.domain as d, ci.rid, sum(ci.n)::bigint as n, min(r.m) as m
    from cites ci
    join res r on r.id = ci.rid
    join url_domains ud on ud.id = ci.url_id
    group by ud.domain, ci.rid
  ),
  counts as (
    select d, sum(n)::bigint as tc, count(*)::bigint as rc from pairs group by d
  ),
  model_lists as (
    select d, array_agg(m order by m) as ms
    from (select distinct d, m from pairs) s
    group by d
  )
  select c.d, c.tc, c.rc, m.ms
  from counts c join model_lists m on m.d = c.d
  order by c.tc desc;
end;
$$;

-- ── citations_urls (00111) ─────────────────────────────────────────────────
-- The Citations page: per-URL aggregates.

create or replace function public.citations_urls(
  p_brand_id uuid,
  p_date_from timestamptz default null,
  p_date_to timestamptz default null,
  p_models text[] default null,
  p_regions text[] default null,
  p_prompt_ids uuid[] default null,
  p_topic_ids uuid[] default null,
  p_limit integer default 2000,
  p_domains text[] default null,
  p_exclude_domains text[] default null
)
returns table (
  url text, domain text, title text,
  total_citations bigint, results_citing bigint, models text[], total_urls bigint
)
language plpgsql
stable
security definer
set search_path = public
set work_mem = '96MB'
set plan_cache_mode = force_custom_plan
as $$
#variable_conflict use_column
begin
  -- An end bound at or after now() excludes nothing, but it makes the
  -- planner estimate ~1 row for recent windows (see the header).
  if p_date_to >= now() then
    p_date_to := null;
  end if;

  return query
  with allowed as (
    select 1 where public.can_access_brand(p_brand_id)
  ),
  -- The brand's results in scope, read from the covering index.
  res as materialized (
    select pr.id, coalesce(pr.model_used, pr.platform) as m
    from public.prompt_results pr
    where exists (select 1 from allowed)
      and pr.brand_id = p_brand_id
      and pr.platform <> 'chatgpt-shopping'
      and (p_date_from  is null or pr.created_at >= p_date_from)
      and (p_date_to    is null or pr.created_at <= p_date_to)
      and (p_models     is null or pr.model_used = any(p_models))
      and (p_regions    is null or pr.region = any(p_regions))
      and (p_prompt_ids is null or pr.prompt_id = any(p_prompt_ids))
      and (p_topic_ids  is null or pr.prompt_id in (
            select pp.id from public.prompts pp where pp.topic_id = any(p_topic_ids)))
  ),
  -- Citations per (URL, result), before the join to the results.
  cites as materialized (
    select c.url_id as uid, c.prompt_result_id as rid, count(*) as n
    from public.prompt_result_citations c
    where exists (select 1 from allowed)
      and c.brand_id = p_brand_id
      and (p_date_from is null or c.created_at >= p_date_from)
      and (p_date_to   is null or c.created_at <= p_date_to)
    group by c.url_id, c.prompt_result_id
  ),
  agg as (
    select ci.uid, sum(ci.n)::bigint as tc, count(*)::bigint as rc, array_agg(distinct r.m) as ms
    from cites ci
    join res r on r.id = ci.rid
    group by ci.uid
  ),
  include_ids as (
    select cu.id from public.citation_urls cu
    where p_domains is not null and cu.domain = any(p_domains)
  ),
  exclude_ids as (
    select cu.id from public.citation_urls cu
    where p_exclude_domains is not null and cu.domain = any(p_exclude_domains)
  ),
  scoped as (
    select a.*
    from agg a
    where (p_domains is null
           or exists (select 1 from include_ids i where i.id = a.uid))
      and (p_exclude_domains is null
           or not exists (select 1 from exclude_ids e where e.id = a.uid))
  )
  select cu.url, cu.domain, cu.title, a.tc, a.rc, a.ms,
         (select count(*)::bigint from scoped)
  from (select * from scoped order by tc desc, uid limit p_limit) a
  join public.citation_urls cu on cu.id = a.uid
  order by a.tc desc;
end;
$$;

-- ── citation_gap_domains (00111) ───────────────────────────────────────────
-- Citation gap: the domains competitors are cited from.

create or replace function public.citation_gap_domains(
  p_brand_id uuid,
  p_brand_domains text[],
  p_competitor_domains text[],
  p_date_from timestamptz default null,
  p_date_to timestamptz default null,
  p_models text[] default null,
  p_regions text[] default null,
  p_prompt_ids uuid[] default null,
  p_topic_ids uuid[] default null
)
returns table (
  domain text,
  competitor_answers bigint,
  appears_in_ours boolean,
  strength double precision,
  competitor_names text[],
  our_answer_count bigint,
  total_answers bigint
)
language plpgsql
stable
security definer
set search_path to 'public'
set work_mem to '96MB'
set plan_cache_mode to 'force_custom_plan'
as $$
#variable_conflict use_column
begin
  -- An end bound at or after now() excludes nothing, but it makes the
  -- planner estimate ~1 row for recent windows (see the header).
  if p_date_to >= now() then
    p_date_to := null;
  end if;

  return query
  with allowed as (
    select 1 where public.can_access_brand(p_brand_id)
  ),
  answers as materialized (
    select pr.id as rid,
           coalesce(pr.mention_count, 0) > 0 as we_mention,
           coalesce(
             jsonb_path_exists(pr.competitor_mentions, '$[*] ? (@.mention_count > 0)'),
             false
           ) as comp_present,
           pr.competitor_mentions
    from prompt_results pr
    where exists (select 1 from allowed)
      and pr.brand_id = p_brand_id
      and pr.platform <> 'chatgpt-shopping'
      and (p_date_from  is null or pr.created_at >= p_date_from)
      and (p_date_to    is null or pr.created_at <= p_date_to)
      and (p_models     is null or pr.model_used = any(p_models))
      and (p_regions    is null or pr.region = any(p_regions))
      and (p_prompt_ids is null or pr.prompt_id = any(p_prompt_ids))
      and (p_topic_ids  is null or pr.prompt_id in (
            select pp.id from public.prompts pp where pp.topic_id = any(p_topic_ids)))
  ),
  adomains as materialized (
    select distinct c.prompt_result_id as rid, cu.domain as d
    from prompt_result_citations c
    join citation_urls cu on cu.id = c.url_id
    where c.brand_id = p_brand_id
      and c.prompt_result_id in (select rid from answers)
  ),
  dtags as materialized (
    select s.d,
      exists (select 1 from unnest(p_brand_domains) e
              where s.d = e or right(s.d, length(e) + 1) = '.' || e) as is_you,
      exists (select 1 from unnest(p_competitor_domains) e
              where s.d = e or right(s.d, length(e) + 1) = '.' || e) as is_comp
    from (select distinct ad.d from adomains ad) s
  ),
  per_answer as (
    select ad.rid, 1.0 / count(*) as w, bool_or(t.is_you) as you_cited
    from adomains ad join dtags t on t.d = ad.d
    group by ad.rid
  ),
  flags as materialized (
    select a.rid,
           a.we_mention or coalesce(pa.you_cited, false) as we_present,
           a.comp_present,
           coalesce(pa.w, 0) as w
    from answers a
    left join per_answer pa on pa.rid = a.rid
  ),
  domain_rows as (
    select ad.d,
      count(*) filter (where f.comp_present and not f.we_present) as competitor_answers,
      bool_or(f.we_present) as appears,
      coalesce(sum(f.w) filter (where f.comp_present and not f.we_present), 0) as strength
    from adomains ad
    join dtags t on t.d = ad.d and not t.is_you and not t.is_comp
    join flags f on f.rid = ad.rid
    group by ad.d
  ),
  qualifying as (
    select f.rid from flags f where f.comp_present and not f.we_present
  ),
  mention_names as (
    select q.rid,
      case when co.id is not null
           then coalesce(nullif(trim(co.name), ''), 'Competitor')
           else coalesce(nullif(trim(x.e ->> 'name'), ''), 'Competitor')
      end as cname
    from qualifying q
    join answers a on a.rid = q.rid,
    lateral jsonb_array_elements(a.competitor_mentions) x(e)
    left join competitors co
      on co.brand_id = p_brand_id and co.id::text = x.e ->> 'competitor_id'
    where coalesce((x.e ->> 'mention_count')::numeric, 0) > 0
  ),
  domain_names as (
    select ad.d, array_agg(distinct mn.cname order by mn.cname) as names
    from adomains ad
    join dtags t on t.d = ad.d and not t.is_you and not t.is_comp
    join mention_names mn on mn.rid = ad.rid
    group by ad.d
  ),
  totals as (
    select count(*)::bigint as total_answers,
           (count(*) filter (where f.we_present))::bigint as our_answer_count
    from flags f
  )
  select dr.d, dr.competitor_answers::bigint, dr.appears, dr.strength::float8,
         coalesce(dn.names, '{}'::text[]), t.our_answer_count, t.total_answers
  from domain_rows dr
  left join domain_names dn on dn.d = dr.d
  cross join totals t
  where dr.competitor_answers > 0 or dr.appears
  union all
  select null, 0, false, 0, '{}'::text[], t.our_answer_count, t.total_answers
  from totals t;
end;
$$;

-- ── citation_competitor_sources (00111) ────────────────────────────────────
-- Citation gap: each competitor's sources.

create or replace function public.citation_competitor_sources(
  p_brand_id uuid,
  p_brand_domains text[],
  p_competitor_domains text[],
  p_date_from timestamptz default null,
  p_date_to timestamptz default null,
  p_models text[] default null,
  p_regions text[] default null,
  p_prompt_ids uuid[] default null,
  p_topic_ids uuid[] default null
)
returns table (
  competitor_id text,
  domain text,
  answers_feeding bigint,
  strength double precision
)
language plpgsql
stable
security definer
set search_path to 'public'
set work_mem to '96MB'
set plan_cache_mode to 'force_custom_plan'
as $$
#variable_conflict use_column
begin
  -- An end bound at or after now() excludes nothing, but it makes the
  -- planner estimate ~1 row for recent windows (see the header).
  if p_date_to >= now() then
    p_date_to := null;
  end if;

  return query
  with allowed as (
    select 1 where public.can_access_brand(p_brand_id)
  ),
  answers as materialized (
    select pr.id as rid, pr.competitor_mentions
    from prompt_results pr
    where exists (select 1 from allowed)
      and pr.brand_id = p_brand_id
      and pr.platform <> 'chatgpt-shopping'
      and (p_date_from  is null or pr.created_at >= p_date_from)
      and (p_date_to    is null or pr.created_at <= p_date_to)
      and (p_models     is null or pr.model_used = any(p_models))
      and (p_regions    is null or pr.region = any(p_regions))
      and (p_prompt_ids is null or pr.prompt_id = any(p_prompt_ids))
      and (p_topic_ids  is null or pr.prompt_id in (
            select pp.id from public.prompts pp where pp.topic_id = any(p_topic_ids)))
  ),
  adomains as materialized (
    select distinct c.prompt_result_id as rid, cu.domain as d
    from prompt_result_citations c
    join citation_urls cu on cu.id = c.url_id
    where c.brand_id = p_brand_id
      and c.prompt_result_id in (select rid from answers)
  ),
  dtags as materialized (
    select s.d,
      exists (select 1 from unnest(p_brand_domains) e
              where s.d = e or right(s.d, length(e) + 1) = '.' || e) as is_you,
      exists (select 1 from unnest(p_competitor_domains) e
              where s.d = e or right(s.d, length(e) + 1) = '.' || e) as is_comp
    from (select distinct ad.d from adomains ad) s
  ),
  per_answer as (
    select ad.rid, 1.0 / count(*) as w
    from adomains ad group by ad.rid
  ),
  mentions as materialized (
    select a.rid, x.e ->> 'competitor_id' as competitor_id
    from answers a,
    lateral jsonb_array_elements(a.competitor_mentions) x(e)
    where coalesce(
            jsonb_path_exists(a.competitor_mentions, '$[*] ? (@.mention_count > 0)'),
            false
          )
      and coalesce((x.e ->> 'mention_count')::numeric, 0) > 0
  )
  select m.competitor_id, ad.d,
         count(distinct m.rid)::bigint as answers_feeding,
         sum(pa.w)::float8 as strength
  from mentions m
  join adomains ad on ad.rid = m.rid
  join dtags t on t.d = ad.d and not t.is_you and not t.is_comp
  join per_answer pa on pa.rid = m.rid
  group by m.competitor_id, ad.d;
end;
$$;

-- ── citations_urls_daily (00119) ───────────────────────────────────────────
-- The Citations page's URLs, from the daily rollups.

create or replace function public.citations_urls_daily(
  p_brand_id uuid,
  p_day_from date default null,
  p_day_to date default null,
  p_models text[] default null,
  p_regions text[] default null,
  p_topic_ids uuid[] default null,
  p_limit integer default 2000,
  p_domains text[] default null,
  p_exclude_domains text[] default null
) returns table(url text, domain text, title text, total_citations bigint,
                results_citing bigint, models text[], total_urls bigint)
language plpgsql
stable
security definer
set search_path to 'public'
set work_mem to '64MB'
set plan_cache_mode to 'force_custom_plan'
as $$
#variable_conflict use_column
begin
  if not public.can_access_brand(p_brand_id) then
    return;
  end if;

  return query
  with agg as (
    select u.url_id as uid,
           sum(u.citations)::bigint as tc,
           sum(u.results)::bigint as rc,
           array_agg(distinct coalesce(u.model_used, u.platform)) as ms
    from public.citation_url_daily u
    where u.brand_id = p_brand_id
      and (p_day_from  is null or u.day >= p_day_from)
      and (p_day_to    is null or u.day <= p_day_to)
      and (p_models    is null or u.model_used = any(p_models))
      and (p_regions   is null or u.region = any(p_regions))
      and (p_topic_ids is null or u.topic_id = any(p_topic_ids))
    group by u.url_id
  ),
  include_ids as (
    select cu.id from public.citation_urls cu
    where p_domains is not null and cu.domain = any(p_domains)
  ),
  exclude_ids as (
    select cu.id from public.citation_urls cu
    where p_exclude_domains is not null and cu.domain = any(p_exclude_domains)
  ),
  scoped as materialized (
    select a.*
    from agg a
    where (p_domains is null
           or exists (select 1 from include_ids i where i.id = a.uid))
      and (p_exclude_domains is null
           or not exists (select 1 from exclude_ids e where e.id = a.uid))
  )
  select cu.url, cu.domain, cu.title, a.tc, a.rc, a.ms,
         (select count(*)::bigint from scoped)
  from (select * from scoped order by tc desc, uid limit p_limit) a
  join public.citation_urls cu on cu.id = a.uid
  order by a.tc desc;
end;
$$;

-- ── citation_gap_domains_daily (00203) ─────────────────────────────────────
-- Citation gap's domains, from the daily rollups.

create or replace function public.citation_gap_domains_daily(
  p_brand_id uuid,
  p_brand_domains text[],
  p_competitor_domains text[],
  p_day_from date default null,
  p_day_to date default null,
  p_models text[] default null,
  p_regions text[] default null,
  p_topic_ids uuid[] default null
)
returns table (
  domain text,
  competitor_answers bigint,
  appears_in_ours boolean,
  strength double precision,
  competitor_names text[],
  our_answer_count bigint,
  total_answers bigint
)
language plpgsql
stable
security definer
set search_path to 'public'
set work_mem to '64MB'
set plan_cache_mode to 'force_custom_plan'
as $$
#variable_conflict use_column
begin
  if not public.can_access_brand(p_brand_id) then
    return;
  end if;

  return query
  with g as (
    select d.domain as dm,
           sum(d.gap_answers)::bigint as ga,
           sum(d.gap_strength) as gs,
           sum(d.present_answers)::bigint as pa
    from public.citation_gap_domain_daily d
    where d.brand_id = p_brand_id
      and (p_day_from  is null or d.day >= p_day_from)
      and (p_day_to    is null or d.day <= p_day_to)
      and (p_models    is null or d.model_used = any(p_models))
      and (p_regions   is null or d.region = any(p_regions))
      and (p_topic_ids is null or d.topic_id = any(p_topic_ids))
    group by d.domain
  ),
  -- Third-party domains only: neither the brand's nor a competitor's.
  third_party as (
    select g.* from g
    where not exists (select 1 from unnest(p_brand_domains) e
                      where g.dm = e or right(g.dm, length(e) + 1) = '.' || e)
      and not exists (select 1 from unnest(p_competitor_domains) e
                      where g.dm = e or right(g.dm, length(e) + 1) = '.' || e)
  ),
  -- The competitors mentioned in the gap answers citing each domain.
  names as (
    select n.dm, array_agg(distinct n.cname order by n.cname) as names
    from (
      select c.domain as dm,
             case when co.id is not null
                  then coalesce(nullif(trim(co.name), ''), 'Competitor')
                  else c.competitor_name
             end as cname
      from public.citation_gap_competitor_daily c
      left join public.competitors co
        on co.brand_id = p_brand_id and co.id::text = c.competitor_id
      where c.brand_id = p_brand_id
        and c.gap_answers > 0
        and (p_day_from  is null or c.day >= p_day_from)
        and (p_day_to    is null or c.day <= p_day_to)
        and (p_models    is null or c.model_used = any(p_models))
        and (p_regions   is null or c.region = any(p_regions))
        and (p_topic_ids is null or c.topic_id = any(p_topic_ids))
    ) n
    group by n.dm
  ),
  totals as (
    select coalesce(sum(r.answers), 0)::bigint as total_answers,
           coalesce(sum(r.present_answers), 0)::bigint as our_answer_count
    from public.citation_result_daily r
    where r.brand_id = p_brand_id
      and (p_day_from  is null or r.day >= p_day_from)
      and (p_day_to    is null or r.day <= p_day_to)
      and (p_models    is null or r.model_used = any(p_models))
      and (p_regions   is null or r.region = any(p_regions))
      and (p_topic_ids is null or r.topic_id = any(p_topic_ids))
  )
  select t.dm, t.ga, t.pa > 0, coalesce(t.gs, 0)::float8,
         coalesce(n.names, '{}'::text[]), tt.our_answer_count, tt.total_answers
  from third_party t
  left join names n on n.dm = t.dm
  cross join totals tt
  where t.ga > 0 or t.pa > 0
  union all
  select null, 0::bigint, false, 0::float8, '{}'::text[], tt.our_answer_count, tt.total_answers
  from totals tt;
end;
$$;

-- ── citation_competitor_sources_daily (00203) ──────────────────────────────
-- Citation gap's competitor sources, from the daily rollups.

create or replace function public.citation_competitor_sources_daily(
  p_brand_id uuid,
  p_brand_domains text[],
  p_competitor_domains text[],
  p_day_from date default null,
  p_day_to date default null,
  p_models text[] default null,
  p_regions text[] default null,
  p_topic_ids uuid[] default null
)
returns table (
  competitor_id text,
  domain text,
  answers_feeding bigint,
  strength double precision
)
language plpgsql
stable
security definer
set search_path to 'public'
set work_mem to '64MB'
set plan_cache_mode to 'force_custom_plan'
as $$
#variable_conflict use_column
begin
  if not public.can_access_brand(p_brand_id) then
    return;
  end if;

  return query
  with agg as materialized (
    select c.competitor_id as cid, c.domain as dm,
           sum(c.answers)::bigint as af,
           sum(c.strength)::float8 as st
    from public.citation_gap_competitor_daily c
    where c.brand_id = p_brand_id
      and (p_day_from  is null or c.day >= p_day_from)
      and (p_day_to    is null or c.day <= p_day_to)
      and (p_models    is null or c.model_used = any(p_models))
      and (p_regions   is null or c.region = any(p_regions))
      and (p_topic_ids is null or c.topic_id = any(p_topic_ids))
    group by c.competitor_id, c.domain
  ),
  -- Third-party domains only, tagged once per domain.
  third_party as (
    select s.dm
    from (select distinct dm from agg) s
    where not exists (select 1 from unnest(p_brand_domains) e
                      where s.dm = e or right(s.dm, length(e) + 1) = '.' || e)
      and not exists (select 1 from unnest(p_competitor_domains) e
                      where s.dm = e or right(s.dm, length(e) + 1) = '.' || e)
  )
  select a.cid, a.dm, a.af, a.st
  from agg a
  join third_party t on t.dm = a.dm;
end;
$$;

-- ── report_citation_evidence (00063) ───────────────────────────────────────
-- The report's citation evidence.

CREATE OR REPLACE FUNCTION "public"."report_citation_evidence"(
  "p_brand_id" uuid,
  "p_date_from" timestamptz,
  "p_date_to" timestamptz,
  "p_limit" integer DEFAULT 10,
  "p_prompts_per_url" integer DEFAULT 3
)
RETURNS TABLE(
  "url" text,
  "domain" text,
  "title" text,
  "total_citations" bigint,
  "sourced_prompts" text[]
)
LANGUAGE "sql"
STABLE
SECURITY DEFINER
SET "search_path" TO 'public'
SET "work_mem" TO '96MB'
AS $$
  WITH allowed AS (
    SELECT 1
    WHERE public.can_access_brand(p_brand_id)
  ),
  -- citation_urls keeps the query string, so one page can sit under several
  -- ids (?utm_source=..., ?authuser=...). Evidence is about the page, not the
  -- link that reached it, so strip query and fragment and group on what is
  -- left — the same normalization the section applied before this moved into
  -- SQL. Without it the list shows the same article three times.
  pairs AS (
    SELECT
      regexp_replace(split_part(split_part(cu.url, '#', 1), '?', 1), '/$', '') AS norm_url,
      cu.domain AS domain,
      nullif(cu.title, '') AS title,
      pr.prompt_id AS prompt_id,
      count(*) AS n
    FROM prompt_result_citations c
    JOIN prompt_results pr ON pr.id = c.prompt_result_id
    JOIN citation_urls cu ON cu.id = c.url_id
    WHERE EXISTS (SELECT 1 FROM allowed)
      AND c.brand_id = p_brand_id
      AND pr.brand_id = p_brand_id
      AND pr.platform <> 'chatgpt-shopping'
      AND c.created_at >= p_date_from
      AND c.created_at <= p_date_to
      AND pr.created_at >= p_date_from
      AND pr.created_at <= p_date_to
    GROUP BY 1, 2, 3, 4, c.prompt_result_id
  ),
  agg AS (
    SELECT
      norm_url,
      sum(n)::bigint AS tc,
      min(domain) AS domain,
      min(title) AS title
    FROM pairs
    GROUP BY norm_url
  ),
  top AS (
    SELECT norm_url, tc, domain, title FROM agg ORDER BY tc DESC, norm_url LIMIT p_limit
  ),
  -- One row per (url, prompt text), then keep the first few per url. Ordering
  -- by text keeps the choice stable across runs of the same report.
  ranked AS (
    SELECT norm_url, text, row_number() OVER (PARTITION BY norm_url ORDER BY text) AS rn
    FROM (
      SELECT DISTINCT t.norm_url, p.text
      FROM top t
      JOIN pairs pa ON pa.norm_url = t.norm_url
      JOIN prompts p ON p.id = pa.prompt_id
      WHERE p.text IS NOT NULL AND p.text <> ''
    ) d
  )
  SELECT
    t.norm_url,
    coalesce(t.domain, ''),
    coalesce(t.title, ''),
    t.tc,
    coalesce(
      (SELECT array_agg(r.text ORDER BY r.rn)
       FROM ranked r
       WHERE r.norm_url = t.norm_url AND r.rn <= p_prompts_per_url),
      ARRAY[]::text[]
    )
  FROM top t
  ORDER BY t.tc DESC;
$$;

-- ── Comments ───────────────────────────────────────────────────────────────
-- Who may call each one, as the check above says it.

comment on function public.citations_window_stats(uuid, timestamptz, timestamptz, text[], text[], uuid[], uuid[]) is
  'Answers scanned and regions observed in a Citations window (#732) — the denominator for every usage percentage, including answers that cite nothing. Security definer, for a person who can access the brand (00426, can_access_brand); anyone else, the service role included, reads zero.';

comment on function public.citation_url_candidates(uuid, text) is
  'URLs on one domain that a brand has cited (#732), for the detail page to normalize and match in the app tier. Security definer, for a person who can access the brand (00426, can_access_brand); anyone else, the service role included, reads empty.';

comment on function public.citation_url_occurrences(uuid, bigint[], timestamptz, timestamptz, text[], text[], uuid[], uuid[]) is
  'Answers citing any of the given URL ids (#732) — the per-URL citation detail table, one row per answer. Security definer, for a person who can access the brand (00426, can_access_brand); anyone else, the service role included, reads empty.';

comment on function public.citations_domains(uuid, timestamptz, timestamptz, text[], text[], uuid[], uuid[]) is
  'Per-domain citation aggregates for the Citations page (#732). Returns every domain — the long tail is the point. Security definer, for a person who can access the brand (00426, can_access_brand); anyone else, the service role included, reads empty.';

comment on function public.citations_urls(
  uuid, timestamptz, timestamptz, text[], text[], uuid[], uuid[], integer, text[], text[]
) is
  'Top cited URLs for one brand, capped at p_limit by citation count (#732). p_domains / p_exclude_domains apply the source scope before the cap so it never reports a slice of the global top N as the whole scope (#745); the caller resolves the scope to domains, and total_urls counts the scoped set. Security definer, for a person who can access the brand (00426, can_access_brand); anyone else, the service role included, reads empty. plpgsql + force_custom_plan so the arguments reach the planner.';

comment on function public.citation_gap_domains(
  uuid, text[], text[], timestamptz, timestamptz, text[], text[], uuid[], uuid[]
) is
  'Per-domain competitor co-occurrence for the Competitor Gaps tab (#777). Third-party domains only; one null-domain summary row carries the answer totals. Security definer, for a person who can access the brand (00426, can_access_brand); anyone else, the service role included, reads only that summary row, at zero. plpgsql + force_custom_plan so the arguments reach the planner.';

comment on function public.citation_competitor_sources(
  uuid, text[], text[], timestamptz, timestamptz, text[], text[], uuid[], uuid[]
) is
  'Per-competitor source domains for the Competitor Gaps tab (#777), keyed by the competitor id recorded in the mention. Security definer, for a person who can access the brand (00426, can_access_brand); anyone else, the service role included, reads empty. plpgsql + force_custom_plan so the arguments reach the planner.';

comment on function public.citations_urls_daily(
  uuid, date, date, text[], text[], uuid[], integer, text[], text[]
) is
  'citations_urls over whole UTC days, from the daily rollups (00118): the top cited URLs, capped at p_limit, with total_urls counting the scoped set. Security definer (00119) because citation_urls has no select policy, for a person who can access the brand (00426, can_access_brand); anyone else, the service role included, reads empty.';

comment on function public.citation_gap_domains_daily(
  uuid, text[], text[], date, date, text[], text[], uuid[]
) is
  'Competitor Gaps (#1002): citation_gap_domains over whole UTC days, from the daily rollups. Third-party domains with their gap answers, strength, whether they appear in an answer where the brand is present, and the competitors in those gap answers; plus a null-domain row with the window''s totals. Security definer, for a person who can access the brand (00426, can_access_brand); anyone else, the service role included, reads empty.';

comment on function public.citation_competitor_sources_daily(
  uuid, text[], text[], date, date, text[], text[], uuid[]
) is
  'Competitor Gaps (#1002): citation_competitor_sources over whole UTC days, from the daily rollups. Per competitor, the third-party domains cited in answers that mention it, with the answer count and weight. Security definer, for a person who can access the brand (00426, can_access_brand); anyone else, the service role included, reads empty.';

comment on function public.report_citation_evidence(uuid, timestamptz, timestamptz, integer, integer) is
  'The report''s top cited pages (00063), query string and fragment stripped, each with up to p_prompts_per_url prompts whose answers cited it. Security definer because citation_urls has no select policy, for a person who can access the brand (00426, can_access_brand); anyone else, the service role included, reads empty.';

notify pgrst, 'reload schema';
