-- ============================================================================
-- 00164: topic-filtered Insights reads from the prompt-grain rollups (#862)
-- ============================================================================
-- Every Insights read that filters by topic still scanned raw prompt_results:
-- the brand-grain rollups have no prompt dimension, so dailyWindow() sent any
-- call with a topic to the raw RPCs. On the largest topic (91 prompts, 35k
-- answers) competitor_aggregates took 6-12 s for 30 days as a signed-in
-- member, and the topic detail page's all-time reads 18 s and 11 s under the
-- service role it falls back to. Most of the cost is unpacking every answer's
-- competitor_mentions jsonb.
--
-- The prompt-grain tables already carry most of the measures (00130, 00131).
-- This adds the rest, and every *_daily read the Insights page and the topic
-- detail page use takes p_topic_id. With a topic they read the prompt-grain
-- tables, through prompts.topic_id at read time, so a prompt moved to
-- another topic still takes its history along — the reason topic filters
-- stayed on the raw path. Without one they read what they read before:
-- insights_brand_daily also counts answers with no prompt, which the
-- prompt-grain tables leave out.
--
--   * insights_prompt_daily gains sum_visibility, sum_visibility_visible and
--     max_created_at; insights_competitor_prompt_daily (the sightings: one
--     row per competitor, prompt and engine-day where the competitor was
--     mentioned, cited or scored) gains sum_visibility and total_citations.
--     An answer element that isn't a sighting contributes zero to all of
--     them, so the sightings sum to what the raw RPCs compute. Nullable with
--     no default, like 00130's: a row not rewritten since reads NULL, not a
--     plausible zero. Run backfillInsightsDaily.js before the web deploy.
--   * The one measure sightings can't give is a competitor's answer count:
--     every answer lists every tracked competitor, so for a topic it is the
--     topic's answer count on that engine, and every live competitor is
--     listed, sighted or not. A competitor added partway through the window
--     is counted against the whole window's answers, an accepted drift.
--   * (brand_id, prompt_id, day) on both prompt-grain tables, so a topic read
--     follows the topic's rows rather than the brand's.
--   * refresh_insights_daily (00162's body) takes a per-brand transaction
--     lock: two overlapping refreshes of the same brand-day (a completed run
--     and the nightly sweep, or a backfill chunk) each delete before the
--     other's insert commits, and the day's rows land twice (#1020). Its
--     position measures skip positions that aren't positive, so a stray 0
--     can't divide by zero and abort the brand's refresh; positions are
--     1-based (responseParser.js), so real data is unchanged.
--   * The seven aggregate reads (00066, 00112, 00113, 00131) and the three
--     comparison reads (00133, 00148, 00149) gain a parameter. CREATE OR
--     REPLACE would add it as a second overload, and PostgREST would find
--     every call that omits it ambiguous, so the old signatures are dropped
--     first. Recreating them resets their settings, so each keeps its own:
--     competitor_aggregates_daily 00113's plpgsql, work_mem and
--     plan_cache_mode, visibility_rate_trend_daily 00112's materialized CTEs
--     and work_mem, and the comparison reads their security definer and
--     explicit organization check (00147, 00148).
--
-- Designed and first written by @arambu1a in #867; rebuilt here on the
-- functions as main has them now.

-- ─── Tables ─────────────────────────────────────────────────────────────────

alter table public.insights_prompt_daily
  add column if not exists sum_visibility         numeric,
  add column if not exists sum_visibility_visible numeric,
  add column if not exists max_created_at         timestamptz;

comment on column public.insights_prompt_daily.max_created_at is
  'Latest answer in the row (00164). NULL until refresh_insights_daily rewrites the day.';

alter table public.insights_competitor_prompt_daily
  add column if not exists sum_visibility  numeric,
  add column if not exists total_citations bigint;

comment on column public.insights_competitor_prompt_daily.sum_visibility is
  'Sum of the competitor''s visibility_score over the sighting''s answers (00164). NULL until refresh_insights_daily rewrites the day.';

-- On a large table, build these by hand first with `create index
-- concurrently`, which doesn't hold back tracking's writes; these statements
-- then find them in place.
create index if not exists idx_insights_prompt_daily_brand_prompt_day
  on public.insights_prompt_daily (brand_id, prompt_id, day);

create index if not exists idx_insights_competitor_prompt_daily_brand_prompt_day
  on public.insights_competitor_prompt_daily (brand_id, prompt_id, day);

-- ─── Refresh: 00162 plus the lock and the new columns ───────────────────────

create or replace function public.refresh_insights_daily(
  p_brand_id uuid,
  p_day_from date,
  p_day_to date
) returns void
language plpgsql
set search_path to 'public'
as $$
declare
  -- The range's bounds as instants, so the answers are found through
  -- (brand_id, created_at) rather than by reading all of the brand's.
  v_from timestamptz := p_day_from::timestamp at time zone 'utc';
  v_to   timestamptz := (p_day_to + 1)::timestamp at time zone 'utc';
begin
  -- One refresh per brand at a time; the lock releases at commit.
  perform pg_advisory_xact_lock(
    hashtextextended('refresh_insights_daily:' || p_brand_id::text, 0));

  delete from public.insights_brand_daily
    where brand_id = p_brand_id and day between p_day_from and p_day_to;
  delete from public.insights_competitor_daily
    where brand_id = p_brand_id and day between p_day_from and p_day_to;
  delete from public.insights_prompt_daily
    where brand_id = p_brand_id and day between p_day_from and p_day_to;
  delete from public.insights_competitor_prompt_daily
    where brand_id = p_brand_id and day between p_day_from and p_day_to;

  insert into public.insights_brand_daily (
    brand_id, day, model_used, platform, region,
    answer_count, mention_answers, citation_answers, mentioning_answers,
    sum_visibility, sum_visibility_visible, total_mentions, total_citations,
    positive_count, sum_inv_position, position_count, max_created_at,
    negative_count, sum_position)
  select
    p_brand_id,
    (pr.created_at at time zone 'utc')::date,
    pr.model_used, pr.platform, pr.region,
    count(*),
    count(*) filter (where pr.mention_count > 0),
    count(*) filter (where pr.citation_count > 0),
    count(*) filter (where pr.mention_count > 0 or pr.citation_count > 0),
    coalesce(sum(pr.visibility_score), 0),
    coalesce(sum(pr.visibility_score)
      filter (where pr.mention_count > 0 or pr.citation_count > 0), 0),
    coalesce(sum(pr.mention_count), 0),
    coalesce(sum(pr.citation_count), 0),
    count(*) filter (where pr.sentiment = 'positive'),
    sum(1.0 / pr.mention_position) filter (where pr.mention_position > 0),
    count(*) filter (where pr.mention_position > 0),
    max(pr.created_at),
    count(*) filter (where pr.sentiment = 'negative'),
    sum(pr.mention_position) filter (where pr.mention_position > 0)
  from public.prompt_results pr
  where pr.brand_id = p_brand_id
    and pr.platform <> 'chatgpt-shopping'  -- #155 — isolate from Insights
    and pr.created_at >= v_from
    and pr.created_at < v_to
  group by 2, pr.model_used, pr.platform, pr.region;

  insert into public.insights_prompt_daily (
    brand_id, day, prompt_id, model_used, platform, region,
    answer_count, has_mention, has_citation,
    mention_answers, citation_answers, mentioning_answers, positive_count,
    total_mentions, total_citations, sum_inv_position, position_count,
    negative_count, sum_position,
    sum_visibility, sum_visibility_visible, max_created_at)
  select
    p_brand_id,
    (pr.created_at at time zone 'utc')::date,
    pr.prompt_id, pr.model_used, pr.platform, pr.region,
    count(*),
    bool_or(pr.mention_count > 0),
    bool_or(pr.citation_count > 0),
    count(*) filter (where pr.mention_count > 0),
    count(*) filter (where pr.citation_count > 0),
    count(*) filter (where pr.mention_count > 0 or pr.citation_count > 0),
    count(*) filter (where pr.sentiment = 'positive'),
    coalesce(sum(pr.mention_count), 0),
    coalesce(sum(pr.citation_count), 0),
    sum(1.0 / pr.mention_position) filter (where pr.mention_position > 0),
    count(*) filter (where pr.mention_position > 0),
    count(*) filter (where pr.sentiment = 'negative'),
    sum(pr.mention_position) filter (where pr.mention_position > 0),
    coalesce(sum(pr.visibility_score), 0),
    coalesce(sum(pr.visibility_score)
      filter (where pr.mention_count > 0 or pr.citation_count > 0), 0),
    max(pr.created_at)
  from public.prompt_results pr
  where pr.brand_id = p_brand_id
    and pr.prompt_id is not null
    and pr.platform <> 'chatgpt-shopping'
    and pr.created_at >= v_from
    and pr.created_at < v_to
  group by 2, pr.prompt_id, pr.model_used, pr.platform, pr.region;

  insert into public.insights_competitor_daily (
    brand_id, day, competitor_id, model_used, platform, region,
    answer_count, sum_visibility, total_mentions, total_citations,
    mention_answers, citation_answers, sum_inv_position, position_count)
  select
    p_brand_id,
    (pr.created_at at time zone 'utc')::date,
    cm.value->>'competitor_id',
    pr.model_used, pr.platform, pr.region,
    count(*),
    sum((cm.value->>'visibility_score')::numeric),
    coalesce(sum(coalesce((cm.value->>'mention_count')::int, 0)), 0),
    coalesce(sum(coalesce((cm.value->>'citation_count')::int, 0)), 0),
    count(*) filter (where coalesce((cm.value->>'mention_count')::int, 0) > 0),
    count(*) filter (where coalesce((cm.value->>'citation_count')::int, 0) > 0),
    sum(1.0 / (cm.value->>'mention_position')::numeric)
      filter (where (cm.value->>'mention_position')::numeric > 0),
    count(*) filter (where (cm.value->>'mention_position')::numeric > 0)
  from public.prompt_results pr,
       lateral jsonb_array_elements(coalesce(pr.competitor_mentions, '[]'::jsonb)) cm
  where pr.brand_id = p_brand_id
    and pr.platform <> 'chatgpt-shopping'
    and pr.created_at >= v_from
    and pr.created_at < v_to
    and cm.value ? 'competitor_id'
  group by 2, cm.value->>'competitor_id', pr.model_used, pr.platform, pr.region;

  -- Sightings only, as in 00098; the measures follow insights_competitor_daily.
  insert into public.insights_competitor_prompt_daily (
    brand_id, day, competitor_id, prompt_id, model_used, platform, region, mention_count,
    mention_answers, citation_answers, sum_inv_position, position_count,
    sum_visibility, total_citations)
  select
    p_brand_id,
    (pr.created_at at time zone 'utc')::date,
    cm.value->>'competitor_id',
    pr.prompt_id, pr.model_used, pr.platform, pr.region,
    sum(coalesce((cm.value->>'mention_count')::int, 0)),
    count(*) filter (where coalesce((cm.value->>'mention_count')::int, 0) > 0),
    count(*) filter (where coalesce((cm.value->>'citation_count')::int, 0) > 0),
    sum(1.0 / (cm.value->>'mention_position')::numeric)
      filter (where (cm.value->>'mention_position')::numeric > 0),
    count(*) filter (where (cm.value->>'mention_position')::numeric > 0),
    sum((cm.value->>'visibility_score')::numeric),
    coalesce(sum(coalesce((cm.value->>'citation_count')::int, 0)), 0)
  from public.prompt_results pr,
       lateral jsonb_array_elements(coalesce(pr.competitor_mentions, '[]'::jsonb)) cm
  where pr.brand_id = p_brand_id
    and pr.prompt_id is not null
    and pr.platform <> 'chatgpt-shopping'
    and pr.created_at >= v_from
    and pr.created_at < v_to
    and cm.value ? 'competitor_id'
    and (coalesce((cm.value->>'mention_count')::int, 0) > 0
      or coalesce((cm.value->>'citation_count')::int, 0) > 0
      or coalesce((cm.value->>'visibility_score')::numeric, 0) > 0)
  group by 2, cm.value->>'competitor_id', pr.prompt_id, pr.model_used, pr.platform, pr.region;
end;
$$;

revoke execute on function public.refresh_insights_daily(uuid, date, date)
  from public, anon, authenticated;

-- ─── Read functions ─────────────────────────────────────────────────────────
--
-- Payloads are unchanged. Each source the function reads becomes a pair of
-- branches gated on p_topic_id: the brand-grain table when it is null (the
-- read is then exactly what it was), the prompt-grain table restricted to the
-- topic's current prompts when it is set. The gate references only a
-- parameter, so the planner turns it into a one-time filter and the unused
-- branch is never scanned.
--
-- The gate must stay a branch of its own: folding it into one predicate
-- ("p_topic_id is null or prompt_id = any (...)") stops the planner from
-- using the (brand_id, prompt_id, day) index and scans the whole brand.
--
-- The topic's prompts are resolved once per call (topic_prompts), the same
-- set the raw RPCs' EXISTS (prompts.topic_id = p_topic_id) admits.
--
-- Competitor measures for a topic come from the sightings. Where a function
-- lists competitors, it also lists the live competitors the topic's answers
-- never sighted (with zero measures), as the raw RPCs do: each answer lists
-- every tracked competitor. Each function folds competitor rows to the grain
-- it reports at before joining competitors.

drop function if exists public.insights_aggregates_daily(uuid, text, text[], text, date, date);
drop function if exists public.visible_prompt_stats_daily(uuid, text, text[], text, date, date);
drop function if exists public.tracked_prompt_count_daily(uuid, text, text[], text, date, date);
drop function if exists public.ai_visibility_aggregates_daily(uuid, text, text[], text, date, date);
drop function if exists public.competitor_aggregates_daily(uuid, text, text[], text, date, date);
drop function if exists public.share_of_voice_aggregates_daily(uuid, text, text[], text, date, date);
drop function if exists public.visibility_rate_trend_daily(uuid, text, text[], text, date, date);
-- And the new ones, so this file can be run again.
drop function if exists public.insights_aggregates_daily(uuid, text, text[], text, date, date, uuid);
drop function if exists public.visible_prompt_stats_daily(uuid, text, text[], text, date, date, uuid);
drop function if exists public.tracked_prompt_count_daily(uuid, text, text[], text, date, date, uuid);
drop function if exists public.ai_visibility_aggregates_daily(uuid, text, text[], text, date, date, uuid);
drop function if exists public.competitor_aggregates_daily(uuid, text, text[], text, date, date, uuid);
drop function if exists public.share_of_voice_aggregates_daily(uuid, text, text[], text, date, date, uuid);
drop function if exists public.visibility_rate_trend_daily(uuid, text, text[], text, date, date, uuid);


-- insights_aggregates over rollups, with 00131's citation, negative and
-- position totals.
create function public.insights_aggregates_daily(
  p_brand_id uuid,
  p_platform text default null,
  p_models text[] default null,
  p_region text default null,
  p_day_from date default null,
  p_day_to date default null,
  p_topic_id uuid default null
) returns jsonb
language sql
stable
set search_path to 'public'
as $$
  with topic_prompts as (
    select array(select p.id from public.prompts p where p.topic_id = p_topic_id) as ids
  ),
  filtered as (
    select d.model_used, d.answer_count, d.sum_visibility, d.total_mentions,
           d.total_citations, d.positive_count, d.mentioning_answers, d.max_created_at,
           d.citation_answers, d.negative_count, d.sum_position, d.position_count
    from public.insights_brand_daily d
    where p_topic_id is null
      and d.brand_id = p_brand_id
      and (p_platform is null or d.platform = p_platform)
      and (p_models is null or d.model_used = any (p_models))
      and (p_region is null or d.region = p_region)
      and (p_day_from is null or d.day >= p_day_from)
      and (p_day_to is null or d.day <= p_day_to)
    union all
    select d.model_used, d.answer_count, d.sum_visibility, d.total_mentions,
           d.total_citations, d.positive_count, d.mentioning_answers, d.max_created_at,
           d.citation_answers, d.negative_count, d.sum_position, d.position_count
    from public.insights_prompt_daily d, topic_prompts tp
    where p_topic_id is not null
      and d.brand_id = p_brand_id
      and d.prompt_id = any (tp.ids)
      and (p_platform is null or d.platform = p_platform)
      and (p_models is null or d.model_used = any (p_models))
      and (p_region is null or d.region = p_region)
      and (p_day_from is null or d.day >= p_day_from)
      and (p_day_to is null or d.day <= p_day_to)
  ),
  totals as (
    select
      coalesce(sum(answer_count), 0)       as total_results,
      coalesce(sum(sum_visibility), 0)     as sum_visibility,
      coalesce(sum(total_mentions), 0)     as total_mentions,
      coalesce(sum(total_citations), 0)    as total_citations,
      coalesce(sum(positive_count), 0)     as positive_count,
      coalesce(sum(mentioning_answers), 0) as mentioning_results,
      max(max_created_at)                  as last_checked_at,
      coalesce(sum(citation_answers), 0)   as citation_answers,
      coalesce(sum(negative_count), 0)     as negative_count,
      sum(sum_position)                    as sum_position,
      coalesce(sum(position_count), 0)     as position_count,
      -- A day not rewritten since 00131 has no negative or position totals.
      not exists (select 1 from filtered where negative_count is null) as kpi_complete
    from filtered
  ),
  by_model as (
    select
      coalesce(model_used, 'unknown') as model_used,
      sum(sum_visibility)             as sum_visibility,
      sum(answer_count)               as result_count
    from filtered
    group by coalesce(model_used, 'unknown')
  )
  select jsonb_build_object(
    'total_results',      t.total_results,
    'sum_visibility',     t.sum_visibility,
    'total_mentions',     t.total_mentions,
    'total_citations',    t.total_citations,
    'positive_count',     t.positive_count,
    'mentioning_results', t.mentioning_results,
    'last_checked_at',    t.last_checked_at,
    'citation_answers',   t.citation_answers,
    'negative_count',     t.negative_count,
    'sum_position',       t.sum_position,
    'position_count',     t.position_count,
    'kpi_complete',       t.kpi_complete,
    'by_model', coalesce(
      (select jsonb_agg(jsonb_build_object(
                'model_used',     bm.model_used,
                'sum_visibility', bm.sum_visibility,
                'result_count',   bm.result_count)
              order by bm.result_count desc, bm.model_used)
       from by_model bm),
      '[]'::jsonb)
  )
  from totals t;
$$;

-- visible_prompt_stats over rollups.
create function public.visible_prompt_stats_daily(
  p_brand_id uuid,
  p_platform text default null,
  p_models text[] default null,
  p_region text default null,
  p_day_from date default null,
  p_day_to date default null,
  p_topic_id uuid default null
) returns jsonb
language sql
stable
set search_path to 'public'
as $$
  with topic_prompts as (
    select array(select p.id from public.prompts p where p.topic_id = p_topic_id) as ids
  ),
  brand_rows as (
    select bd.mentioning_answers, bd.sum_visibility_visible
    from public.insights_brand_daily bd
    where p_topic_id is null
      and bd.brand_id = p_brand_id
      and (p_platform is null or bd.platform = p_platform)
      and (p_models is null or bd.model_used = any (p_models))
      and (p_region is null or bd.region = p_region)
      and (p_day_from is null or bd.day >= p_day_from)
      and (p_day_to is null or bd.day <= p_day_to)
    union all
    select pd.mentioning_answers, pd.sum_visibility_visible
    from public.insights_prompt_daily pd, topic_prompts tp
    where p_topic_id is not null
      and pd.brand_id = p_brand_id
      and pd.prompt_id = any (tp.ids)
      and (p_platform is null or pd.platform = p_platform)
      and (p_models is null or pd.model_used = any (p_models))
      and (p_region is null or pd.region = p_region)
      and (p_day_from is null or pd.day >= p_day_from)
      and (p_day_to is null or pd.day <= p_day_to)
  ),
  visible_rows as (
    select pd.prompt_id
    from public.insights_prompt_daily pd
    where p_topic_id is null
      and pd.brand_id = p_brand_id
      and (pd.has_mention or pd.has_citation)
      and (p_platform is null or pd.platform = p_platform)
      and (p_models is null or pd.model_used = any (p_models))
      and (p_region is null or pd.region = p_region)
      and (p_day_from is null or pd.day >= p_day_from)
      and (p_day_to is null or pd.day <= p_day_to)
    union all
    select pd.prompt_id
    from public.insights_prompt_daily pd, topic_prompts tp
    where p_topic_id is not null
      and pd.brand_id = p_brand_id
      and pd.prompt_id = any (tp.ids)
      and (pd.has_mention or pd.has_citation)
      and (p_platform is null or pd.platform = p_platform)
      and (p_models is null or pd.model_used = any (p_models))
      and (p_region is null or pd.region = p_region)
      and (p_day_from is null or pd.day >= p_day_from)
      and (p_day_to is null or pd.day <= p_day_to)
  )
  select jsonb_build_object(
    'visible_prompts',
      (select count(distinct prompt_id) from visible_rows),
    'visible_results',
      coalesce((select sum(mentioning_answers) from brand_rows), 0),
    'sum_visibility_visible',
      coalesce((select sum(sum_visibility_visible) from brand_rows), 0)
  );
$$;

-- tracked_prompt_count over rollups.
create function public.tracked_prompt_count_daily(
  p_brand_id uuid,
  p_platform text default null,
  p_models text[] default null,
  p_region text default null,
  p_day_from date default null,
  p_day_to date default null,
  p_topic_id uuid default null
) returns integer
language sql
stable
set search_path to 'public'
as $$
  with topic_prompts as (
    select array(select p.id from public.prompts p where p.topic_id = p_topic_id) as ids
  )
  select count(distinct r.prompt_id)::integer
  from (
    select pd.prompt_id
    from public.insights_prompt_daily pd
    where p_topic_id is null
      and pd.brand_id = p_brand_id
      and (p_platform is null or pd.platform = p_platform)
      and (p_models is null or pd.model_used = any (p_models))
      and (p_region is null or pd.region = p_region)
      and (p_day_from is null or pd.day >= p_day_from)
      and (p_day_to is null or pd.day <= p_day_to)
    union all
    select pd.prompt_id
    from public.insights_prompt_daily pd, topic_prompts tp
    where p_topic_id is not null
      and pd.brand_id = p_brand_id
      and pd.prompt_id = any (tp.ids)
      and (p_platform is null or pd.platform = p_platform)
      and (p_models is null or pd.model_used = any (p_models))
      and (p_region is null or pd.region = p_region)
      and (p_day_from is null or pd.day >= p_day_from)
      and (p_day_to is null or pd.day <= p_day_to)
  ) r
$$;

-- ai_visibility_aggregates over rollups. Liveness join preserved; it runs on
-- the per-competitor totals rather than per row. For a topic, a live
-- competitor with no sightings gets a zero row once the topic has answers.
create function public.ai_visibility_aggregates_daily(
  p_brand_id uuid,
  p_platform text default null,
  p_models text[] default null,
  p_region text default null,
  p_day_from date default null,
  p_day_to date default null,
  p_topic_id uuid default null
) returns jsonb
language sql
stable
set search_path to 'public'
as $$
  with topic_prompts as (
    select array(select p.id from public.prompts p where p.topic_id = p_topic_id) as ids
  ),
  brand_rows as (
    select d.answer_count, d.mention_answers, d.citation_answers,
           d.sum_inv_position, d.position_count
    from public.insights_brand_daily d
    where p_topic_id is null
      and d.brand_id = p_brand_id
      and (p_platform is null or d.platform = p_platform)
      and (p_models is null or d.model_used = any (p_models))
      and (p_region is null or d.region = p_region)
      and (p_day_from is null or d.day >= p_day_from)
      and (p_day_to is null or d.day <= p_day_to)
    union all
    select d.answer_count, d.mention_answers, d.citation_answers,
           d.sum_inv_position, d.position_count
    from public.insights_prompt_daily d, topic_prompts tp
    where p_topic_id is not null
      and d.brand_id = p_brand_id
      and d.prompt_id = any (tp.ids)
      and (p_platform is null or d.platform = p_platform)
      and (p_models is null or d.model_used = any (p_models))
      and (p_region is null or d.region = p_region)
      and (p_day_from is null or d.day >= p_day_from)
      and (p_day_to is null or d.day <= p_day_to)
  ),
  comp_rows as (
    select cd.competitor_id, cd.mention_answers, cd.citation_answers,
           cd.sum_inv_position, cd.position_count
    from public.insights_competitor_daily cd
    where p_topic_id is null
      and cd.brand_id = p_brand_id
      and (p_platform is null or cd.platform = p_platform)
      and (p_models is null or cd.model_used = any (p_models))
      and (p_region is null or cd.region = p_region)
      and (p_day_from is null or cd.day >= p_day_from)
      and (p_day_to is null or cd.day <= p_day_to)
    union all
    select cpd.competitor_id, cpd.mention_answers, cpd.citation_answers,
           cpd.sum_inv_position, cpd.position_count
    from public.insights_competitor_prompt_daily cpd, topic_prompts tp
    where p_topic_id is not null
      and cpd.brand_id = p_brand_id
      and cpd.prompt_id = any (tp.ids)
      and (p_platform is null or cpd.platform = p_platform)
      and (p_models is null or cpd.model_used = any (p_models))
      and (p_region is null or cpd.region = p_region)
      and (p_day_from is null or cpd.day >= p_day_from)
      and (p_day_to is null or cpd.day <= p_day_to)
    union all
    select c.id::text, 0, 0, null::numeric, 0
    from public.competitors c
    where p_topic_id is not null
      and c.brand_id = p_brand_id
      and exists (select 1 from brand_rows)
  ),
  brand_agg as (
    select
      coalesce(sum(answer_count), 0)    as answers,
      coalesce(sum(mention_answers), 0) as mention_answers,
      coalesce(sum(citation_answers), 0) as citation_answers,
      sum(sum_inv_position) / nullif(sum(position_count), 0) as position_factor
    from brand_rows
  ),
  comp_totals as (
    select competitor_id,
           sum(mention_answers)  as mention_answers,
           sum(citation_answers) as citation_answers,
           sum(sum_inv_position) as sum_inv_position,
           sum(position_count)   as position_count
    from comp_rows
    group by competitor_id
  ),
  comp_agg as (
    select ct.competitor_id, c.name, ct.mention_answers, ct.citation_answers,
           ct.sum_inv_position / nullif(ct.position_count, 0) as position_factor
    from comp_totals ct
    join public.competitors c
      on c.id::text = ct.competitor_id and c.brand_id = p_brand_id
  )
  select jsonb_build_object(
    'answers',          b.answers,
    'mention_answers',  b.mention_answers,
    'citation_answers', b.citation_answers,
    'position_factor',  b.position_factor,
    'by_competitor', coalesce(
      (select jsonb_agg(jsonb_build_object(
                'competitor_id',    ca.competitor_id,
                'name',             ca.name,
                'mention_answers',  ca.mention_answers,
                'citation_answers', ca.citation_answers,
                'position_factor',  ca.position_factor)
              order by ca.mention_answers desc, ca.competitor_id)
       from comp_agg ca),
      '[]'::jsonb)
  )
  from brand_agg b;
$$;

-- competitor_aggregates over rollups. Competitor measures fold to one row per
-- (competitor, engine) first, and the liveness join runs on that; the
-- visible-prompt sightings fold to distinct (competitor, engine, prompt).
-- Sightings of competitors that no longer exist need no join of their own:
-- they only ever attach to rows that passed the liveness join. Engine keys
-- join with IS NOT DISTINCT FROM because model_used can be null.
--
-- For a topic, every live competitor gets a row on each engine the topic has
-- answers on: row_count is that engine's answer count (each answer lists
-- every tracked competitor), the other measures are the sightings' sums.
--
-- plpgsql with force_custom_plan and 64 MB work_mem, as 00113 and 00110 set
-- them: planned with the argument values in hand, sorts kept in memory.
create function public.competitor_aggregates_daily(
  p_brand_id uuid,
  p_platform text default null,
  p_models text[] default null,
  p_region text default null,
  p_day_from date default null,
  p_day_to date default null,
  p_topic_id uuid default null
) returns jsonb
language plpgsql
stable
set search_path to 'public'
set work_mem to '64MB'
set plan_cache_mode to 'force_custom_plan'
as $$
begin
  return (
    with topic_prompts as (
      select array(select p.id from public.prompts p where p.topic_id = p_topic_id) as ids
    ),
    brand_days as (
      select d.model_used, d.platform, d.answer_count, d.sum_visibility,
             d.total_mentions, d.total_citations
      from public.insights_brand_daily d
      where p_topic_id is null
        and d.brand_id = p_brand_id
        and (p_platform is null or d.platform = p_platform)
        and (p_models is null or d.model_used = any (p_models))
        and (p_region is null or d.region = p_region)
        and (p_day_from is null or d.day >= p_day_from)
        and (p_day_to is null or d.day <= p_day_to)
      union all
      select d.model_used, d.platform, d.answer_count, d.sum_visibility,
             d.total_mentions, d.total_citations
      from public.insights_prompt_daily d, topic_prompts tp
      where p_topic_id is not null
        and d.brand_id = p_brand_id
        and d.prompt_id = any (tp.ids)
        and (p_platform is null or d.platform = p_platform)
        and (p_models is null or d.model_used = any (p_models))
        and (p_region is null or d.region = p_region)
        and (p_day_from is null or d.day >= p_day_from)
        and (p_day_to is null or d.day <= p_day_to)
    ),
    prompt_days as (
      select d.model_used, d.platform, d.prompt_id, d.has_mention, d.has_citation
      from public.insights_prompt_daily d
      where p_topic_id is null
        and d.brand_id = p_brand_id
        and (p_platform is null or d.platform = p_platform)
        and (p_models is null or d.model_used = any (p_models))
        and (p_region is null or d.region = p_region)
        and (p_day_from is null or d.day >= p_day_from)
        and (p_day_to is null or d.day <= p_day_to)
      union all
      select d.model_used, d.platform, d.prompt_id, d.has_mention, d.has_citation
      from public.insights_prompt_daily d, topic_prompts tp
      where p_topic_id is not null
        and d.brand_id = p_brand_id
        and d.prompt_id = any (tp.ids)
        and (p_platform is null or d.platform = p_platform)
        and (p_models is null or d.model_used = any (p_models))
        and (p_region is null or d.region = p_region)
        and (p_day_from is null or d.day >= p_day_from)
        and (p_day_to is null or d.day <= p_day_to)
    ),
    -- The topic's sightings, one row per (competitor, engine, prompt, day).
    topic_sightings as (
      select cpd.competitor_id, cpd.model_used, cpd.platform, cpd.prompt_id,
             cpd.sum_visibility, cpd.mention_count, cpd.total_citations
      from public.insights_competitor_prompt_daily cpd, topic_prompts tp
      where p_topic_id is not null
        and cpd.brand_id = p_brand_id
        and cpd.prompt_id = any (tp.ids)
        and (p_platform is null or cpd.platform = p_platform)
        and (p_models is null or cpd.model_used = any (p_models))
        and (p_region is null or cpd.region = p_region)
        and (p_day_from is null or cpd.day >= p_day_from)
        and (p_day_to is null or cpd.day <= p_day_to)
    ),
    comp_engine as (
      select cd.competitor_id, cd.model_used, cd.platform,
             sum(cd.sum_visibility)  as sum_visibility,
             sum(cd.answer_count)    as row_count,
             sum(cd.total_mentions)  as total_mentions,
             sum(cd.total_citations) as total_citations
      from public.insights_competitor_daily cd
      where p_topic_id is null
        and cd.brand_id = p_brand_id
        and (p_platform is null or cd.platform = p_platform)
        and (p_models is null or cd.model_used = any (p_models))
        and (p_region is null or cd.region = p_region)
        and (p_day_from is null or cd.day >= p_day_from)
        and (p_day_to is null or cd.day <= p_day_to)
      group by cd.competitor_id, cd.model_used, cd.platform
      union all
      select c.id::text, te.model_used, te.platform,
             coalesce(s.sum_visibility, 0),
             te.row_count,
             coalesce(s.total_mentions, 0),
             coalesce(s.total_citations, 0)
      from (
        select model_used, platform, sum(answer_count) as row_count
        from brand_days
        where p_topic_id is not null
        group by model_used, platform
      ) te
      cross join public.competitors c
      left join (
        select competitor_id, model_used, platform,
               sum(sum_visibility)  as sum_visibility,
               sum(mention_count)   as total_mentions,
               sum(total_citations) as total_citations
        from topic_sightings
        group by competitor_id, model_used, platform
      ) s on s.competitor_id = c.id::text
         and s.model_used is not distinct from te.model_used
         and s.platform is not distinct from te.platform
      where c.brand_id = p_brand_id
    ),
    live_engine as (
      select ce.*, c.name
      from comp_engine ce
      join public.competitors c
        on c.id::text = ce.competitor_id and c.brand_id = p_brand_id
    ),
    comp_sightings as (
      select distinct s.competitor_id, s.model_used, s.platform, s.prompt_id
      from (
        select cpd.competitor_id, cpd.model_used, cpd.platform, cpd.prompt_id
        from public.insights_competitor_prompt_daily cpd
        where p_topic_id is null
          and cpd.brand_id = p_brand_id
          and (p_platform is null or cpd.platform = p_platform)
          and (p_models is null or cpd.model_used = any (p_models))
          and (p_region is null or cpd.region = p_region)
          and (p_day_from is null or cpd.day >= p_day_from)
          and (p_day_to is null or cpd.day <= p_day_to)
        union all
        select ts.competitor_id, ts.model_used, ts.platform, ts.prompt_id
        from topic_sightings ts
      ) s
    ),
    brand_totals as (
      select
        coalesce((select sum(answer_count) from brand_days), 0)    as row_count,
        coalesce((select sum(sum_visibility) from brand_days), 0)  as sum_visibility,
        coalesce((select sum(total_mentions) from brand_days), 0)  as total_mentions,
        coalesce((select sum(total_citations) from brand_days), 0) as total_citations,
        (select count(distinct prompt_id) from prompt_days)        as prompt_count,
        (select count(distinct prompt_id) from prompt_days
          where has_mention or has_citation)                       as visible_prompts
    ),
    by_brand_provider as (
      select b.model_used, b.platform, b.sum_visibility, b.row_count,
             p.prompt_count, p.visible_prompts
      from (
        select model_used, platform,
               sum(sum_visibility) as sum_visibility,
               sum(answer_count)   as row_count
        from brand_days group by model_used, platform
      ) b
      join (
        select model_used, platform,
               count(distinct prompt_id) as prompt_count,
               count(distinct prompt_id)
                 filter (where has_mention or has_citation) as visible_prompts
        from prompt_days group by model_used, platform
      ) p on p.model_used is not distinct from b.model_used
         and p.platform is not distinct from b.platform
    ),
    visible_by_comp as (
      select competitor_id, count(distinct prompt_id) as visible_prompts
      from comp_sightings group by competitor_id
    ),
    visible_by_comp_engine as (
      select competitor_id, model_used, platform, count(*) as visible_prompts
      from comp_sightings group by competitor_id, model_used, platform
    ),
    by_competitor as (
      select
        le.competitor_id,
        max(le.name)              as name,
        sum(le.sum_visibility)    as sum_visibility,
        sum(le.row_count)         as row_count,
        coalesce(sum(le.total_mentions), 0)::bigint  as total_mentions,
        coalesce(sum(le.total_citations), 0)::bigint as total_citations,
        coalesce(max(v.visible_prompts), 0)          as visible_prompts
      from live_engine le
      left join visible_by_comp v on v.competitor_id = le.competitor_id
      group by le.competitor_id
    ),
    by_competitor_provider as (
      select
        le.model_used, le.platform, le.competitor_id,
        le.name                            as competitor_name,
        le.sum_visibility,
        le.row_count,
        coalesce(v.visible_prompts, 0)     as visible_prompts
      from live_engine le
      left join visible_by_comp_engine v
        on v.competitor_id = le.competitor_id
       and v.model_used is not distinct from le.model_used
       and v.platform is not distinct from le.platform
    )
    select jsonb_build_object(
      'brand_row_count',       b.row_count,
      'brand_sum_visibility',  b.sum_visibility,
      'brand_total_mentions',  b.total_mentions,
      'brand_total_citations', b.total_citations,
      'brand_prompt_count',    b.prompt_count,
      'brand_visible_prompts', b.visible_prompts,
      'by_competitor', coalesce(
        (select jsonb_agg(jsonb_build_object(
                  'competitor_id',   bc.competitor_id,
                  'name',            bc.name,
                  'sum_visibility',  bc.sum_visibility,
                  'row_count',       bc.row_count,
                  'total_mentions',  bc.total_mentions,
                  'total_citations', bc.total_citations,
                  'visible_prompts', bc.visible_prompts)
                order by bc.row_count desc, bc.competitor_id)
         from by_competitor bc),
        '[]'::jsonb),
      'by_brand_provider', coalesce(
        (select jsonb_agg(jsonb_build_object(
                  'model_used',      bbp.model_used,
                  'platform',        bbp.platform,
                  'sum_visibility',  bbp.sum_visibility,
                  'row_count',       bbp.row_count,
                  'prompt_count',    bbp.prompt_count,
                  'visible_prompts', bbp.visible_prompts)
                order by bbp.platform nulls last, bbp.model_used nulls last)
         from by_brand_provider bbp),
        '[]'::jsonb),
      'by_competitor_provider', coalesce(
        (select jsonb_agg(jsonb_build_object(
                  'model_used',      bcp.model_used,
                  'platform',        bcp.platform,
                  'competitor_id',   bcp.competitor_id,
                  'competitor_name', bcp.competitor_name,
                  'sum_visibility',  bcp.sum_visibility,
                  'row_count',       bcp.row_count,
                  'visible_prompts', bcp.visible_prompts)
                order by bcp.platform nulls last, bcp.model_used nulls last, bcp.competitor_id)
         from by_competitor_provider bcp),
        '[]'::jsonb)
    )
    from brand_totals b
  );
end;
$$;

-- share_of_voice_aggregates over rollups. No competitors join anywhere — the
-- raw RPC sums every jsonb element regardless of liveness (00066). For a
-- topic, competitor mentions are the sightings' mention_count: an element
-- with mentions is always a sighting. Both sides fold to (day, engine) once;
-- the totals, per-engine and per-day series are all read from those.
create function public.share_of_voice_aggregates_daily(
  p_brand_id uuid,
  p_platform text default null,
  p_models text[] default null,
  p_region text default null,
  p_day_from date default null,
  p_day_to date default null,
  p_topic_id uuid default null
) returns jsonb
language sql
stable
set search_path to 'public'
as $$
  with topic_prompts as (
    select array(select p.id from public.prompts p where p.topic_id = p_topic_id) as ids
  ),
  brand_days as (
    select r.day, r.model_used, r.platform, sum(r.total_mentions) as total_mentions
    from (
      select d.day, d.model_used, d.platform, d.total_mentions
      from public.insights_brand_daily d
      where p_topic_id is null
        and d.brand_id = p_brand_id
        and (p_platform is null or d.platform = p_platform)
        and (p_models is null or d.model_used = any (p_models))
        and (p_region is null or d.region = p_region)
        and (p_day_from is null or d.day >= p_day_from)
        and (p_day_to is null or d.day <= p_day_to)
      union all
      select d.day, d.model_used, d.platform, d.total_mentions
      from public.insights_prompt_daily d, topic_prompts tp
      where p_topic_id is not null
        and d.brand_id = p_brand_id
        and d.prompt_id = any (tp.ids)
        and (p_platform is null or d.platform = p_platform)
        and (p_models is null or d.model_used = any (p_models))
        and (p_region is null or d.region = p_region)
        and (p_day_from is null or d.day >= p_day_from)
        and (p_day_to is null or d.day <= p_day_to)
    ) r
    group by r.day, r.model_used, r.platform
  ),
  comp_days as (
    select r.day, r.model_used, r.platform, sum(r.total_mentions) as total_mentions
    from (
      select d.day, d.model_used, d.platform, d.total_mentions
      from public.insights_competitor_daily d
      where p_topic_id is null
        and d.brand_id = p_brand_id
        and (p_platform is null or d.platform = p_platform)
        and (p_models is null or d.model_used = any (p_models))
        and (p_region is null or d.region = p_region)
        and (p_day_from is null or d.day >= p_day_from)
        and (p_day_to is null or d.day <= p_day_to)
      union all
      select d.day, d.model_used, d.platform, d.mention_count
      from public.insights_competitor_prompt_daily d, topic_prompts tp
      where p_topic_id is not null
        and d.brand_id = p_brand_id
        and d.prompt_id = any (tp.ids)
        and (p_platform is null or d.platform = p_platform)
        and (p_models is null or d.model_used = any (p_models))
        and (p_region is null or d.region = p_region)
        and (p_day_from is null or d.day >= p_day_from)
        and (p_day_to is null or d.day <= p_day_to)
    ) r
    group by r.day, r.model_used, r.platform
  ),
  totals as (
    select
      coalesce((select sum(total_mentions) from brand_days), 0)::bigint as total_brand_mentions,
      coalesce((select sum(total_mentions) from comp_days), 0)::bigint  as total_competitor_mentions
  ),
  by_platform as (
    select b.model_used, b.platform,
           b.brand_mentions,
           coalesce(c.competitor_mentions, 0) as competitor_mentions
    from (
      select model_used, platform,
             coalesce(sum(total_mentions), 0)::bigint as brand_mentions
      from brand_days group by model_used, platform
    ) b
    left join (
      select model_used, platform,
             coalesce(sum(total_mentions), 0)::bigint as competitor_mentions
      from comp_days group by model_used, platform
    ) c on c.model_used is not distinct from b.model_used
       and c.platform is not distinct from b.platform
  ),
  by_day as (
    select b.day,
           b.brand_mentions,
           coalesce(c.competitor_mentions, 0) as competitor_mentions
    from (
      select to_char(day, 'YYYY-MM-DD') as day,
             coalesce(sum(total_mentions), 0)::bigint as brand_mentions
      from brand_days group by day
    ) b
    left join (
      select to_char(day, 'YYYY-MM-DD') as day,
             coalesce(sum(total_mentions), 0)::bigint as competitor_mentions
      from comp_days group by day
    ) c on c.day = b.day
  )
  select jsonb_build_object(
    'total_brand_mentions',      t.total_brand_mentions,
    'total_competitor_mentions', t.total_competitor_mentions,
    'by_platform', coalesce(
      (select jsonb_agg(jsonb_build_object(
                'model_used',          bp.model_used,
                'platform',            bp.platform,
                'brand_mentions',      bp.brand_mentions,
                'competitor_mentions', bp.competitor_mentions)
              order by bp.platform nulls last, bp.model_used nulls last)
       from by_platform bp),
      '[]'::jsonb),
    'by_day', coalesce(
      (select jsonb_agg(jsonb_build_object(
                'day',                 bd.day,
                'brand_mentions',      bd.brand_mentions,
                'competitor_mentions', bd.competitor_mentions)
              order by bd.day)
       from by_day bd),
      '[]'::jsonb)
  )
  from totals t;
$$;

-- visibility_rate_trend over rollups. Liveness join preserved, on the
-- per-day competitor totals; visible sightings attach to those rows only.
-- For a topic, a live competitor with no sightings gets a zero row on each
-- day the topic has answers.
--
-- prompt_daily, comp_daily and comp_visible stay MATERIALIZED and work_mem
-- stays 64 MB (00112): each is referenced once, inside the per-day
-- subselect, and inlined they were re-aggregated for every day.
create function public.visibility_rate_trend_daily(
  p_brand_id uuid,
  p_platform text default null,
  p_models text[] default null,
  p_region text default null,
  p_day_from date default null,
  p_day_to date default null,
  p_topic_id uuid default null
) returns jsonb
language sql
stable
set search_path to 'public'
set work_mem to '64MB'
as $$
  with topic_prompts as (
    select array(select p.id from public.prompts p where p.topic_id = p_topic_id) as ids
  ),
  brand_rows as (
    select d.day, d.answer_count, d.mention_answers, d.citation_answers,
           d.sum_inv_position, d.position_count
    from public.insights_brand_daily d
    where p_topic_id is null
      and d.brand_id = p_brand_id
      and (p_platform is null or d.platform = p_platform)
      and (p_models is null or d.model_used = any (p_models))
      and (p_region is null or d.region = p_region)
      and (p_day_from is null or d.day >= p_day_from)
      and (p_day_to is null or d.day <= p_day_to)
    union all
    select d.day, d.answer_count, d.mention_answers, d.citation_answers,
           d.sum_inv_position, d.position_count
    from public.insights_prompt_daily d, topic_prompts tp
    where p_topic_id is not null
      and d.brand_id = p_brand_id
      and d.prompt_id = any (tp.ids)
      and (p_platform is null or d.platform = p_platform)
      and (p_models is null or d.model_used = any (p_models))
      and (p_region is null or d.region = p_region)
      and (p_day_from is null or d.day >= p_day_from)
      and (p_day_to is null or d.day <= p_day_to)
  ),
  brand_daily as (
    select day,
           sum(answer_count)     as answers,
           sum(mention_answers)  as mention_answers,
           sum(citation_answers) as citation_answers,
           sum(sum_inv_position) / nullif(sum(position_count), 0) as position_factor,
           sum(position_count)   as position_n
    from brand_rows
    group by day
  ),
  prompt_daily as materialized (
    select r.day,
           count(distinct r.prompt_id) as prompt_count,
           count(distinct r.prompt_id)
             filter (where r.has_mention or r.has_citation) as visible_prompts
    from (
      select d.day, d.prompt_id, d.has_mention, d.has_citation
      from public.insights_prompt_daily d
      where p_topic_id is null
        and d.brand_id = p_brand_id
        and (p_platform is null or d.platform = p_platform)
        and (p_models is null or d.model_used = any (p_models))
        and (p_region is null or d.region = p_region)
        and (p_day_from is null or d.day >= p_day_from)
        and (p_day_to is null or d.day <= p_day_to)
      union all
      select d.day, d.prompt_id, d.has_mention, d.has_citation
      from public.insights_prompt_daily d, topic_prompts tp
      where p_topic_id is not null
        and d.brand_id = p_brand_id
        and d.prompt_id = any (tp.ids)
        and (p_platform is null or d.platform = p_platform)
        and (p_models is null or d.model_used = any (p_models))
        and (p_region is null or d.region = p_region)
        and (p_day_from is null or d.day >= p_day_from)
        and (p_day_to is null or d.day <= p_day_to)
    ) r
    group by r.day
  ),
  comp_totals as (
    select r.day, r.competitor_id,
           sum(r.mention_answers)  as mention_answers,
           sum(r.citation_answers) as citation_answers,
           sum(r.sum_inv_position) / nullif(sum(r.position_count), 0) as position_factor,
           sum(r.position_count)   as position_n
    from (
      select cd.day, cd.competitor_id, cd.mention_answers, cd.citation_answers,
             cd.sum_inv_position, cd.position_count
      from public.insights_competitor_daily cd
      where p_topic_id is null
        and cd.brand_id = p_brand_id
        and (p_platform is null or cd.platform = p_platform)
        and (p_models is null or cd.model_used = any (p_models))
        and (p_region is null or cd.region = p_region)
        and (p_day_from is null or cd.day >= p_day_from)
        and (p_day_to is null or cd.day <= p_day_to)
      union all
      select cpd.day, cpd.competitor_id, cpd.mention_answers, cpd.citation_answers,
             cpd.sum_inv_position, cpd.position_count
      from public.insights_competitor_prompt_daily cpd, topic_prompts tp
      where p_topic_id is not null
        and cpd.brand_id = p_brand_id
        and cpd.prompt_id = any (tp.ids)
        and (p_platform is null or cpd.platform = p_platform)
        and (p_models is null or cpd.model_used = any (p_models))
        and (p_region is null or cpd.region = p_region)
        and (p_day_from is null or cpd.day >= p_day_from)
        and (p_day_to is null or cpd.day <= p_day_to)
      union all
      select td.day, c.id::text, 0, 0, null::numeric, 0
      from (select distinct day from brand_rows where p_topic_id is not null) td
      cross join public.competitors c
      where c.brand_id = p_brand_id
    ) r
    group by r.day, r.competitor_id
  ),
  comp_daily as materialized (
    select ct.*
    from comp_totals ct
    join public.competitors c
      on c.id::text = ct.competitor_id and c.brand_id = p_brand_id
  ),
  comp_visible as materialized (
    select r.day, r.competitor_id, count(distinct r.prompt_id) as visible_prompts
    from (
      select cpd.day, cpd.competitor_id, cpd.prompt_id
      from public.insights_competitor_prompt_daily cpd
      where p_topic_id is null
        and cpd.brand_id = p_brand_id
        and (p_platform is null or cpd.platform = p_platform)
        and (p_models is null or cpd.model_used = any (p_models))
        and (p_region is null or cpd.region = p_region)
        and (p_day_from is null or cpd.day >= p_day_from)
        and (p_day_to is null or cpd.day <= p_day_to)
      union all
      select cpd.day, cpd.competitor_id, cpd.prompt_id
      from public.insights_competitor_prompt_daily cpd, topic_prompts tp
      where p_topic_id is not null
        and cpd.brand_id = p_brand_id
        and cpd.prompt_id = any (tp.ids)
        and (p_platform is null or cpd.platform = p_platform)
        and (p_models is null or cpd.model_used = any (p_models))
        and (p_region is null or cpd.region = p_region)
        and (p_day_from is null or cpd.day >= p_day_from)
        and (p_day_to is null or cpd.day <= p_day_to)
    ) r
    group by r.day, r.competitor_id
  )
  select coalesce(
    jsonb_agg(jsonb_build_object(
      'day',              bd.day,
      'prompt_count',     coalesce(pd.prompt_count, 0),
      'visible_prompts',  coalesce(pd.visible_prompts, 0),
      'answers',          bd.answers,
      'mention_answers',  bd.mention_answers,
      'citation_answers', bd.citation_answers,
      'position_factor',  bd.position_factor,
      'position_n',       bd.position_n,
      'competitors', coalesce(
        (select jsonb_agg(jsonb_build_object(
                  'competitor_id',    cd.competitor_id,
                  'visible_prompts',  coalesce(cv.visible_prompts, 0),
                  'mention_answers',  cd.mention_answers,
                  'citation_answers', cd.citation_answers,
                  'position_factor',  cd.position_factor,
                  'position_n',       cd.position_n)
                order by cd.competitor_id)
         from comp_daily cd
         left join comp_visible cv
           on cv.day = cd.day and cv.competitor_id = cd.competitor_id
         where cd.day = bd.day),
        '[]'::jsonb)
    ) order by bd.day),
    '[]'::jsonb)
  from brand_daily bd
  left join prompt_daily pd on pd.day = bd.day;
$$;

-- ─── Comparison reads ───────────────────────────────────────────────────────
--
-- The Insights page's comparisons (Same prompts, Why it changed, By AI
-- platform) read the prompt-grain rollups already; for a topic they keep the
-- topic's current prompts. The bodies are 00149's, 00148's and 00133's with
-- that one filter. The same-prompts read still lists the competitors tracked
-- in each window from insights_competitor_daily: each answer lists every
-- tracked competitor, so a topic's answers track the same ones.

drop function if exists public.insights_same_prompt_compare_daily(
  uuid, date, date, date, date, text[], text);
drop function if exists public.insights_change_drivers_daily(
  uuid, date, date, date, date, text[], text, boolean);
drop function if exists public.insights_platform_compare_daily(
  uuid, date, date, date, date, text[], text, boolean);
drop function if exists public.insights_same_prompt_compare_daily(
  uuid, date, date, date, date, text[], text, uuid);
drop function if exists public.insights_change_drivers_daily(
  uuid, date, date, date, date, text[], text, boolean, uuid);
drop function if exists public.insights_platform_compare_daily(
  uuid, date, date, date, date, text[], text, boolean, uuid);

create function public.insights_same_prompt_compare_daily(
  p_brand_id uuid,
  p_cur_from date,
  p_cur_to date,
  p_prev_from date,
  p_prev_to date,
  p_models text[] default null,
  p_region text default null,
  p_topic_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
set work_mem to '64MB'
set plan_cache_mode to 'force_custom_plan'
as $$
declare
  v_result jsonb;
  -- The topic's prompts, resolved once; null reads every prompt.
  v_topic  uuid[] := case when p_topic_id is not null then
                       array(select p.id from public.prompts p where p.topic_id = p_topic_id)
                     end;
begin
  if auth.role() is distinct from 'service_role' and not exists (
    select 1 from public.brands b
    join public.profiles pf on pf.organization_id = b.organization_id
    where b.id = p_brand_id and pf.id = auth.uid()
  ) then
    return null;
  end if;

  with per_prompt as (
    -- One row per prompt and window: nothing below reads the per-day rows.
    select d.prompt_id,
           case when d.day between p_cur_from and p_cur_to then 'cur' else 'prev' end as win,
           sum(d.answer_count)                as answers,
           sum(d.mention_answers)             as mention_answers,
           sum(d.citation_answers)            as citation_answers,
           sum(d.sum_inv_position)            as sum_inv_position,
           sum(d.position_count)              as position_count,
           sum(d.total_mentions)              as total_mentions,
           sum(d.total_citations)             as total_citations,
           sum(d.positive_count)              as positive_count,
           sum(d.mentioning_answers)          as mentioning_answers,
           sum(d.negative_count)              as negative_count,
           sum(d.sum_position)                as sum_position,
           bool_or(d.has_mention or d.has_citation) as visible,
           bool_or(d.mention_answers is null or d.negative_count is null) as stale
    from public.insights_prompt_daily d
    where d.brand_id = p_brand_id
      and (v_topic is null or d.prompt_id = any (v_topic))
      and (p_models is null or d.model_used = any (p_models))
      and (p_region is null or d.region = p_region)
      and (d.day between p_cur_from and p_cur_to or d.day between p_prev_from and p_prev_to)
    group by 1, 2
  ),
  presence as (
    select prompt_id,
           bool_or(win = 'cur' and answers > 0)  as in_cur,
           bool_or(win = 'prev' and answers > 0) as in_prev
    from per_prompt
    group by prompt_id
  ),
  same_prompts as (
    select prompt_id from presence where in_cur and in_prev
  ),
  brand_agg as (
    select p.win,
           sum(p.answers)            as answers,
           sum(p.mention_answers)    as mention_answers,
           sum(p.citation_answers)   as citation_answers,
           sum(p.sum_inv_position) / nullif(sum(p.position_count), 0) as position_factor,
           sum(p.total_mentions)     as total_mentions,
           sum(p.total_citations)    as total_citations,
           sum(p.positive_count)     as positive_count,
           sum(p.mentioning_answers) as mentioning_answers,
           sum(p.negative_count)     as negative_count,
           sum(p.sum_position)       as sum_position,
           sum(p.position_count)     as position_count,
           count(*) filter (where p.visible) as visible_prompts
    from per_prompt p
    join same_prompts s using (prompt_id)
    group by p.win
  ),
  comp_sums as (
    select case when cd.day between p_cur_from and p_cur_to then 'cur' else 'prev' end as win,
           cd.competitor_id,
           sum(cd.mention_answers)  as mention_answers,
           sum(cd.citation_answers) as citation_answers,
           sum(cd.sum_inv_position) / nullif(sum(cd.position_count), 0) as position_factor,
           sum(cd.mention_count)    as mentions,
           bool_or(cd.mention_answers is null) as stale
    from public.insights_competitor_prompt_daily cd
    where cd.brand_id = p_brand_id
      and cd.prompt_id in (select prompt_id from same_prompts)
      and (p_models is null or cd.model_used = any (p_models))
      and (p_region is null or cd.region = p_region)
      and (cd.day between p_cur_from and p_cur_to or cd.day between p_prev_from and p_prev_to)
    group by 1, 2
  ),
  -- Competitors tracked in each window, from the dense day-grain table (see
  -- 00130): one added during the period then has no previous value.
  tracked as (
    select distinct
           case when cd.day between p_cur_from and p_cur_to then 'cur' else 'prev' end as win,
           cd.competitor_id
    from public.insights_competitor_daily cd
    where cd.brand_id = p_brand_id
      and (p_models is null or cd.model_used = any (p_models))
      and (p_region is null or cd.region = p_region)
      and (cd.day between p_cur_from and p_cur_to or cd.day between p_prev_from and p_prev_to)
  ),
  comp_agg as (
    select t.win,
           t.competitor_id,
           c.name,
           coalesce(cs.mention_answers, 0)  as mention_answers,
           coalesce(cs.citation_answers, 0) as citation_answers,
           cs.position_factor
    from tracked t
    join public.competitors c
      on c.id::text = t.competitor_id and c.brand_id = p_brand_id
    left join comp_sums cs
      on cs.win = t.win and cs.competitor_id = t.competitor_id
  ),
  -- Every competitor's mentions on the shared prompts, for share of voice
  -- (which counts all competitors, as share_of_voice_aggregates does).
  comp_mentions as (
    select win, sum(mentions) as mentions from comp_sums group by win
  ),
  windows(win) as (values ('cur'), ('prev'))
  select jsonb_build_object(
    'complete', not exists (select 1 from per_prompt where stale)
                and not exists (select 1 from comp_sums where stale),
    'same_prompts',    (select count(*) from same_prompts),
    'new_prompts',     (select count(*) from presence where in_cur and not in_prev),
    'dropped_prompts', (select count(*) from presence where in_prev and not in_cur)
  ) || (
    select jsonb_object_agg(w.win, jsonb_build_object(
      'answers',            coalesce(b.answers, 0),
      'mention_answers',    coalesce(b.mention_answers, 0),
      'citation_answers',   coalesce(b.citation_answers, 0),
      'position_factor',    b.position_factor,
      'total_mentions',     coalesce(b.total_mentions, 0),
      'total_citations',    coalesce(b.total_citations, 0),
      'positive_count',     coalesce(b.positive_count, 0),
      'mentioning_answers', coalesce(b.mentioning_answers, 0),
      'negative_count',     coalesce(b.negative_count, 0),
      'sum_position',       b.sum_position,
      'position_count',     coalesce(b.position_count, 0),
      'visible_prompts',    coalesce(b.visible_prompts, 0),
      'competitor_mentions', coalesce((select cm.mentions from comp_mentions cm where cm.win = w.win), 0),
      'by_competitor', coalesce(
        (select jsonb_agg(jsonb_build_object(
                  'competitor_id',    ca.competitor_id,
                  'name',             ca.name,
                  'mention_answers',  ca.mention_answers,
                  'citation_answers', ca.citation_answers,
                  'position_factor',  ca.position_factor)
                order by ca.mention_answers desc, ca.competitor_id)
         from comp_agg ca where ca.win = w.win),
        '[]'::jsonb)))
    from windows w
    left join brand_agg b on b.win = w.win
  )
  into v_result;

  return v_result;
end;
$$;

create function public.insights_change_drivers_daily(
  p_brand_id uuid,
  p_cur_from date,
  p_cur_to date,
  p_prev_from date,
  p_prev_to date,
  p_models text[] default null,
  p_region text default null,
  p_same_prompts boolean default true,
  p_topic_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
set work_mem to '64MB'
set plan_cache_mode to 'force_custom_plan'
as $$
declare
  v_result jsonb;
  -- The topic's prompts, resolved once; null reads every prompt.
  v_topic  uuid[] := case when p_topic_id is not null then
                       array(select p.id from public.prompts p where p.topic_id = p_topic_id)
                     end;
begin
  if auth.role() is distinct from 'service_role' and not exists (
    select 1 from public.brands b
    join public.profiles pf on pf.organization_id = b.organization_id
    where b.id = p_brand_id and pf.id = auth.uid()
  ) then
    return null;
  end if;

  with per_engine as (
    -- One row per prompt, engine and window: nothing below reads the
    -- per-day rows.
    select d.prompt_id, d.model_used, d.platform,
           case when d.day between p_cur_from and p_cur_to then 'cur' else 'prev' end as win,
           sum(d.answer_count)                as answers,
           sum(d.mention_answers)             as mention_answers,
           sum(d.citation_answers)            as citation_answers,
           sum(d.sum_inv_position)            as sum_inv_position,
           sum(d.position_count)              as position_count,
           bool_or(d.mention_answers is null) as stale
    from public.insights_prompt_daily d
    where d.brand_id = p_brand_id
      and (v_topic is null or d.prompt_id = any (v_topic))
      and (p_models is null or d.model_used = any (p_models))
      and (p_region is null or d.region = p_region)
      and (d.day between p_cur_from and p_cur_to or d.day between p_prev_from and p_prev_to)
    group by 1, 2, 3, 4
  ),
  presence as (
    select prompt_id,
           bool_or(win = 'cur')  as in_cur,
           bool_or(win = 'prev') as in_prev
    from per_engine
    group by prompt_id
  ),
  scoped as (
    select r.* from per_engine r join presence p using (prompt_id)
    where not p_same_prompts or (p.in_cur and p.in_prev)
  ),
  by_prompt as (
    select prompt_id, win,
           sum(answers)          as answers,
           sum(mention_answers)  as mention_answers,
           sum(citation_answers) as citation_answers,
           sum(sum_inv_position) as sum_inv_position,
           sum(position_count)   as position_count
    from scoped
    group by prompt_id, win
  ),
  by_engine as (
    select model_used, platform, win,
           sum(answers)          as answers,
           sum(mention_answers)  as mention_answers,
           sum(citation_answers) as citation_answers,
           sum(sum_inv_position) as sum_inv_position,
           sum(position_count)   as position_count
    from scoped
    group by model_used, platform, win
  ),
  added as (
    select p.created_at
    from presence pr
    join public.prompts p on p.id = pr.prompt_id
    where pr.in_cur and not pr.in_prev
  )
  select jsonb_build_object(
    'complete', not exists (select 1 from per_engine where stale),
    'prompts', coalesce(
      (select jsonb_agg(jsonb_build_object(
                'prompt_id',        b.prompt_id,
                'win',              b.win,
                'answers',          b.answers,
                'mention_answers',  b.mention_answers,
                'citation_answers', b.citation_answers,
                'sum_inv_position', b.sum_inv_position,
                'position_count',   b.position_count))
       from by_prompt b),
      '[]'::jsonb),
    'engines', coalesce(
      (select jsonb_agg(jsonb_build_object(
                'model_used',       e.model_used,
                'platform',         e.platform,
                'win',              e.win,
                'answers',          e.answers,
                'mention_answers',  e.mention_answers,
                'citation_answers', e.citation_answers,
                'sum_inv_position', e.sum_inv_position,
                'position_count',   e.position_count))
       from by_engine e),
      '[]'::jsonb),
    'prompt_info', coalesce(
      (select jsonb_agg(jsonb_build_object(
                'id',         p.id,
                'text',       p.text,
                'topic_id',   p.topic_id,
                'topic_name', t.name))
       from public.prompts p
       left join public.topics t on t.id = p.topic_id
       where p.id in (select prompt_id from by_prompt)),
      '[]'::jsonb),
    -- Dates only for prompts created this period: one answered again after
    -- a pause is new to the comparison, not newly added.
    'new_prompts', (select jsonb_build_object(
                      'count',       count(*),
                      'first_added', min(created_at) filter (
                                       where created_at >= (p_cur_from::timestamp at time zone 'utc')),
                      'last_added',  max(created_at) filter (
                                       where created_at >= (p_cur_from::timestamp at time zone 'utc')))
                    from added)
  )
  into v_result;

  return v_result;
end;
$$;

create function public.insights_platform_compare_daily(
  p_brand_id uuid,
  p_cur_from date default null,
  p_cur_to date default null,
  p_prev_from date default null,
  p_prev_to date default null,
  p_models text[] default null,
  p_region text default null,
  p_same_prompts boolean default true,
  p_topic_id uuid default null
)
returns jsonb
language sql
stable
security invoker
set search_path to 'public'
as $$
  with prompt_rows as (
    select d.*,
           case when d.day between coalesce(p_cur_from, '-infinity'::date)
                               and coalesce(p_cur_to, 'infinity'::date)
                then 'cur' else 'prev' end as win
    from public.insights_prompt_daily d
    where d.brand_id = p_brand_id
      and (p_topic_id is null or d.prompt_id in (
             select p.id from public.prompts p where p.topic_id = p_topic_id))
      and (p_models is null or d.model_used = any (p_models))
      and (p_region is null or d.region = p_region)
      and (d.day between coalesce(p_cur_from, '-infinity'::date)
                     and coalesce(p_cur_to, 'infinity'::date)
           or d.day between p_prev_from and p_prev_to)
  ),
  shared as (
    select prompt_id
    from prompt_rows
    group by prompt_id
    having bool_or(win = 'cur') and bool_or(win = 'prev')
  ),
  scoped as (
    select * from prompt_rows
    where not p_same_prompts or prompt_id in (select prompt_id from shared)
  ),
  platforms as (
    select model_used, platform, win,
           sum(answer_count)     as answers,
           sum(mention_answers)  as mention_answers,
           sum(citation_answers) as citation_answers,
           sum(sum_inv_position) as sum_inv_position,
           sum(position_count)   as position_count,
           sum(sum_position)     as sum_position,
           case when win = 'cur' then
             coalesce(array_agg(distinct prompt_id) filter (where has_mention or has_citation),
                      '{}')
           end                   as visible_prompt_ids,
           case when win = 'cur' then array_agg(distinct prompt_id) end
                                 as active_prompt_ids
    from scoped
    group by model_used, platform, win
  )
  select jsonb_build_object(
    'complete', not exists (
                  select 1 from prompt_rows
                  where mention_answers is null or negative_count is null),
    'platforms', coalesce(
      (select jsonb_agg(jsonb_build_object(
                'model_used',         p.model_used,
                'platform',           p.platform,
                'win',                p.win,
                'answers',            p.answers,
                'mention_answers',    p.mention_answers,
                'citation_answers',   p.citation_answers,
                'sum_inv_position',   p.sum_inv_position,
                'position_count',     p.position_count,
                'sum_position',       p.sum_position,
                'visible_prompt_ids', p.visible_prompt_ids,
                'active_prompt_ids',  p.active_prompt_ids))
       from platforms p),
      '[]'::jsonb)
  );
$$;

revoke execute on function public.insights_same_prompt_compare_daily(
  uuid, date, date, date, date, text[], text, uuid
) from public, anon;
grant execute on function public.insights_same_prompt_compare_daily(
  uuid, date, date, date, date, text[], text, uuid
) to authenticated, service_role;

revoke execute on function public.insights_change_drivers_daily(
  uuid, date, date, date, date, text[], text, boolean, uuid
) from public, anon;
grant execute on function public.insights_change_drivers_daily(
  uuid, date, date, date, date, text[], text, boolean, uuid
) to authenticated, service_role;

revoke all on function public.insights_platform_compare_daily(
  uuid, date, date, date, date, text[], text, boolean, uuid
) from public;
grant execute on function public.insights_platform_compare_daily(
  uuid, date, date, date, date, text[], text, boolean, uuid
) to authenticated, service_role;

comment on function public.insights_platform_compare_daily(
  uuid, date, date, date, date, text[], text, boolean, uuid
) is
  'Insights summary line (VIS-006, 00132): Visibility components per (model, platform) in both comparison windows, over the prompts answered in both when p_same_prompts, from the prompt-grain rollups; p_topic_id keeps a topic''s prompts (00164). complete=false until they are backfilled (00130).';

-- PostgREST caches function signatures; make it see the new ones now.
notify pgrst, 'reload schema';
