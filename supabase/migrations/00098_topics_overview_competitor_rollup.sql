-- Topics page: stop exploding competitor_mentions on every load.
--
-- topics_overview_aggregates recomputed the last 30 days of prompt_results per
-- page view. On the largest brand (~100k results in 30 days) it ran 16s, past
-- the authenticated role's 8s statement timeout, so the page failed to load.
-- Scanning the rows themselves takes 0.3s; unpacking every answer's
-- competitor_mentions jsonb (1.8M elements) for the per-topic competitor
-- share took the rest.
--
-- insights_competitor_prompt_daily already records every (competitor, prompt,
-- engine, day) sighting. It gains the sighting's mention count, the daily
-- refresh writes it, and the topics function reads the competitor share from
-- there. The rest of the function is unchanged.
--
-- Existing rollup rows get mention_count = 0 until refresh_insights_daily
-- rewrites them; the last 31 days are backfilled right after this migration.

alter table public.insights_competitor_prompt_daily
  add column if not exists mention_count integer not null default 0;

comment on column public.insights_competitor_prompt_daily.mention_count is
  'Sum of the competitor''s mention_count across the answers in this sighting.';

create or replace function public.refresh_insights_daily(
  p_brand_id uuid,
  p_day_from date,
  p_day_to date
) returns void
language plpgsql
set search_path to 'public'
as $$
begin
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
    positive_count, sum_inv_position, position_count, max_created_at)
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
    sum(1.0 / pr.mention_position) filter (where pr.mention_position is not null),
    count(*) filter (where pr.mention_position is not null),
    max(pr.created_at)
  from public.prompt_results pr
  where pr.brand_id = p_brand_id
    and pr.platform <> 'chatgpt-shopping'  -- #155 — isolate from Insights
    and (pr.created_at at time zone 'utc')::date between p_day_from and p_day_to
  group by 2, pr.model_used, pr.platform, pr.region;

  insert into public.insights_prompt_daily (
    brand_id, day, prompt_id, model_used, platform, region,
    answer_count, has_mention, has_citation)
  select
    p_brand_id,
    (pr.created_at at time zone 'utc')::date,
    pr.prompt_id, pr.model_used, pr.platform, pr.region,
    count(*),
    bool_or(pr.mention_count > 0),
    bool_or(pr.citation_count > 0)
  from public.prompt_results pr
  where pr.brand_id = p_brand_id
    and pr.prompt_id is not null
    and pr.platform <> 'chatgpt-shopping'
    and (pr.created_at at time zone 'utc')::date between p_day_from and p_day_to
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
      filter (where (cm.value->>'mention_position') is not null),
    count(*) filter (where (cm.value->>'mention_position') is not null)
  from public.prompt_results pr,
       lateral jsonb_array_elements(coalesce(pr.competitor_mentions, '[]'::jsonb)) cm
  where pr.brand_id = p_brand_id
    and pr.platform <> 'chatgpt-shopping'
    and (pr.created_at at time zone 'utc')::date between p_day_from and p_day_to
    and cm.value ? 'competitor_id'
  group by 2, cm.value->>'competitor_id', pr.model_used, pr.platform, pr.region;

  insert into public.insights_competitor_prompt_daily (
    brand_id, day, competitor_id, prompt_id, model_used, platform, region, mention_count)
  select
    p_brand_id,
    (pr.created_at at time zone 'utc')::date,
    cm.value->>'competitor_id',
    pr.prompt_id, pr.model_used, pr.platform, pr.region,
    sum(coalesce((cm.value->>'mention_count')::int, 0))
  from public.prompt_results pr,
       lateral jsonb_array_elements(coalesce(pr.competitor_mentions, '[]'::jsonb)) cm
  where pr.brand_id = p_brand_id
    and pr.prompt_id is not null
    and pr.platform <> 'chatgpt-shopping'
    and (pr.created_at at time zone 'utc')::date between p_day_from and p_day_to
    and cm.value ? 'competitor_id'
    and (coalesce((cm.value->>'mention_count')::int, 0) > 0
      or coalesce((cm.value->>'citation_count')::int, 0) > 0
      or coalesce((cm.value->>'visibility_score')::numeric, 0) > 0)
  group by 2, cm.value->>'competitor_id', pr.prompt_id, pr.model_used, pr.platform, pr.region;
end;
$$;

revoke execute on function public.refresh_insights_daily(uuid, date, date)
  from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.topics_overview_aggregates(p_brand_id uuid)
