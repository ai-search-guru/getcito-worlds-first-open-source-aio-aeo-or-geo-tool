-- Plan the heavy citation reads with their arguments known.
--
-- A `language sql` function's body is planned with the arguments as
-- parameters whose values the planner never sees, so it always runs a
-- generic plan — and for these functions the generic plan is nothing like
-- the one the same query gets with real arguments.
--
-- Measured on the hosted database as a member of the owning organization:
--
--   * `citations_urls` on the largest brand (913k citation rows), 30-day
--     window: 13.9 s on a cold cache — the page's 8 s statement timeout —
--     against ~2 s with a custom plan.
--   * `citation_gap_domains` was worse: the generic plan did not finish a
--     30-day window in 110 s on any brand above ~50k citation rows, and on
--     the largest brand even the 24-hour default window hit the 8 s timeout.
--     The page swallows that error, so Competitor Gaps rendered as an empty
--     tab. With a custom plan the largest brand's 24-hour window answers in
--     0.4 s and its 30-day window in 5.5 s.
--
-- The cure is the one 00070 applied to `citations_domains`: move the body
-- to plpgsql, which plans through the SPI cache with the argument values in
-- hand, and set `plan_cache_mode = force_custom_plan` so it does not settle
-- on a generic plan after five calls. Re-planning costs about 2 ms per call
-- against seconds saved. Bodies are unchanged — same CTEs, same membership
-- guards (00068/00069), same output, verified row-identical against the
-- shipped functions in both directions (unscoped and scoped for the URL
-- list; both gap functions on a window the old plans could finish).
--
-- This migration carries all four so the repository states the whole rule in
-- one place: 00076 rewrote `citations_urls` from the pre-00070 source and
-- silently reverted it to `language sql`, which is how the cold-cache
-- timeout came back. `citations_domains` is re-stated verbatim.
--
-- `#variable_conflict use_column` because `returns table` turns every output
-- name into a variable: `domain`, `url` and `models` exist as columns in
-- these queries, and unqualified references would otherwise resolve to the
-- variable.
--
-- Known limit, accepted for now: the largest brand's all-time gap window
-- measures 8.9 s cold — right at the timeout. Every preset window and every
-- other brand fits comfortably; shrinking the all-time case needs rollups,
-- not a plan mode.
--
-- `citations_window_stats` and the url-detail functions stay `language sql`:
-- their generic plans measure in the tens of milliseconds.

-- ─── Domains (unchanged, restated from 00070) ───────────────────────────────

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
language plpgsql
stable
security definer
set search_path to 'public'
set work_mem to '96MB'
set plan_cache_mode to 'force_custom_plan'
as $$
#variable_conflict use_column
begin
  return query
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
end;
$$;

-- ─── URLs (body from 00076, planning mode restored) ─────────────────────────

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
language plpgsql
stable
security definer
set search_path to 'public'
set work_mem to '96MB'
set plan_cache_mode to 'force_custom_plan'
as $$
#variable_conflict use_column
begin
  return query
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

-- ─── Competitor gap domains (body from 00068/00069) ─────────────────────────

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

-- ─── Competitor sources (body from 00068/00069) ─────────────────────────────

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

-- ─── Grants and comments ────────────────────────────────────────────────────
-- create or replace preserves existing grants; restated so this file reads
-- complete on its own.

revoke all on function public.citations_domains(
  uuid, timestamptz, timestamptz, text[], text[], uuid[], uuid[]
) from public;
grant execute on function public.citations_domains(
  uuid, timestamptz, timestamptz, text[], text[], uuid[], uuid[]
) to authenticated, service_role;

revoke all on function public.citations_urls(
  uuid, timestamptz, timestamptz, text[], text[], uuid[], uuid[], integer, text[], text[]
) from public;
grant execute on function public.citations_urls(
  uuid, timestamptz, timestamptz, text[], text[], uuid[], uuid[], integer, text[], text[]
) to authenticated, service_role;

revoke all on function public.citation_gap_domains(
  uuid, text[], text[], timestamptz, timestamptz, text[], text[], uuid[], uuid[]
) from public;
grant execute on function public.citation_gap_domains(
  uuid, text[], text[], timestamptz, timestamptz, text[], text[], uuid[], uuid[]
) to authenticated, service_role;

revoke all on function public.citation_competitor_sources(
  uuid, text[], text[], timestamptz, timestamptz, text[], text[], uuid[], uuid[]
) from public;
grant execute on function public.citation_competitor_sources(
  uuid, text[], text[], timestamptz, timestamptz, text[], text[], uuid[], uuid[]
) to authenticated, service_role;

comment on function public.citations_urls(
  uuid, timestamptz, timestamptz, text[], text[], uuid[], uuid[], integer, text[], text[]
) is
  'Top cited URLs for one brand, capped at p_limit by citation count (#732). p_domains / p_exclude_domains apply the source scope before the cap so it never reports a slice of the global top N as the whole scope (#745); the caller resolves the scope to domains, and total_urls counts the scoped set. Security definer with an explicit org-membership guard (#780). plpgsql + force_custom_plan so the arguments reach the planner.';

comment on function public.citation_gap_domains(
  uuid, text[], text[], timestamptz, timestamptz, text[], text[], uuid[], uuid[]
) is
  'Per-domain competitor co-occurrence for the Competitor Gaps tab (#777). Third-party domains only; one null-domain summary row carries the answer totals. plpgsql + force_custom_plan so the arguments reach the planner.';

comment on function public.citation_competitor_sources(
  uuid, text[], text[], timestamptz, timestamptz, text[], text[], uuid[], uuid[]
) is
  'Per-competitor source domains for the Competitor Gaps tab (#777), keyed by the competitor id recorded in the mention. plpgsql + force_custom_plan so the arguments reach the planner.';
