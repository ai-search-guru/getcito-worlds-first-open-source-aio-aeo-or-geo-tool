-- Citations stops recomputing the window on every page load.
--
-- The Citations overview aggregated prompt_result_citations per request. On
-- the largest brand a 30-day window is 935k citation rows over 128k URLs and
-- 15.8k domains: citations_domains took 17s against the authenticated role's
-- 8s statement timeout, and every brand's window grows with its history.
--
-- Same cure as Insights (00066): each brand-day is aggregated once, when the
-- brand's tracking run completes, with the daily sweep as backstop, and the
-- page reads the daily rows. Measured on the largest brand's 30 days: the
-- domain table in 0.06s and the top 2,000 URLs in 0.25s.
--
-- Grain: (day, model_used, platform, region, topic_id) — the page's filter
-- dimensions. A result belongs to exactly one bucket, so results_citing sums
-- across days, engines, regions and topics without double counting. A prompt
-- grain was measured too and compresses nothing (886k rows for 935k
-- citations), so a single-prompt filter stays on the raw functions, which a
-- single prompt keeps small.
--
-- Topic is stored rather than joined at read time. Moving a prompt to another
-- topic (or deleting it) therefore queues its brand in
-- citation_rollup_rebuilds, and the daily sweep recomputes that brand's
-- history. Until then only topic-filtered views show the old attribution;
-- unfiltered totals are unaffected.
--
-- The raw functions stay: the per-prompt filter, Competitor Gaps, the URL
-- detail page, MCP and reports still call them.

-- ─── Tables ─────────────────────────────────────────────────────────────────

-- Answers per bucket: the denominator of every usage %, and the regions list.
create table if not exists public.citation_result_daily (
  brand_id   uuid not null references public.brands(id) on delete cascade,
  day        date not null,
  model_used text,
  platform   text,
  region     text,
  topic_id   uuid,
  answers    integer not null
);

create index if not exists idx_citation_result_daily_brand_day
  on public.citation_result_daily (brand_id, day);

create table if not exists public.citation_domain_daily (
  brand_id   uuid not null references public.brands(id) on delete cascade,
  day        date not null,
  model_used text,
  platform   text,
  region     text,
  topic_id   uuid,
  domain     text not null,
  citations  integer not null,
  -- Answers citing at least one URL of the domain.
  results    integer not null
);

create index if not exists idx_citation_domain_daily_brand_day
  on public.citation_domain_daily (brand_id, day);

create table if not exists public.citation_url_daily (
  brand_id   uuid not null references public.brands(id) on delete cascade,
  day        date not null,
  model_used text,
  platform   text,
  region     text,
  topic_id   uuid,
  url_id     bigint not null,
  citations  integer not null,
  -- Answers citing the URL.
  results    integer not null
);

create index if not exists idx_citation_url_daily_brand_day
  on public.citation_url_daily (brand_id, day);

-- Brands whose prompts changed topic since their rollups were written. No
-- foreign key on purpose: deleting a brand cascades through its prompts, and
-- the trigger below must never make that delete fail. A brand gone by the
-- time the sweep reads its entry has no results, so the rebuild is a no-op
-- and the entry is cleared.
create table if not exists public.citation_rollup_rebuilds (
  brand_id     uuid primary key,
  requested_at timestamptz not null default now()
);

-- ─── RLS — same shape as the Insights rollups ───────────────────────────────

alter table public.citation_result_daily enable row level security;
alter table public.citation_domain_daily enable row level security;
alter table public.citation_url_daily enable row level security;
-- Service role only: no policies.
alter table public.citation_rollup_rebuilds enable row level security;

drop policy if exists "Users can read own org citation result rollups" on public.citation_result_daily;
create policy "Users can read own org citation result rollups"
  on public.citation_result_daily for select
  using (brand_id in (
    select b.id from public.brands b
    join public.profiles p on p.organization_id = b.organization_id
    where p.id = auth.uid()));

drop policy if exists "Users can read own org citation domain rollups" on public.citation_domain_daily;
create policy "Users can read own org citation domain rollups"
  on public.citation_domain_daily for select
  using (brand_id in (
    select b.id from public.brands b
    join public.profiles p on p.organization_id = b.organization_id
    where p.id = auth.uid()));

drop policy if exists "Users can read own org citation url rollups" on public.citation_url_daily;
create policy "Users can read own org citation url rollups"
  on public.citation_url_daily for select
  using (brand_id in (
    select b.id from public.brands b
    join public.profiles p on p.organization_id = b.organization_id
    where p.id = auth.uid()));

-- ─── Refresh ────────────────────────────────────────────────────────────────

