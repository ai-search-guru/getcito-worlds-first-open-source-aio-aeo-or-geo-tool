-- ============================================================================
-- 00203: Competitor Gaps from the daily rollups (#1002)
-- ============================================================================
-- The Citations page's Domains and URLs tabs read daily rollups since 00118,
-- but the Gaps tab still ran citation_gap_domains and
-- citation_competitor_sources (00111) on every load. Both scan every answer
-- in the window and every citation of those answers, and unpack
-- competitor_mentions. On the largest brand a 30-day window took 69 s, far
-- past the authenticated role's 8 s statement timeout, so the tab failed.
--
-- The existing rollups can't answer these reads, because the measures are
-- per answer:
--   * present: the brand is mentioned, or one of its domains is cited in the
--     same answer;
--   * gap: a competitor is mentioned and the brand isn't present;
--   * weight: each answer splits 1 between the distinct domains it cites.
--
-- refresh_citations_daily now writes them too, at the same grain as
-- citation_domain_daily (day, model_used, platform, region, topic_id):
--   * citation_result_daily.present_answers, next to answers, for
--     our_answer_count;
--   * citation_gap_domain_daily, per domain: gap answers, their weight, and
--     present answers (appears_in_ours);
--   * citation_gap_competitor_daily, per (domain, competitor): the answers
--     mentioning the competitor that cite the domain and their weight (for
--     citation_competitor_sources), and how many of them are gap answers
--     (for competitor_names).
-- All three are written from one pass over the day range's answers and
-- citations.
--
-- Kept at read time, as the raw functions do:
--   * tagging a domain as the brand's or a competitor's, against the lists
--     the page sends, so a change to either is a filter;
--   * competitor names, from the live competitors table, falling back to the
--     name in the answer when the competitor is gone.
--
-- Whether the brand is present depends on its own domains when the rows are
-- written. A change to brand_domains therefore queues the brand in
-- citation_rollup_rebuilds, as a topic move does (00118), and the server's
-- rebuild drain (every five minutes) recomputes its history.
--
-- A single-prompt filter stays on the raw functions, as on the other tabs.
--
-- Rollout: apply, run `node src/scripts/backfillCitationsDaily.js` so the
-- history gets the new columns and rows, then deploy the web.

-- ─── Tables ─────────────────────────────────────────────────────────────────

alter table public.citation_result_daily
  add column if not exists present_answers integer not null default 0;

comment on column public.citation_result_daily.present_answers is
  'Answers where the brand is present: mentioned, or one of its brand_domains cited (#1002).';

create table if not exists public.citation_gap_domain_daily (
  brand_id        uuid not null references public.brands(id) on delete cascade,
  day             date not null,
  model_used      text,
  platform        text,
  region          text,
  topic_id        uuid,
  domain          text not null,
  -- Answers citing the domain where a competitor is mentioned and the brand
  -- isn't present.
  gap_answers     integer not null,
  -- The same answers' weight: each answer's 1 split between its domains.
  gap_strength    double precision not null,
  -- Answers citing the domain where the brand is present.
  present_answers integer not null
);

create index if not exists idx_citation_gap_domain_daily_brand_day
  on public.citation_gap_domain_daily (brand_id, day);

create unique index if not exists citation_gap_domain_daily_key
  on public.citation_gap_domain_daily (brand_id, day, model_used, platform, region, topic_id, domain)
  nulls not distinct;

create table if not exists public.citation_gap_competitor_daily (
  brand_id        uuid not null references public.brands(id) on delete cascade,
  day             date not null,
  model_used      text,
  platform        text,
  region          text,
  topic_id        uuid,
  domain          text not null,
  -- competitor_mentions[].competitor_id; text, as the answers carry it.
  competitor_id   text,
  -- The name the answer gave, for a competitor no longer in competitors.
  competitor_name text not null,
  -- Answers mentioning the competitor that cite the domain, and their weight.
  answers         integer not null,
  strength        double precision not null,
  -- Of those, the answers where the brand isn't present.
  gap_answers     integer not null
);

create index if not exists idx_citation_gap_competitor_daily_brand_day
  on public.citation_gap_competitor_daily (brand_id, day);

create unique index if not exists citation_gap_competitor_daily_key
  on public.citation_gap_competitor_daily
     (brand_id, day, model_used, platform, region, topic_id, domain, competitor_id)
  nulls not distinct;

-- ─── RLS, as the other citation rollups ─────────────────────────────────────

alter table public.citation_gap_domain_daily enable row level security;
alter table public.citation_gap_competitor_daily enable row level security;

drop policy if exists "Users can read own org citation gap domain rollups"
  on public.citation_gap_domain_daily;
create policy "Users can read own org citation gap domain rollups"
  on public.citation_gap_domain_daily for select
  using (brand_id in (
    select b.id from public.brands b
    join public.profiles p on p.organization_id = b.organization_id
    where p.id = auth.uid()));

drop policy if exists "Users can read own org citation gap competitor rollups"
  on public.citation_gap_competitor_daily;
create policy "Users can read own org citation gap competitor rollups"
  on public.citation_gap_competitor_daily for select
  using (brand_id in (
    select b.id from public.brands b
    join public.profiles p on p.organization_id = b.organization_id
    where p.id = auth.uid()));

-- ─── Refresh ────────────────────────────────────────────────────────────────
-- 00199's body, plus the gap rows. citation_result_daily's insert moves into
-- the gap pass, which already has each answer's bucket and presence.

create or replace function public.refresh_citations_daily(
  p_brand_id uuid,
  p_day_from date,
  p_day_to date
) returns void
language plpgsql
set search_path to 'public'
set work_mem to '256MB'
as $$
declare
  ts_from timestamptz := p_day_from::timestamp at time zone 'utc';
  ts_to   timestamptz := (p_day_to + 1)::timestamp at time zone 'utc';
  v_brand_domains text[];
begin
  -- One refresh per brand at a time (00199); the lock releases at commit.
  perform pg_advisory_xact_lock(
    hashtextextended('refresh_citations_daily:' || p_brand_id::text, 0));

  delete from public.citation_result_daily
    where brand_id = p_brand_id and day between p_day_from and p_day_to;
  delete from public.citation_domain_daily
    where brand_id = p_brand_id and day between p_day_from and p_day_to;
  delete from public.citation_url_daily
    where brand_id = p_brand_id and day between p_day_from and p_day_to;
  delete from public.citation_gap_domain_daily
    where brand_id = p_brand_id and day between p_day_from and p_day_to;
  delete from public.citation_gap_competitor_daily
    where brand_id = p_brand_id and day between p_day_from and p_day_to;

  -- The brand's own domains as the page sends them (normalizeDomain in
  -- frontend/src/lib/citations/classify.ts): lower case, no scheme, no www.
  select coalesce(array_agg(distinct x.d) filter (where x.d is not null and x.d <> ''), '{}')
    into v_brand_domains
  from (
    select substring(lower(trim(bd.domain)) from '^(?:[a-z][a-z0-9+.-]*://)?(?:www\.)?([^/?#\s:]+)') as d
    from public.brand_domains bd
    where bd.brand_id = p_brand_id
  ) x;

  with ans as materialized (
    select pr.id as rid,
           (pr.created_at at time zone 'utc')::date as day,
           pr.model_used, pr.platform, pr.region, p.topic_id,
           coalesce(pr.mention_count, 0) > 0 as we_mention,
           coalesce(
             jsonb_path_exists(pr.competitor_mentions, '$[*] ? (@.mention_count > 0)'),
             false
           ) as comp_present,
           pr.competitor_mentions
    from public.prompt_results pr
    left join public.prompts p on p.id = pr.prompt_id
    where pr.brand_id = p_brand_id
      and pr.platform <> 'chatgpt-shopping'  -- #155 — isolate from analytics
      and pr.created_at >= ts_from and pr.created_at < ts_to
  ),
  -- The distinct domains each answer cites. A citation row carries its
  -- answer's created_at, so the citation index bounds the scan.
  adom as materialized (
    select distinct c.prompt_result_id as rid, cu.domain as d
    from public.prompt_result_citations c
    join public.citation_urls cu on cu.id = c.url_id
    where c.brand_id = p_brand_id
      and c.created_at >= ts_from and c.created_at < ts_to
  ),
  dtags as materialized (
    select s.d,
           exists (select 1 from unnest(v_brand_domains) e
                   where s.d = e or right(s.d, length(e) + 1) = '.' || e) as is_you
    from (select distinct d from adom) s
  ),
  per_answer as (
    select ad.rid, count(*) as n, bool_or(t.is_you) as you_cited
    from adom ad join dtags t on t.d = ad.d
    group by ad.rid
  ),
  flags as materialized (
    select a.rid, a.day, a.model_used, a.platform, a.region, a.topic_id,
           a.comp_present, a.competitor_mentions,
           a.we_mention or coalesce(pa.you_cited, false) as present,
           a.comp_present and not (a.we_mention or coalesce(pa.you_cited, false)) as gap,
           coalesce(1.0 / pa.n, 0)::float8 as w
    from ans a
    left join per_answer pa on pa.rid = a.rid
  ),
  ins_result as (
    insert into public.citation_result_daily (
      brand_id, day, model_used, platform, region, topic_id, answers, present_answers)
    select p_brand_id, f.day, f.model_used, f.platform, f.region, f.topic_id,
           count(*), count(*) filter (where f.present)
    from flags f
    group by f.day, f.model_used, f.platform, f.region, f.topic_id
  ),
  ins_gap_domain as (
    insert into public.citation_gap_domain_daily (
      brand_id, day, model_used, platform, region, topic_id, domain,
      gap_answers, gap_strength, present_answers)
    select p_brand_id, f.day, f.model_used, f.platform, f.region, f.topic_id, ad.d,
           count(*) filter (where f.gap),
           coalesce(sum(f.w) filter (where f.gap), 0),
           count(*) filter (where f.present)
    from adom ad
    join flags f on f.rid = ad.rid
    group by f.day, f.model_used, f.platform, f.region, f.topic_id, ad.d
    having count(*) filter (where f.gap or f.present) > 0
  ),
  mentions as (
    select f.rid, f.day, f.model_used, f.platform, f.region, f.topic_id, f.gap, f.w,
           x.e ->> 'competitor_id' as competitor_id,
           coalesce(nullif(trim(x.e ->> 'name'), ''), 'Competitor') as competitor_name
    from flags f
    cross join lateral jsonb_array_elements(f.competitor_mentions) x(e)
    where f.comp_present
      and coalesce((x.e ->> 'mention_count')::numeric, 0) > 0
  )
  insert into public.citation_gap_competitor_daily (
    brand_id, day, model_used, platform, region, topic_id, domain,
    competitor_id, competitor_name, answers, strength, gap_answers)
  select p_brand_id, m.day, m.model_used, m.platform, m.region, m.topic_id, ad.d,
         m.competitor_id, max(m.competitor_name),
         count(distinct m.rid), sum(m.w),
         count(distinct m.rid) filter (where m.gap)
  from mentions m
  join adom ad on ad.rid = m.rid
  group by m.day, m.model_used, m.platform, m.region, m.topic_id, ad.d, m.competitor_id;

  insert into public.citation_domain_daily (
    brand_id, day, model_used, platform, region, topic_id, domain, citations, results)
  select p_brand_id,
         (pr.created_at at time zone 'utc')::date,
         pr.model_used, pr.platform, pr.region, p.topic_id, cu.domain,
         count(*),
         count(distinct c.prompt_result_id)
  from public.prompt_result_citations c
  join public.prompt_results pr on pr.id = c.prompt_result_id
  left join public.prompts p on p.id = pr.prompt_id
  join public.citation_urls cu on cu.id = c.url_id
  where c.brand_id = p_brand_id
    and c.created_at >= ts_from and c.created_at < ts_to
    and pr.platform <> 'chatgpt-shopping'
  group by 2, pr.model_used, pr.platform, pr.region, p.topic_id, cu.domain;

  insert into public.citation_url_daily (
    brand_id, day, model_used, platform, region, topic_id, url_id, citations, results)
  select p_brand_id,
         (pr.created_at at time zone 'utc')::date,
         pr.model_used, pr.platform, pr.region, p.topic_id, c.url_id,
         count(*),
         count(distinct c.prompt_result_id)
  from public.prompt_result_citations c
  join public.prompt_results pr on pr.id = c.prompt_result_id
  left join public.prompts p on p.id = pr.prompt_id
  where c.brand_id = p_brand_id
    and c.created_at >= ts_from and c.created_at < ts_to
    and pr.platform <> 'chatgpt-shopping'
  group by 2, pr.model_used, pr.platform, pr.region, p.topic_id, c.url_id;
