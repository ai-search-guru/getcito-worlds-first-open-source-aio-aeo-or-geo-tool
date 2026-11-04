-- Read Competitor Gaps from prompt_result_citations (#777), phase 4 of #732.
--
-- getCitationGaps was the last reader paging raw answers to the app tier:
-- every answer in the window with its `citations` AND `competitor_mentions`
-- jsonb attached — 77 MB + 52 MB across 62,285 rows on the largest brand —
-- and, like the detail page before #776, capped at 50,000 rows oldest-first,
-- so the newest answers were silently missing from the gap analysis.
--
-- Domain identity comes from `citation_urls.domain`, written by the same
-- hostname extraction the page used to run per read (verified: 135,040
-- (answer, domain) pairs computed both ways on a full brand, zero different).
-- The you/competitor split cannot be precomputed there, because it depends on
-- the brand's CURRENT domain lists — so the caller passes those lists in and
-- the suffix rule (`d = entry or d ends with ".entry"`) runs here, on the
-- distinct domains only. The rest of classification (forum/social/editorial…)
-- stays in the app tier; it is display-only for this page.
--
-- Both functions carry the membership guard from report_citation_evidence:
-- they are security definer (citation_urls has no select policy of its own),
-- so without the guard any authenticated user could read any brand's gap
-- data by uuid. The `allowed` CTE pins execution to members of the brand's
-- organization; service_role clients get empty results, which no current
-- caller minds — both are called from user-session server actions.
--
-- `jsonb_path_exists` instead of expanding competitor_mentions: the answer
-- "does this answer mention any competitor" does not need rows, and the
-- expansion was the single largest cost of the naive shape (3.8 s of the
-- 8.6 s total on the largest brand; this shape measures 3.8 s end to end).
-- Full expansion happens only where entries are actually needed: names on
-- gap-qualifying answers, per-competitor rows in citation_competitor_sources.

-- ─── Gap domains ────────────────────────────────────────────────────────────
-- One row per third-party domain the window cites, with the co-occurrence
-- counts the Competitor Gaps tab aggregates today, plus one summary row
-- (domain null) so the answer totals survive even when no domain qualifies.
--
-- Semantics mirror the page exactly:
--   * an answer's weight is 1 / its distinct cited domains;
--   * "we are present" = brand mentioned OR any own-domain cited;
--   * a domain's gap counters only grow from answers where a competitor is
--     mentioned and we are absent; appears_in_ours records the opposite side;
--   * domains on the brand's or a competitor's own sites are excluded — only
--     third-party publications are actionable.
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
  -- The suffix match runs once per distinct domain, not once per pair.
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
  -- Competitor names only exist on gap-qualifying answers, so the jsonb
  -- expansion is bounded by those instead of the whole window. A mention of
  -- a still-live competitor renders under its current name; a deleted one
  -- keeps the name recorded in the answer.
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
$$;

-- ─── Per-competitor source domains ──────────────────────────────────────────
-- (competitor, third-party domain) rows for the per-competitor source map.
-- Unlike the gap counters these accumulate from every answer mentioning the
-- competitor, whether or not we are present — alsoCitesUs comes from joining
-- the gap rows in the app tier. Keyed by the mention's competitor_id as
-- recorded (text), so mentions of since-deleted competitors keep counting,
-- exactly as the page behaves today.
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
  -- Expansion bounded to answers that actually mention someone; the jsonpath
  -- probe is far cheaper than expanding every answer's array.
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
$$;

revoke all on function public.citation_gap_domains(uuid, text[], text[], timestamptz, timestamptz, text[], text[], uuid[], uuid[]) from public;
revoke all on function public.citation_competitor_sources(uuid, text[], text[], timestamptz, timestamptz, text[], text[], uuid[], uuid[]) from public;

grant execute on function public.citation_gap_domains(uuid, text[], text[], timestamptz, timestamptz, text[], text[], uuid[], uuid[]) to authenticated, service_role;
grant execute on function public.citation_competitor_sources(uuid, text[], text[], timestamptz, timestamptz, text[], text[], uuid[], uuid[]) to authenticated, service_role;

comment on function public.citation_gap_domains(uuid, text[], text[], timestamptz, timestamptz, text[], text[], uuid[], uuid[]) is
  'Per-domain competitor co-occurrence for the Competitor Gaps tab (#777). Third-party domains only; one null-domain summary row carries the answer totals.';
comment on function public.citation_competitor_sources(uuid, text[], text[], timestamptz, timestamptz, text[], text[], uuid[], uuid[]) is
  'Per-competitor source domains for the Competitor Gaps tab (#777), keyed by the competitor id recorded in the mention.';