-- Recompute one brand's citation rollups for an inclusive UTC day range:
-- delete + insert, so it is idempotent and safe to rerun. Called by the
-- server under the service role (run completion, the daily sweep, the topic
-- rebuild and the backfill script).
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
begin
  delete from public.citation_result_daily
    where brand_id = p_brand_id and day between p_day_from and p_day_to;
  delete from public.citation_domain_daily
    where brand_id = p_brand_id and day between p_day_from and p_day_to;
  delete from public.citation_url_daily
    where brand_id = p_brand_id and day between p_day_from and p_day_to;

  insert into public.citation_result_daily (
    brand_id, day, model_used, platform, region, topic_id, answers)
  select p_brand_id,
         (pr.created_at at time zone 'utc')::date,
         pr.model_used, pr.platform, pr.region, p.topic_id,
         count(*)
  from public.prompt_results pr
  left join public.prompts p on p.id = pr.prompt_id
  where pr.brand_id = p_brand_id
    and pr.platform <> 'chatgpt-shopping'  -- #155 — isolate from analytics
    and pr.created_at >= ts_from and pr.created_at < ts_to
  group by 2, pr.model_used, pr.platform, pr.region, p.topic_id;

  -- A citation row carries its answer's created_at, so the citation index
  -- bounds the scan; the answer supplies the bucket.
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

-- ─── Topic moves queue a rebuild ────────────────────────────────────────────

create or replace function public.queue_citation_rollup_rebuild()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_set uuid := case when tg_op = 'DELETE' then old.prompt_set_id else new.prompt_set_id end;
begin
  if tg_op = 'UPDATE' and new.topic_id is not distinct from old.topic_id then
    return new;
  end if;
  -- Only for a brand that still exists: during a brand delete the cascade
  -- removes the brand first, so its prompts queue nothing.
  insert into public.citation_rollup_rebuilds (brand_id)
  select ps.brand_id from public.prompt_sets ps
  join public.brands b on b.id = ps.brand_id
  where ps.id = v_set
  on conflict (brand_id) do update set requested_at = now();
  return null;
end;
$$;

revoke execute on function public.queue_citation_rollup_rebuild()
  from public, anon, authenticated;

drop trigger if exists prompts_queue_citation_rollup_rebuild on public.prompts;
create trigger prompts_queue_citation_rollup_rebuild
  after update of topic_id or delete on public.prompts
  for each row execute function public.queue_citation_rollup_rebuild();

-- ─── Reads ──────────────────────────────────────────────────────────────────
-- Security invoker: the RLS policies above scope every read to the caller's
-- organization. plpgsql with force_custom_plan so each call is planned with
-- its own brand and window (00113).

create or replace function public.citations_domains_daily(
  p_brand_id uuid,
  p_day_from date default null,
  p_day_to date default null,
  p_models text[] default null,
  p_regions text[] default null,
  p_topic_ids uuid[] default null
) returns table(domain text, total_citations bigint, results_citing bigint, models text[])
language plpgsql
stable
set search_path to 'public'
set work_mem to '64MB'
set plan_cache_mode to 'force_custom_plan'
as $$
#variable_conflict use_column
begin
  return query
  select d.domain,
         sum(d.citations)::bigint,
         sum(d.results)::bigint,
         array_agg(distinct coalesce(d.model_used, d.platform))
  from public.citation_domain_daily d
  where d.brand_id = p_brand_id
    and (p_day_from  is null or d.day >= p_day_from)
    and (p_day_to    is null or d.day <= p_day_to)
    and (p_models    is null or d.model_used = any(p_models))
    and (p_regions   is null or d.region = any(p_regions))
    and (p_topic_ids is null or d.topic_id = any(p_topic_ids))
  group by d.domain
  order by 2 desc;
end;
$$;

create or replace function public.citations_urls_daily(
  p_brand_id uuid,
  p_day_from date default null,
  p_day_to date default null,
  p_models text[] default null,
  p_regions text[] default null,
  p_topic_ids uuid[] default null,
  p_limit integer default 2000,
  p_domains text[] default null,
  p_exclude_domains text[] default null
) returns table(url text, domain text, title text, total_citations bigint,
                results_citing bigint, models text[], total_urls bigint)