RETURNS TABLE (
  topic_id             uuid,
  answers              bigint,
  mention_answers      bigint,
  citation_answers     bigint,
  pos_sum              double precision,
  pos_n                bigint,
  cur_answers          bigint,
  cur_mention_answers  bigint,
  cur_citation_answers bigint,
  cur_pos_sum          double precision,
  cur_pos_n            bigint,
  prev_answers         bigint,
  prev_mention_answers bigint,
  prev_citation_answers bigint,
  prev_pos_sum         double precision,
  prev_pos_n           bigint,
  total_mentions       bigint,
  total_citations      bigint,
  comp_mentions        bigint,
  active_prompts       bigint,
  visible_prompts      bigint,
  last_run_at          timestamptz,
  competitors          jsonb,
  daily                jsonb
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
WITH bounds AS (
  SELECT now() - interval '30 days' AS since_30d,
         now() - interval '7 days'  AS cur_from,
         now() - interval '14 days' AS prev_from,
         -- Start of the 14th day back in UTC, so the earliest bucket the page
         -- draws is complete rather than clipped at the current time of day.
         date_trunc('day', (now() AT TIME ZONE 'UTC') - interval '13 days')
           AT TIME ZONE 'UTC' AS spark_from,
         -- The competitor share reads whole UTC days from the rollup. Thirty
         -- days counting today spans the same nightly runs as since_30d once
         -- today's run is in; a 31st day would add one run the rows above
         -- leave out and inflate the share by a thirtieth.
         ((now() AT TIME ZONE 'UTC') - interval '29 days')::date AS comp_from_day
),
-- Answers in the window, carrying the topic their prompt belongs to. The
-- prompt_sets join is what scopes prompts to this brand; prompt_results is
-- filtered on brand_id as well, matching what the page did client-side.
rows AS (
  SELECT p.topic_id,
         pr.prompt_id,
         pr.created_at,
         COALESCE(pr.mention_count, 0)  AS mentions,
         COALESCE(pr.citation_count, 0) AS citations,
         pr.mention_position,
         (COALESCE(pr.mention_count, 0) > 0 OR COALESCE(pr.citation_count, 0) > 0) AS visible
  FROM public.prompt_results pr
  JOIN public.prompts p        ON p.id = pr.prompt_id
  JOIN public.prompt_sets ps   ON ps.id = p.prompt_set_id
  CROSS JOIN bounds b
  WHERE pr.brand_id = p_brand_id
    AND ps.brand_id = p_brand_id
    AND p.topic_id IS NOT NULL
    AND pr.platform <> 'chatgpt-shopping'  -- #155 - isolate from analytics
    AND pr.created_at >= b.since_30d
),
-- Competitor share per topic, from the daily rollup of competitor sightings
-- (insights_competitor_prompt_daily) rather than prompt_results. Exploding
-- competitor_mentions on the fly took 6 of the 16 seconds this function spent
-- on the largest brand — 1.8M array elements over 30 days — past the
-- authenticated role's 8s statement timeout. The rollup already holds one row
-- per (competitor, prompt, engine, day) the competitor appeared in, with its
-- mention count.
--
-- Joined through prompts at read time, so a prompt moved to another topic
-- takes its history along, as the raw read did. Named from the live
-- competitors table: a deleted competitor drops out, as it does from the
-- Insights comparison.
comps AS (
  SELECT p.topic_id,
         cpd.competitor_id,
         MIN(c.name)                      AS name,
         SUM(cpd.mention_count)::bigint   AS mentions
  FROM public.insights_competitor_prompt_daily cpd
  JOIN public.prompts p      ON p.id = cpd.prompt_id
  JOIN public.prompt_sets ps ON ps.id = p.prompt_set_id
  JOIN public.competitors c  ON c.id::text = cpd.competitor_id AND c.brand_id = p_brand_id
  CROSS JOIN bounds b
  WHERE cpd.brand_id = p_brand_id
    AND ps.brand_id = p_brand_id
    AND p.topic_id IS NOT NULL
    AND cpd.day >= b.comp_from_day
  GROUP BY p.topic_id, cpd.competitor_id
  HAVING SUM(cpd.mention_count) > 0
),
comp_totals AS (
  SELECT topic_id,
         SUM(mentions) AS comp_mentions,
         jsonb_object_agg(competitor_id, jsonb_build_object('name', name, 'sov', mentions)) AS competitors
  FROM comps
  GROUP BY topic_id
),
-- Fourteen daily buckets for the sparkline. Only the days the page draws.
--
-- Keyed in UTC, because the client builds the same keys from
-- `Date.toISOString()` — reading them in the database's session timezone
-- would shift every bucket by the offset and silently redraw the trend.
daily AS (
  SELECT d.topic_id,
         jsonb_object_agg(d.day, jsonb_build_object('visible', d.visible, 'count', d.count)) AS daily
  FROM (
    SELECT r2.topic_id,
           to_char(r2.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
           COUNT(*) FILTER (WHERE r2.visible) AS visible,
           COUNT(*) AS count
    FROM rows r2
    CROSS JOIN bounds b
    WHERE r2.created_at >= b.spark_from
    GROUP BY r2.topic_id, to_char(r2.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')
  ) d
  GROUP BY d.topic_id
),
main AS (
  SELECT r.topic_id,
         COUNT(*)::bigint                                          AS answers,
         COUNT(*) FILTER (WHERE r.mentions > 0)::bigint            AS mention_answers,
         COUNT(*) FILTER (WHERE r.citations > 0)::bigint           AS citation_answers,
         COALESCE(SUM(1.0 / r.mention_position)
           FILTER (WHERE r.mention_position > 0), 0)::double precision AS pos_sum,
         COUNT(*) FILTER (WHERE r.mention_position > 0)::bigint    AS pos_n,

         COUNT(*) FILTER (WHERE r.created_at >= b.cur_from)::bigint AS cur_answers,
         COUNT(*) FILTER (WHERE r.created_at >= b.cur_from AND r.mentions > 0)::bigint
                                                                    AS cur_mention_answers,
         COUNT(*) FILTER (WHERE r.created_at >= b.cur_from AND r.citations > 0)::bigint
                                                                    AS cur_citation_answers,
         COALESCE(SUM(1.0 / r.mention_position)
           FILTER (WHERE r.created_at >= b.cur_from AND r.mention_position > 0), 0)::double precision
                                                                    AS cur_pos_sum,
         COUNT(*) FILTER (WHERE r.created_at >= b.cur_from AND r.mention_position > 0)::bigint
                                                                    AS cur_pos_n,

         COUNT(*) FILTER (WHERE r.created_at < b.cur_from AND r.created_at >= b.prev_from)::bigint
                                                                    AS prev_answers,
         COUNT(*) FILTER (WHERE r.created_at < b.cur_from AND r.created_at >= b.prev_from
           AND r.mentions > 0)::bigint                              AS prev_mention_answers,
         COUNT(*) FILTER (WHERE r.created_at < b.cur_from AND r.created_at >= b.prev_from
           AND r.citations > 0)::bigint                             AS prev_citation_answers,
         COALESCE(SUM(1.0 / r.mention_position)
           FILTER (WHERE r.created_at < b.cur_from AND r.created_at >= b.prev_from
             AND r.mention_position > 0), 0)::double precision      AS prev_pos_sum,
         COUNT(*) FILTER (WHERE r.created_at < b.cur_from AND r.created_at >= b.prev_from
           AND r.mention_position > 0)::bigint                      AS prev_pos_n,

         COALESCE(SUM(r.mentions), 0)::bigint                       AS total_mentions,
         COALESCE(SUM(r.citations), 0)::bigint                      AS total_citations,
         COUNT(DISTINCT r.prompt_id)::bigint                        AS active_prompts,
         COUNT(DISTINCT r.prompt_id) FILTER (WHERE r.visible)::bigint AS visible_prompts,
         MAX(r.created_at)                                          AS last_run_at
  FROM rows r
  CROSS JOIN bounds b
  GROUP BY r.topic_id
)
-- The two jsonb rollups join on at the end rather than riding through the
-- GROUP BY: Postgres has no max(jsonb), and carrying them through an
-- aggregate would need a wrapper that buys nothing here.
SELECT m.topic_id,
       m.answers, m.mention_answers, m.citation_answers, m.pos_sum, m.pos_n,
       m.cur_answers, m.cur_mention_answers, m.cur_citation_answers, m.cur_pos_sum, m.cur_pos_n,
       m.prev_answers, m.prev_mention_answers, m.prev_citation_answers, m.prev_pos_sum, m.prev_pos_n,
       m.total_mentions, m.total_citations,
       COALESCE(ct.comp_mentions, 0)::bigint,
       m.active_prompts, m.visible_prompts, m.last_run_at,
       COALESCE(ct.competitors, '{}'::jsonb),
       COALESCE(dl.daily, '{}'::jsonb)
FROM main m
LEFT JOIN comp_totals ct ON ct.topic_id = m.topic_id
LEFT JOIN daily dl       ON dl.topic_id = m.topic_id
$$;

GRANT EXECUTE ON FUNCTION public.topics_overview_aggregates(uuid) TO authenticated;