end;
$$;

revoke execute on function public.refresh_citations_daily(uuid, date, date)
  from public, anon, authenticated;

-- ─── A brand domain change queues a rebuild ─────────────────────────────────

create or replace function public.queue_citation_rollup_rebuild_on_domains()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_brands uuid[];
begin
  if tg_op = 'INSERT' then
    v_brands := array[new.brand_id];
  elsif tg_op = 'DELETE' then
    v_brands := array[old.brand_id];
  elsif new.domain is not distinct from old.domain and new.brand_id = old.brand_id then
    return null;
  else
    v_brands := array[old.brand_id, new.brand_id];
  end if;
  -- Only for a brand that still exists: a brand delete removes the brand
  -- before its domains, so the cascade queues nothing.
  insert into public.citation_rollup_rebuilds (brand_id)
  select b.id from public.brands b where b.id = any(v_brands)
  on conflict (brand_id) do update set requested_at = now();
  return null;
end;
$$;

revoke execute on function public.queue_citation_rollup_rebuild_on_domains()
  from public, anon, authenticated;

drop trigger if exists brand_domains_queue_citation_rollup_rebuild on public.brand_domains;
create trigger brand_domains_queue_citation_rollup_rebuild
  after insert or update or delete on public.brand_domains
  for each row execute function public.queue_citation_rollup_rebuild_on_domains();

