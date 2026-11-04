-- Citations page: ignore an end bound that excludes nothing.
--
-- The Citations server action sends every preset window with p_date_to set to
-- the end of today. That bound excludes nothing, since no result is newer than
-- now. But with both bounds on created_at, the planner estimates about one row
-- for a recent window: the column statistics end before the newest days. It
-- then joins the materialized results to the citations with a nested loop.
--
-- On the largest brand's default 24-hour view this turned a 0.2 s
-- citations_domains into one past 30 s, and the page failed to open. Without
-- the bound the same call runs in 0.2 s. The Competitor Gaps reads failed the
-- same way.
--
-- Each of these functions now treats an end bound at or after now() as no end
-- bound. A custom range that ends in the past is unchanged. Bodies are
-- otherwise as in 00077 (gap functions), 00107 and 00109. CREATE OR REPLACE
-- keeps the signatures, settings and grants.

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
    select 1 from brands b
    join profiles pf on pf.organization_id = b.organization_id
    where b.id = p_brand_id and pf.id = auth.uid()
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
    select 1 from brands b
    join profiles pf on pf.organization_id = b.organization_id
    where b.id = p_brand_id and pf.id = auth.uid()
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
    select 1 from brands b
    join profiles pf on pf.organization_id = b.organization_id
    where b.id = p_brand_id and pf.id = auth.uid()
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
    select 1 from brands b
    join profiles pf on pf.organization_id = b.organization_id
    where b.id = p_brand_id and pf.id = auth.uid()
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
