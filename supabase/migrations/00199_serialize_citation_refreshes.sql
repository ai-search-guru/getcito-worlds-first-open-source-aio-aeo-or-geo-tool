-- ============================================================================
-- 00199: the Citations rollups refresh one at a time (#1020)
-- ============================================================================
-- refresh_citations_daily (00118) deletes a brand's citation_*_daily rows for
-- a day range and inserts them again, with no lock and no unique key. A run's
-- refresh, the nightly sweep and the topic-move rebuild can overlap on the
-- same brand: the second refresh's delete waits for the first to commit, but
-- its snapshot predates the first one's insert, so it skips those rows and
-- adds its own, and the days they share are counted twice.
--
-- As 00164 did for refresh_insights_daily and 00192 for
-- refresh_mentions_daily: the function takes a per-brand advisory lock, rows
-- written twice before are dropped, and unique keys make a second copy
-- impossible.
--
-- The lock lasts one call. refreshCitationHistory rebuilds a brand in
-- 14-day calls (HISTORY_CHUNK_DAYS), so a refresh queued behind a rebuild
-- waits for one chunk, well inside the service role's 120s statement_timeout
-- (00100). The body is 00118's unchanged apart from the lock.

-- ─── One refresh per brand at a time ────────────────────────────────────────

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
  -- One refresh per brand at a time, as refresh_insights_daily (00164) and
  -- refresh_mentions_daily (00192); the lock releases at commit.
  perform pg_advisory_xact_lock(
    hashtextextended('refresh_citations_daily:' || p_brand_id::text, 0));

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

-- ─── Rows written twice ─────────────────────────────────────────────────────
-- Copies from an overlap are the same counts computed twice; keep one. The
-- next refresh of those days rewrites them anyway.

delete from public.citation_result_daily d
using (
  select ctid,
         row_number() over (
           partition by brand_id, day, model_used, platform, region, topic_id
           order by answers desc) as n
  from public.citation_result_daily
) x
where d.ctid = x.ctid and x.n > 1;

delete from public.citation_domain_daily d
using (
  select ctid,
         row_number() over (
           partition by brand_id, day, model_used, platform, region, topic_id, domain
           order by citations desc, results desc) as n
  from public.citation_domain_daily
) x
where d.ctid = x.ctid and x.n > 1;

delete from public.citation_url_daily d
using (
  select ctid,
         row_number() over (
           partition by brand_id, day, model_used, platform, region, topic_id, url_id
           order by citations desc, results desc) as n
  from public.citation_url_daily
) x
where d.ctid = x.ctid and x.n > 1;

-- On large tables, build these by hand first with `create unique index
-- concurrently`, which doesn't hold back the refreshes; these statements then
-- find them in place. A null model, platform, region or topic is one key, not
-- many.
create unique index if not exists citation_result_daily_key
  on public.citation_result_daily (brand_id, day, model_used, platform, region, topic_id)
  nulls not distinct;

create unique index if not exists citation_domain_daily_key
  on public.citation_domain_daily (brand_id, day, model_used, platform, region, topic_id, domain)
  nulls not distinct;

create unique index if not exists citation_url_daily_key
  on public.citation_url_daily (brand_id, day, model_used, platform, region, topic_id, url_id)
  nulls not distinct;
