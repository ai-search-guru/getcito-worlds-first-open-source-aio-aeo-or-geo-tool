-- Read the Citations page from prompt_result_citations (#732), phase 2.
--
-- Phase 1 wrote every citation as a row. Nothing read them: the page still
-- paged the raw answers out to the app tier — 50 sequential requests carrying
-- 65 MB of jsonb for the largest brand, capped at 50,000 rows, which silently
-- truncated that brand at its 51,679. These are what it reads instead.
--
-- Three functions rather than one, because combining them is slower. A single
-- function needs one CTE feeding several aggregations, which Postgres
-- materializes once it is referenced more than once, and the spill of 744,302
-- rows carrying domain text costs more than scanning twice. Two attempts at
-- the combined shape both exceeded the statement timeout; these run in 1.8 to
-- 4.6 seconds against the largest brand's full history.
--
-- Each is `security definer` because citation_urls is a cross-tenant
-- dictionary with no select policy of its own (see 00058), and each filters on
-- p_brand_id, which is what scopes the answer to the caller's own data.
--
-- `work_mem` is raised for the two aggregating functions. The instance default
-- is 3.5 MB, and the grouping needs roughly 60 MB — without this it spills to
-- disk and the same query takes twice as long.

-- ─── Domains ────────────────────────────────────────────────────────────────
-- Every domain, uncapped. The long tail is the point of the page: 20,366
-- domains on the largest brand, and the ones cited once are exactly what a
-- customer is looking for.
--
-- Two-level aggregation on purpose. `count(distinct prompt_result_id)` in one
-- pass makes the planner sort 744,302 rows; grouping to (domain, answer) pairs
-- first lets it hash both levels, which is 1.75s against 2.36s.

create or replace function public.citations_domains(
  p_brand_id uuid,
  p_date_from timestamptz default null,
  p_date_to timestamptz default null,
  p_models text[] default null,
  p_regions text[] default null,
  p_prompt_ids uuid[] default null,
  p_topic_ids uuid[] default null
)
returns table (
  domain text,
  total_citations bigint,
  results_citing bigint,
  models text[]
)
language sql
stable
security definer
set search_path = public
set work_mem = '96MB'
as $$
  with pairs as (
    select cu.domain as d, c.prompt_result_id as rid, count(*) as n,
           min(coalesce(pr.model_used, pr.platform)) as m
    from public.prompt_result_citations c
    join public.prompt_results pr on pr.id = c.prompt_result_id
    join public.citation_urls cu on cu.id = c.url_id
    where c.brand_id = p_brand_id
      and pr.brand_id = p_brand_id
      and pr.platform <> 'chatgpt-shopping'
      and (p_date_from  is null or (c.created_at >= p_date_from and pr.created_at >= p_date_from))
      and (p_date_to    is null or (c.created_at <= p_date_to   and pr.created_at <= p_date_to))
      and (p_models     is null or pr.model_used = any(p_models))
      and (p_regions    is null or pr.region = any(p_regions))
      and (p_prompt_ids is null or pr.prompt_id = any(p_prompt_ids))
      and (p_topic_ids  is null or pr.prompt_id in (
            select pp.id from public.prompts pp where pp.topic_id = any(p_topic_ids)))
    group by cu.domain, c.prompt_result_id
  )
  select d, sum(n)::bigint, count(*)::bigint, array_agg(distinct m)
  from pairs group by d
  order by 2 desc;
$$;

-- ─── URLs ───────────────────────────────────────────────────────────────────
-- Capped, unlike domains. The largest brand has 117,316 distinct URLs in its
-- window — 25 MB of payload for a table that shows a hundred at a time. Every
-- row carries `total_urls`, the uncapped count, so the surface can say how
-- many it is not showing rather than implying it has them all.

create or replace function public.citations_urls(
  p_brand_id uuid,
  p_date_from timestamptz default null,
  p_date_to timestamptz default null,
  p_models text[] default null,
  p_regions text[] default null,
  p_prompt_ids uuid[] default null,
  p_topic_ids uuid[] default null,
  p_limit integer default 2000
)
returns table (
  url text,
  domain text,
  title text,
  total_citations bigint,
  results_citing bigint,
  models text[],
  total_urls bigint
)
language sql
stable
security definer
set search_path = public
set work_mem = '96MB'
as $$
  with pairs as (
    select c.url_id as uid, c.prompt_result_id as rid, count(*) as n,
           min(coalesce(pr.model_used, pr.platform)) as m
    from public.prompt_result_citations c
    join public.prompt_results pr on pr.id = c.prompt_result_id
    where c.brand_id = p_brand_id
      and pr.brand_id = p_brand_id
      and pr.platform <> 'chatgpt-shopping'
      and (p_date_from  is null or (c.created_at >= p_date_from and pr.created_at >= p_date_from))
      and (p_date_to    is null or (c.created_at <= p_date_to   and pr.created_at <= p_date_to))
      and (p_models     is null or pr.model_used = any(p_models))
      and (p_regions    is null or pr.region = any(p_regions))
      and (p_prompt_ids is null or pr.prompt_id = any(p_prompt_ids))
      and (p_topic_ids  is null or pr.prompt_id in (
            select pp.id from public.prompts pp where pp.topic_id = any(p_topic_ids)))
    group by c.url_id, c.prompt_result_id
  ),
  agg as (
    select uid, sum(n)::bigint as tc, count(*)::bigint as rc, array_agg(distinct m) as ms
    from pairs group by uid
  )
  -- The dictionary is joined after the limit, so the URL text is fetched for
  -- the rows that survive rather than for all 117,316 of them.
  select cu.url, cu.domain, cu.title, a.tc, a.rc, a.ms,
         (select count(*)::bigint from agg)
  from (select * from agg order by tc desc, uid limit p_limit) a
  join public.citation_urls cu on cu.id = a.uid
  order by a.tc desc;
$$;

-- ─── Window stats ───────────────────────────────────────────────────────────
-- Separate from the aggregates because it counts answers that cite nothing,
-- which is the denominator every usage percentage on the page divides by. The
-- citation tables cannot see those answers at all.

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
  select count(*)::bigint,
         coalesce(array_agg(distinct pr.region) filter (where pr.region is not null), '{}')
  from public.prompt_results pr
  where pr.brand_id = p_brand_id
    and pr.platform <> 'chatgpt-shopping'
    and (p_date_from  is null or pr.created_at >= p_date_from)
    and (p_date_to    is null or pr.created_at <= p_date_to)
    and (p_models     is null or pr.model_used = any(p_models))
    and (p_regions    is null or pr.region = any(p_regions))
    and (p_prompt_ids is null or pr.prompt_id = any(p_prompt_ids))
    and (p_topic_ids  is null or pr.prompt_id in (
          select pp.id from public.prompts pp where pp.topic_id = any(p_topic_ids)));
$$;

revoke all on function public.citations_domains(uuid, timestamptz, timestamptz, text[], text[], uuid[], uuid[]) from public;
revoke all on function public.citations_urls(uuid, timestamptz, timestamptz, text[], text[], uuid[], uuid[], integer) from public;
revoke all on function public.citations_window_stats(uuid, timestamptz, timestamptz, text[], text[], uuid[], uuid[]) from public;

grant execute on function public.citations_domains(uuid, timestamptz, timestamptz, text[], text[], uuid[], uuid[]) to authenticated, service_role;
grant execute on function public.citations_urls(uuid, timestamptz, timestamptz, text[], text[], uuid[], uuid[], integer) to authenticated, service_role;
grant execute on function public.citations_window_stats(uuid, timestamptz, timestamptz, text[], text[], uuid[], uuid[]) to authenticated, service_role;

comment on function public.citations_domains(uuid, timestamptz, timestamptz, text[], text[], uuid[], uuid[]) is
  'Per-domain citation aggregates for the Citations page (#732). Returns every domain — the long tail is the point.';
comment on function public.citations_urls(uuid, timestamptz, timestamptz, text[], text[], uuid[], uuid[], integer) is
  'Per-URL citation aggregates for the Citations page (#732), capped at p_limit and ordered by citation count. Every row carries total_urls, the uncapped count.';
comment on function public.citations_window_stats(uuid, timestamptz, timestamptz, text[], text[], uuid[], uuid[]) is
  'Answers scanned and regions observed in a Citations window (#732) — the denominator for every usage percentage, including answers that cite nothing.';
