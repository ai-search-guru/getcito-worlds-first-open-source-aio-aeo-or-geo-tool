-- Citations page: keep `citations_domains` under the 8 s statement timeout.
--
-- On the largest brand (~116k results and ~914k citation rows in 30 days) the
-- domain table timed out and the Citations page failed to open. Measured on
-- the hosted database, 30-day window:
--
--   * Reading the brand's results went through `idx_prompt_results_created_at`
--     — every brand's results in the window, filtered afterwards — and then
--     to the heap for platform and model. prompt_results rows carry the full
--     answer text, so each row is its own page read: 8–25 s on its own.
--   * Every citation row looked its URL up in citation_urls (914k index
--     lookups) only to group the result by domain.
--
-- Two changes, same output:
--
--   1. A covering index on prompt_results (brand_id, created_at) that carries
--      the columns these reads filter and group on, so the brand's results
--      in a window come from the index alone. Reading them dropped to ~2 s
--      cold. Other brand-and-window reads over the same columns can use it.
--      Built on production with CREATE INDEX CONCURRENTLY before this ran;
--      `if not exists` makes it a no-op there.
--   2. `citations_domains` groups citations by URL first and looks up each
--      distinct URL's domain once (124k lookups instead of 914k).
--
-- Verified row-identical against the previous body on a brand with ~40k
-- citations in 30 days: same 3,612 domains, citation counts, result counts
-- and model lists. Signature, security definer, membership guard, settings
-- and grants are unchanged.

create index if not exists idx_prompt_results_brand_created_cover
  on public.prompt_results (brand_id, created_at desc)
  include (id, platform, model_used, region, prompt_id);

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

revoke all on function public.citations_domains(
  uuid, timestamptz, timestamptz, text[], text[], uuid[], uuid[]
) from public;
grant execute on function public.citations_domains(
  uuid, timestamptz, timestamptz, text[], text[], uuid[], uuid[]
) to authenticated, service_role;