language plpgsql
stable
set search_path to 'public'
set work_mem to '64MB'
set plan_cache_mode to 'force_custom_plan'
as $$
#variable_conflict use_column
begin
  return query
  with agg as (
    select u.url_id as uid,
           sum(u.citations)::bigint as tc,
           sum(u.results)::bigint as rc,
           array_agg(distinct coalesce(u.model_used, u.platform)) as ms
    from public.citation_url_daily u
    where u.brand_id = p_brand_id
      and (p_day_from  is null or u.day >= p_day_from)
      and (p_day_to    is null or u.day <= p_day_to)
      and (p_models    is null or u.model_used = any(p_models))
      and (p_regions   is null or u.region = any(p_regions))
      and (p_topic_ids is null or u.topic_id = any(p_topic_ids))
    group by u.url_id
  ),
  include_ids as (
    select cu.id from public.citation_urls cu
    where p_domains is not null and cu.domain = any(p_domains)
  ),
  exclude_ids as (
    select cu.id from public.citation_urls cu
    where p_exclude_domains is not null and cu.domain = any(p_exclude_domains)
  ),
  scoped as materialized (
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

create or replace function public.citations_window_stats_daily(
  p_brand_id uuid,
  p_day_from date default null,
  p_day_to date default null,
  p_models text[] default null,
  p_regions text[] default null,
  p_topic_ids uuid[] default null
) returns table(results bigint, regions text[])
language plpgsql
stable
set search_path to 'public'
set plan_cache_mode to 'force_custom_plan'
as $$
#variable_conflict use_column
begin
  return query
  select coalesce(sum(r.answers), 0)::bigint,
         coalesce(array_agg(distinct r.region) filter (where r.region is not null), '{}')
  from public.citation_result_daily r
  where r.brand_id = p_brand_id
    and (p_day_from  is null or r.day >= p_day_from)
    and (p_day_to    is null or r.day <= p_day_to)
    and (p_models    is null or r.model_used = any(p_models))
    and (p_regions   is null or r.region = any(p_regions))
    and (p_topic_ids is null or r.topic_id = any(p_topic_ids));
end;
$$;

-- ─── Health report probes ───────────────────────────────────────────────────
-- The daily health report times the page's reads (00108). The Citations page
-- now reads the daily functions, so the report can time those: same body as
-- 00108 plus two probes. Their window counts today, as the page's does.

create or replace function public.health_probe(
  p_user_id uuid,
  p_brand_id uuid,
  p_probe text,
  p_days integer default null
) returns numeric
language plpgsql
security invoker
set search_path to 'public'
as $$
declare
  t0 timestamptz;
  ts_from timestamptz := case when p_days is null then null else now() - make_interval(days => p_days) end;
  day_from date := (now() at time zone 'utc')::date - coalesce(p_days, 0);
  page_day_from date := case when p_days is null then null
                             else (now() at time zone 'utc')::date - (p_days - 1) end;
  n bigint;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user_id, 'role', 'authenticated')::text,
    true
  );
  t0 := clock_timestamp();

  case p_probe
    when 'citations_window_stats' then
      select count(*) into n from public.citations_window_stats(
        p_brand_id => p_brand_id, p_date_from => ts_from, p_date_to => null,
        p_models => null, p_regions => null, p_prompt_ids => null, p_topic_ids => null);
    when 'citations_domains' then
      select count(*) into n from public.citations_domains(
        p_brand_id => p_brand_id, p_date_from => ts_from, p_date_to => null,
        p_models => null, p_regions => null, p_prompt_ids => null, p_topic_ids => null);
    when 'citations_urls' then
      select count(*) into n from public.citations_urls(
        p_brand_id => p_brand_id, p_date_from => ts_from, p_date_to => null,
        p_models => null, p_regions => null, p_prompt_ids => null, p_topic_ids => null,
        p_limit => 100, p_domains => null, p_exclude_domains => null);
    when 'citations_domains_daily' then
      select count(*) into n from public.citations_domains_daily(
        p_brand_id => p_brand_id, p_day_from => page_day_from, p_day_to => null);
    when 'citations_urls_daily' then
      select count(*) into n from public.citations_urls_daily(
        p_brand_id => p_brand_id, p_day_from => page_day_from, p_day_to => null,
        p_limit => 2000);
    when 'insights_aggregates_daily' then
      select count(*) into n from public.insights_aggregates_daily(
        p_brand_id => p_brand_id, p_platform => null, p_models => null, p_region => null,
        p_day_from => case when p_days is null then null else day_from end, p_day_to => null);
    when 'competitor_aggregates_daily' then
      select count(*) into n from public.competitor_aggregates_daily(
        p_brand_id => p_brand_id, p_platform => null, p_models => null, p_region => null,
        p_day_from => case when p_days is null then null else day_from end, p_day_to => null);
    when 'topics_overview_aggregates' then
      select count(*) into n from public.topics_overview_aggregates(p_brand_id => p_brand_id);
    else
      raise exception 'unknown health probe: %', p_probe;
  end case;

  return round(extract(epoch from clock_timestamp() - t0)::numeric, 2);
end;
$$;

revoke all on function public.health_probe(uuid, uuid, text, integer) from public, anon, authenticated;
grant execute on function public.health_probe(uuid, uuid, text, integer) to service_role;
