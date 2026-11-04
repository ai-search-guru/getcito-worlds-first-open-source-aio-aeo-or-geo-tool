-- Citations page: the same fix as 00107, for the URL table.
--
-- `citations_urls` joined each citation to its result row and filtered the
-- results by date on both sides, so the planner read the brand's results
-- through the created_at index and the heap. The daily health report timed
-- it at 9.6 s on the largest brand's 30-day window, past the page's 8 s
-- statement timeout.
--
-- The brand's results in scope now come from the covering index 00107 added
-- (idx_prompt_results_brand_created_cover), and citations are grouped by
-- (URL, result) before the join. 30-day window on the largest brand: 1.9 s.
-- Verified row-identical against the previous body on a brand with ~13k
-- cited URLs in 30 days (URL, citation count, result count, models).
-- Signature, security definer, membership guard, settings and grants are
-- unchanged.

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

revoke all on function public.citations_urls(
  uuid, timestamptz, timestamptz, text[], text[], uuid[], uuid[], integer, text[], text[]
) from public;
grant execute on function public.citations_urls(
  uuid, timestamptz, timestamptz, text[], text[], uuid[], uuid[], integer, text[], text[]
) to authenticated, service_role;