-- ─── Reads ──────────────────────────────────────────────────────────────────
-- Same rows as the raw functions for whole-day windows. Security definer with
-- the organization check made explicit (00119), and plpgsql with
-- force_custom_plan so each call is planned for its own brand and window.

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
  if not exists (
    select 1 from public.brands b
    join public.profiles pf on pf.organization_id = b.organization_id
    where b.id = p_brand_id and pf.id = auth.uid()
  ) then
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
  if not exists (
    select 1 from public.brands b
    join public.profiles pf on pf.organization_id = b.organization_id
    where b.id = p_brand_id and pf.id = auth.uid()
  ) then
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

revoke all on function public.citation_gap_domains_daily(
  uuid, text[], text[], date, date, text[], text[], uuid[]) from public, anon;
grant execute on function public.citation_gap_domains_daily(
  uuid, text[], text[], date, date, text[], text[], uuid[]) to authenticated, service_role;

revoke all on function public.citation_competitor_sources_daily(
  uuid, text[], text[], date, date, text[], text[], uuid[]) from public, anon;
grant execute on function public.citation_competitor_sources_daily(
  uuid, text[], text[], date, date, text[], text[], uuid[]) to authenticated, service_role;

comment on function public.citation_gap_domains_daily(
  uuid, text[], text[], date, date, text[], text[], uuid[]) is
  'Competitor Gaps (#1002): citation_gap_domains over whole UTC days, from the daily rollups. Third-party domains with their gap answers, strength, whether they appear in an answer where the brand is present, and the competitors in those gap answers; plus a null-domain row with the window''s totals. Security definer with an organization check.';

comment on function public.citation_competitor_sources_daily(
  uuid, text[], text[], date, date, text[], text[], uuid[]) is
  'Competitor Gaps (#1002): citation_competitor_sources over whole UTC days, from the daily rollups. Per competitor, the third-party domains cited in answers that mention it, with the answer count and weight. Security definer with an organization check.';

notify pgrst, 'reload schema';
