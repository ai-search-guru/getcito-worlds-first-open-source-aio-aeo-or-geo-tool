-- Put the org-membership guard on the five reachable citation RPCs (#779).
--
-- All five are `security definer` and cannot stop being so: they read
-- `citation_urls`, a cross-tenant dictionary with no select policy of its own,
-- so an invoker-rights version would return nothing to anyone. Definer rights
-- mean RLS is not consulted at all, and the only thing standing between an
-- authenticated caller and another organization's citation data was the web
-- tier passing the right `p_brand_id`. Practical exposure was small — brand
-- ids are unguessable uuids and the payloads are aggregates — but the tenant
-- boundary belongs in the database, where `report_citation_evidence` (00063)
-- and the gap functions (00068) already put it.
--
-- The guard is their `allowed` CTE, unchanged: a non-member's scan filters to
-- nothing rather than raising, so the page renders its empty state instead of
-- an error. `citation_url_ids` shares the definer pattern but carries no
-- `authenticated` grant, so it is unreachable and left alone.
--
-- Bodies are otherwise identical to 00061 and 00067 — the guard is the only
-- change, and a member's results are byte-for-byte what they were.
--
-- One consequence worth stating: `auth.uid()` is null under the service role,
-- so a service-role caller now reads empty. Nothing calls these that way today
-- (the five have exactly one caller, `frontend/src/lib/actions/citations.ts`, and
-- every call site uses the user-session client; the MCP layer runs its own
-- queries behind its own ownership check, and `backend/src` never touches
-- them). A future service-role caller has to come through a user context or
-- change this deliberately — the comments below say so.

-- ─── Domains ────────────────────────────────────────────────────────────────
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
set search_path to 'public'
set work_mem to '96MB'
as $$
  with allowed as (
    select 1 from brands b
    join profiles pf on pf.organization_id = b.organization_id
    where b.id = p_brand_id and pf.id = auth.uid()
  ),
  pairs as (
    select cu.domain as d, c.prompt_result_id as rid, count(*) as n,
           min(coalesce(pr.model_used, pr.platform)) as m
    from public.prompt_result_citations c
    join public.prompt_results pr on pr.id = c.prompt_result_id
    join public.citation_urls cu on cu.id = c.url_id
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
    group by cu.domain, c.prompt_result_id
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
$$;

-- ─── URLs ───────────────────────────────────────────────────────────────────
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
-- The one function whose shape survives the guard: it is a single aggregate
-- row, so a non-member reads zero answers and no regions rather than no row.
-- That is what the page's percentages already divide by when a window is
-- empty.
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
    select 1 from brands b
    join profiles pf on pf.organization_id = b.organization_id
    where b.id = p_brand_id and pf.id = auth.uid()
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

-- ─── URL detail: candidates ─────────────────────────────────────────────────
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
    select 1 from brands b
    join profiles pf on pf.organization_id = b.organization_id
    where b.id = p_brand_id and pf.id = auth.uid()
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

-- ─── URL detail: occurrences ────────────────────────────────────────────────
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
    select 1 from brands b
    join profiles pf on pf.organization_id = b.organization_id
    where b.id = p_brand_id and pf.id = auth.uid()
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

comment on function public.citations_domains(uuid, timestamptz, timestamptz, text[], text[], uuid[], uuid[]) is
  'Per-domain citation aggregates for the Citations page (#732). Returns every domain — the long tail is the point. Members of the brand''s organization only (#779): a service-role caller reads empty.';
comment on function public.citations_urls(uuid, timestamptz, timestamptz, text[], text[], uuid[], uuid[], integer) is
  'Per-URL citation aggregates for the Citations page (#732), capped at p_limit and ordered by citation count. Every row carries total_urls, the uncapped count. Members of the brand''s organization only (#779): a service-role caller reads empty.';
comment on function public.citations_window_stats(uuid, timestamptz, timestamptz, text[], text[], uuid[], uuid[]) is
  'Answers scanned and regions observed in a Citations window (#732) — the denominator for every usage percentage, including answers that cite nothing. Members of the brand''s organization only (#779): a service-role caller reads zero.';
comment on function public.citation_url_candidates(uuid, text) is
  'URLs on one domain that a brand has cited (#732), for the detail page to normalize and match in the app tier. Members of the brand''s organization only (#779): a service-role caller reads empty.';
comment on function public.citation_url_occurrences(uuid, bigint[], timestamptz, timestamptz, text[], text[], uuid[], uuid[]) is
  'Answers citing any of the given URL ids (#732) — the per-URL citation detail table, one row per answer. Members of the brand''s organization only (#779): a service-role caller reads empty.';
