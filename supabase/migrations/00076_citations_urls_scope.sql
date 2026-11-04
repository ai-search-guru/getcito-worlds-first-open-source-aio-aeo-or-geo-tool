-- Apply the source scope inside the URL cap, not after it (#745).
--
-- Two changes that are each right on their own combined badly. #744 caps the
-- URL list at the top 2,000 by citation count, which is what makes the page
-- affordable — the largest brand has 97,320 distinct cited URLs in a 30-day
-- window. #742 then moved the source scope (All · Brand · Competitors ·
-- Third-party) to the client, over the rows that arrived, which is what
-- removed the round trip the scope used to cost.
--
-- So the scope filters *within* the global top 2,000. Measured on that brand:
--
--   scope          shown   actually exist
--   Brand             21              395
--   Competitors      125            2,794
--
-- And it is silent. The pager counts what it filtered, so the tab reads
-- "125 of 125" — a reader cannot tell "this brand has 125 competitor URLs"
-- from "125 of them happened to rank in the global top two thousand".
--
-- The fix is to hand the function the domains the scope resolves to and let
-- it cut the set before the limit. What a brand or competitor domain *is*
-- stays in TypeScript: `classifyDomain` decides it from brand_domains and
-- competitors with a suffix match, the caller already runs it over every
-- aggregated domain to build the Domains tab, and duplicating that rule in
-- SQL would give it two definitions to drift apart.
--
-- Two parameters rather than one, and this is a deliberate departure from the
-- issue's sketch. Resolving every scope to an include list would mean sending
-- 17,532 domains for Third-party — the whole cited set minus fourteen. Naming
-- the fourteen to exclude says the same thing in a request that fits in a
-- packet. Every scope now resolves to a handful of domains:
--
--   All           neither parameter
--   Brand         p_domains          — the cited domains classified 'you'
--   Competitors   p_domains          — those classified 'competitor'
--   Third-party   p_exclude_domains  — both of the above
--
-- The filter sits after the aggregate, not inside it, and that placement is
-- load-bearing. Pushed down into the citation scan, the planner abandons the
-- hash join for a nested loop over the matching url ids: 4.57s against a
-- 1.67s unscoped baseline, uncomfortably close to the 8s statement timeout on
-- a warm cache. Applied to the aggregated rows it stays a hash semi-join
-- costing 11ms, and every scope lands within noise of the unscoped query —
-- 1.62s (Brand), 1.68s (Competitors), 1.73s (Third-party).
--
-- The old 8-argument signature is dropped rather than left beside the new
-- one: keeping both makes an 8-argument call ambiguous. PostgREST binds by
-- name, so no in-flight request depends on argument position and the deploy
-- window is safe — the same reason 00072 could do this.

drop function if exists public.citations_urls(
  uuid, timestamptz, timestamptz, text[], text[], uuid[], uuid[], integer
);

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
  with allowed as (
    select 1 from brands b
    join profiles pf on pf.organization_id = b.organization_id
    where b.id = p_brand_id and pf.id = auth.uid()
  ),
  pairs as (
    select c.url_id as uid, c.prompt_result_id as rid, count(*) as n,
           min(coalesce(pr.model_used, pr.platform)) as m
    from public.prompt_result_citations c
    join public.prompt_results pr on pr.id = c.prompt_result_id
    where exists (select 1 from allowed)
      and c.brand_id = p_brand_id
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
  ),
  -- Domains resolve to url ids through citation_urls.domain, which is indexed
  -- and stored already lowercased and without `www.` — so this is a probe per
  -- domain rather than a scan. Both sets stay empty when their parameter is
  -- null, which is what keeps the unscoped path identical to before.
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
  -- total_urls counts the scoped set, so the tab reports how many URLs the
  -- selected scope actually has rather than how many survived the cap. The
  -- dictionary is still joined after the limit, so URL text is fetched for
  -- the rows that survive rather than for all 97,320 of them.
  select cu.url, cu.domain, cu.title, a.tc, a.rc, a.ms,
         (select count(*)::bigint from scoped)
  from (select * from scoped order by tc desc, uid limit p_limit) a
  join public.citation_urls cu on cu.id = a.uid
  order by a.tc desc;
$$;

revoke all on function public.citations_urls(
  uuid, timestamptz, timestamptz, text[], text[], uuid[], uuid[], integer, text[], text[]
) from public;

grant execute on function public.citations_urls(
  uuid, timestamptz, timestamptz, text[], text[], uuid[], uuid[], integer, text[], text[]
) to authenticated, service_role;

comment on function public.citations_urls(
  uuid, timestamptz, timestamptz, text[], text[], uuid[], uuid[], integer, text[], text[]
) is
  'Top cited URLs for one brand, capped at p_limit by citation count (#732). p_domains / p_exclude_domains apply the source scope before the cap so it never reports a slice of the global top N as the whole scope (#745); the caller resolves the scope to domains, and total_urls counts the scoped set. Security definer with an explicit org-membership guard (#780).';
