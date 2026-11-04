-- Read the per-URL citation detail page from prompt_result_citations (#732),
-- phase 3.
--
-- Phase 2 moved the Citations overview onto the citation rows and left the
-- detail page behind. It still pages every answer in the window out to the app
-- tier and looks for one URL in JavaScript: 60,442 rows carrying 75 MB of
-- jsonb across 61 sequential requests on the largest brand, to render a page
-- about a URL cited in 2,084 of them.
--
-- The cost is the visible half of the problem. The scan stops at 50,000 rows
-- and walks the window oldest-first, so that brand's detail page never reached
-- its newest 10,442 answers — five days of citations missing from the counts
-- and a "last seen" date five days stale, with nothing on screen to say so.
--
-- Matching stays in the app tier on purpose. The page aggregates by
-- `normalizeCitationUrl`, which folds away query strings and one trailing
-- slash, and that is not cosmetic: the largest brand's 124,134 distinct cited
-- URLs collapse to 73,289 under it. Reimplementing those rules in SQL would
-- make two definitions of the same identity that can drift apart. So SQL
-- narrows to a domain and the caller normalizes the candidates itself, with
-- the same function that renders them.

-- ─── Indexes ────────────────────────────────────────────────────────────────
-- Both replace a narrower index with the same leading column, so no query
-- loses an access path; the narrow ones are dropped below.
--
-- (brand_id, created_at) carrying url_id and prompt_result_id turns the
-- overview's scan of a brand's citations into an index-only scan: 8,296 ms of
-- random heap access became 273 ms, and citations_urls went from 11.9 s cold
-- (over the 8 s statement timeout for `authenticated`) to 2.0 s.
create index if not exists prompt_result_citations_brand_created_cover_idx
  on public.prompt_result_citations (brand_id, created_at desc)
  include (url_id, prompt_result_id);

-- (url_id, brand_id) answers "does this brand cite this URL" from the index
-- alone. citation_url_candidates probes it once per URL on the domain — 15,736
-- times for youtube.com — which cost 5,941 ms against the url_id-only index
-- and 66 ms against this one.
create index if not exists prompt_result_citations_url_brand_idx
  on public.prompt_result_citations (url_id, brand_id);

drop index if exists public.prompt_result_citations_brand_created_idx;
drop index if exists public.prompt_result_citations_url_idx;

-- ─── Domains ────────────────────────────────────────────────────────────────
-- Unchanged in what it returns; the model list is now built from the distinct
-- (domain, model) pairs instead of `array_agg(distinct m)` over every
-- (domain, answer) pair. The old form sorted 580,707 rows into 21,082 groups
-- and was the larger half of the function's runtime: 7.0 s against 2.8 s here,
-- which brings the last of the three overview functions under the timeout.
--
-- `order by m` keeps the array sorted, which is what array_agg(distinct)
-- guaranteed and what the page's own sort assumes.
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

-- ─── URL detail: candidates ─────────────────────────────────────────────────
-- Every URL on one domain that this brand has cited, for the caller to
-- normalize and match. Brand-scoped so an authenticated user cannot enumerate
-- the cross-tenant URL dictionary a domain at a time.
--
-- Deliberately unfiltered by window: which raw URLs fold into the target is a
-- property of the URL, not of the window, and the occurrence query applies the
-- window anyway. Filtering here would only make the candidate set depend on
-- the filter bar, so switching from 7d to 30d could change which variants of a
-- URL the page considers part of it.
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
  select cu.id, cu.url, cu.title
  from public.citation_urls cu
  where cu.domain = p_domain
    and exists (
      select 1 from public.prompt_result_citations c
      where c.url_id = cu.id and c.brand_id = p_brand_id
    );
$$;

-- ─── URL detail: occurrences ────────────────────────────────────────────────
-- One row per answer citing any of p_url_ids, carrying what the detail table
-- renders. The caller passes the ids its own normalization matched.
--
-- `rank` is `position + 1` because `position` is the citation's index in the
-- provider's original array, which is the ordering the page ranks by: every
-- one of 20,000 sampled answers has its citations already in startIndex order,
-- and position survives the entries the row writer drops as unparsable, so it
-- stays truer to the original array than counting rows would.
--
-- `total_sources` counts the answer's citation rows. That is the array length
-- except where an entry had no recoverable host — one answer in 19,176 on the
-- largest brand.
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
  with hits as (
    select c.prompt_result_id as rid,
           count(*)::int as cited,
           (min(c.position) + 1)::int as rnk
    from public.prompt_result_citations c
    where c.brand_id = p_brand_id
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

revoke all on function public.citation_url_candidates(uuid, text) from public;
revoke all on function public.citation_url_occurrences(uuid, bigint[], timestamptz, timestamptz, text[], text[], uuid[], uuid[]) from public;

grant execute on function public.citation_url_candidates(uuid, text) to authenticated, service_role;
grant execute on function public.citation_url_occurrences(uuid, bigint[], timestamptz, timestamptz, text[], text[], uuid[], uuid[]) to authenticated, service_role;

comment on function public.citation_url_candidates(uuid, text) is
  'URLs on one domain that a brand has cited (#732), for the detail page to normalize and match in the app tier.';
comment on function public.citation_url_occurrences(uuid, bigint[], timestamptz, timestamptz, text[], text[], uuid[], uuid[]) is
  'Answers citing any of the given URL ids (#732) — the per-URL citation detail table, one row per answer.';
