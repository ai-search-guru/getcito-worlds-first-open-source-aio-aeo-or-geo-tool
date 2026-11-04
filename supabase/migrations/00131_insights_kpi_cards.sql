-- Insights KPI cards v2 (VIS-003).
--
-- The v2 mockup's KPI rows add Net sentiment (positive share minus negative
-- share of the answers naming the brand), Avg. position (mean position when
-- named), Citation rate, Coverage and Share of voice, each with a sparkline
-- and a change that follows "Compare: Same prompts" (00130).
--
-- The rollups had no negative count and no position sum (only the 1/position
-- sum behind the Visibility score), so both day-grain and prompt-grain brand
-- tables gain them. Like 00130, the columns are nullable: a day not rewritten
-- by refresh_insights_daily since this migration reads NULL, the functions
-- below report it (kpi_complete / complete = false) and the app shows those
-- two cards without a value instead of a partial one. After deploying, run
-- the backfill once (it covers 00130 too):
--
--   cd backend && node src/scripts/backfillInsightsDaily.js
--
-- Also here:
--   insights_aggregates[_daily]        + citation, negative and position totals
--   insights_same_prompt_compare[_daily] + the same, the shared prompts that
--                                      appeared, and competitor mentions for
--                                      share of voice
--   insights_kpi_series (new)          one row of components per day, for the
--                                      cards' sparklines

-- ─── Columns ────────────────────────────────────────────────────────────────

alter table public.insights_brand_daily
  add column if not exists negative_count integer,
  add column if not exists sum_position numeric;

alter table public.insights_prompt_daily
  add column if not exists negative_count integer,
  add column if not exists sum_position numeric;

comment on column public.insights_brand_daily.sum_position is
  'Sum of mention_position over answers naming the brand (00131); with position_count gives the mean position. NULL until refresh_insights_daily rewrites the day.';

-- ─── Refresh: 00130 plus the new columns ────────────────────────────────────

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
    sum(1.0 / pr.mention_position) filter (where pr.mention_position is not null),
    count(*) filter (where pr.mention_position is not null),
    max(pr.created_at),
    count(*) filter (where pr.sentiment = 'negative'),
    sum(pr.mention_position) filter (where pr.mention_position is not null)
  from public.prompt_results pr
  where pr.brand_id = p_brand_id
    and pr.platform <> 'chatgpt-shopping'  -- #155 — isolate from Insights
    and (pr.created_at at time zone 'utc')::date between p_day_from and p_day_to
  group by 2, pr.model_used, pr.platform, pr.region;

  insert into public.insights_prompt_daily (
    brand_id, day, prompt_id, model_used, platform, region,
    answer_count, has_mention, has_citation,
    mention_answers, citation_answers, mentioning_answers, positive_count,
    total_mentions, total_citations, sum_inv_position, position_count,
    negative_count, sum_position)
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
    sum(1.0 / pr.mention_position) filter (where pr.mention_position is not null),
    count(*) filter (where pr.mention_position is not null),
    count(*) filter (where pr.sentiment = 'negative'),
    sum(pr.mention_position) filter (where pr.mention_position is not null)
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
    brand_id, day, competitor_id, prompt_id, model_used, platform, region, mention_count,
    mention_answers, citation_answers, sum_inv_position, position_count)
  select
    p_brand_id,
    (pr.created_at at time zone 'utc')::date,
    cm.value->>'competitor_id',
    pr.prompt_id, pr.model_used, pr.platform, pr.region,
    sum(coalesce((cm.value->>'mention_count')::int, 0)),
    count(*) filter (where coalesce((cm.value->>'mention_count')::int, 0) > 0),
    count(*) filter (where coalesce((cm.value->>'citation_count')::int, 0) > 0),
    sum(1.0 / (cm.value->>'mention_position')::numeric)
      filter (where (cm.value->>'mention_position') is not null),
    count(*) filter (where (cm.value->>'mention_position') is not null)
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

-- ─── Window totals: the cards' new components ──────────────────────────────

CREATE OR REPLACE FUNCTION public.insights_aggregates(
  p_brand_id   uuid,
  p_platform   text         DEFAULT NULL,
  p_models     text[]       DEFAULT NULL,
  p_region     text         DEFAULT NULL,
  p_date_from  timestamptz  DEFAULT NULL,
  p_date_to    timestamptz  DEFAULT NULL,
  p_prompt_id  uuid         DEFAULT NULL,
  p_topic_id   uuid         DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH filtered AS (
    SELECT pr.visibility_score, pr.mention_count, pr.citation_count,
           pr.sentiment, pr.model_used, pr.created_at, pr.mention_position
    FROM public.prompt_results pr
    WHERE pr.brand_id = p_brand_id
      AND pr.platform <> 'chatgpt-shopping'  -- #155 — isolate from Insights
      AND (p_platform  IS NULL OR pr.platform    = p_platform)
      AND (p_models    IS NULL OR pr.model_used  = ANY (p_models))
      AND (p_region    IS NULL OR pr.region      = p_region)
      AND (p_date_from IS NULL OR pr.created_at >= p_date_from)
      AND (p_date_to   IS NULL OR pr.created_at <= p_date_to)
      AND (p_prompt_id IS NULL OR pr.prompt_id   = p_prompt_id)
      AND (p_topic_id  IS NULL OR EXISTS (
             SELECT 1 FROM public.prompts p
             WHERE p.id = pr.prompt_id AND p.topic_id = p_topic_id))
  ),
  totals AS (
    SELECT
      COUNT(*)                                                AS total_results,
      COALESCE(SUM(visibility_score), 0)                      AS sum_visibility,
      COALESCE(SUM(mention_count), 0)                         AS total_mentions,
      COALESCE(SUM(citation_count), 0)                        AS total_citations,
      COUNT(*) FILTER (WHERE sentiment = 'positive')          AS positive_count,
      COUNT(*) FILTER (WHERE mention_count > 0
                          OR citation_count > 0)               AS mentioning_results,
      MAX(created_at)                                         AS last_checked_at,
      COUNT(*) FILTER (WHERE citation_count > 0)              AS citation_answers,
      COUNT(*) FILTER (WHERE sentiment = 'negative')          AS negative_count,
      SUM(mention_position)
        FILTER (WHERE mention_position IS NOT NULL)           AS sum_position,
      COUNT(*) FILTER (WHERE mention_position IS NOT NULL)    AS position_count
    FROM filtered
  ),
  by_model AS (
    SELECT
      COALESCE(model_used, 'unknown') AS model_used,
      SUM(visibility_score)           AS sum_visibility,
      COUNT(*)                        AS result_count
    FROM filtered
    GROUP BY COALESCE(model_used, 'unknown')
  )
  SELECT jsonb_build_object(
    'total_results',       t.total_results,
    'sum_visibility',      t.sum_visibility,
    'total_mentions',      t.total_mentions,
    'total_citations',     t.total_citations,
    'positive_count',      t.positive_count,
    'mentioning_results',  t.mentioning_results,
    'last_checked_at',     t.last_checked_at,
    'citation_answers',    t.citation_answers,
    'negative_count',      t.negative_count,
    'sum_position',        t.sum_position,
    'position_count',      t.position_count,
    'kpi_complete',        true,
    'by_model', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
                'model_used',     bm.model_used,
                'sum_visibility', bm.sum_visibility,
                'result_count',   bm.result_count)
              ORDER BY bm.result_count DESC, bm.model_used)
       FROM by_model bm),
      '[]'::jsonb)
  )
  FROM totals t;
$$;

create or replace function public.insights_aggregates_daily(
  p_brand_id uuid,
  p_platform text default null,
  p_models text[] default null,
  p_region text default null,
  p_day_from date default null,
  p_day_to date default null
) returns jsonb
language sql
stable
set search_path to 'public'
as $$
  with filtered as (
    select * from public.insights_brand_daily d
    where d.brand_id = p_brand_id
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

-- ─── Same prompts: the new components too ──────────────────────────────────

create or replace function public.insights_same_prompt_compare_daily(
  p_brand_id uuid,
  p_cur_from date,
  p_cur_to date,
  p_prev_from date,
  p_prev_to date,
  p_models text[] default null,
  p_region text default null
)
returns jsonb
language sql
stable
security invoker
set search_path to 'public'
as $$
  with prompt_rows as (
    select d.*,
           case when d.day between p_cur_from and p_cur_to then 'cur' else 'prev' end as win
    from public.insights_prompt_daily d
    where d.brand_id = p_brand_id
      and (p_models is null or d.model_used = any (p_models))
      and (p_region is null or d.region = p_region)
      and (d.day between p_cur_from and p_cur_to or d.day between p_prev_from and p_prev_to)
  ),
  presence as (
    select prompt_id,
           bool_or(win = 'cur' and answer_count > 0)  as in_cur,
           bool_or(win = 'prev' and answer_count > 0) as in_prev
    from prompt_rows
    group by prompt_id
  ),
  same_prompts as (
    select prompt_id from presence where in_cur and in_prev
  ),
  brand_agg as (
    select r.win,
           sum(r.answer_count)       as answers,
           sum(r.mention_answers)    as mention_answers,
           sum(r.citation_answers)   as citation_answers,
           sum(r.sum_inv_position) / nullif(sum(r.position_count), 0) as position_factor,
           sum(r.total_mentions)     as total_mentions,
           sum(r.total_citations)    as total_citations,
           sum(r.positive_count)     as positive_count,
           sum(r.mentioning_answers) as mentioning_answers,
           sum(r.negative_count)     as negative_count,
           sum(r.sum_position)       as sum_position,
           sum(r.position_count)     as position_count,
           count(distinct r.prompt_id) filter (where r.has_mention or r.has_citation)
                                     as visible_prompts
    from prompt_rows r
    join same_prompts s using (prompt_id)
    group by r.win
  ),
  comp_rows as (
    select cd.*,
           case when cd.day between p_cur_from and p_cur_to then 'cur' else 'prev' end as win
    from public.insights_competitor_prompt_daily cd
    join same_prompts s using (prompt_id)
    where cd.brand_id = p_brand_id
      and (p_models is null or cd.model_used = any (p_models))
      and (p_region is null or cd.region = p_region)
      and (cd.day between p_cur_from and p_cur_to or cd.day between p_prev_from and p_prev_to)
  ),
  -- Competitors tracked in each window, from the dense day-grain table: the
  -- prompt-grain one only records sightings, so it can't tell a competitor
  -- never named from one not tracked yet. A competitor added during the
  -- period then has no previous value, as on all prompts, instead of a gain
  -- from 0.
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
           max(c.name)                           as name,
           coalesce(sum(cr.mention_answers), 0)  as mention_answers,
           coalesce(sum(cr.citation_answers), 0) as citation_answers,
           sum(cr.sum_inv_position) / nullif(sum(cr.position_count), 0) as position_factor
    from tracked t
    join public.competitors c
      on c.id::text = t.competitor_id and c.brand_id = p_brand_id
    left join comp_rows cr
      on cr.win = t.win and cr.competitor_id = t.competitor_id
    group by t.win, t.competitor_id
  ),
  -- Every competitor's mentions on the shared prompts, for share of voice
  -- (which counts all competitors, as share_of_voice_aggregates does).
  comp_mentions as (
    select win, sum(mention_count) as mentions from comp_rows group by win
  ),
  windows(win) as (values ('cur'), ('prev'))
  select jsonb_build_object(
    'complete', not exists (
                  select 1 from prompt_rows
                  where mention_answers is null or negative_count is null)
                and not exists (select 1 from comp_rows where mention_answers is null),
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
  );
$$;

create or replace function public.insights_same_prompt_compare(
  p_brand_id uuid,
  p_cur_from timestamptz,
  p_cur_to timestamptz,
  p_prev_from timestamptz,
  p_prev_to timestamptz,
  p_models text[] default null,
  p_region text default null,
  p_topic_id uuid default null
)
returns jsonb
language sql
stable
security invoker
set search_path to 'public'
as $$
  with filtered as (
    select pr.prompt_id, pr.created_at, pr.mention_count, pr.citation_count,
           pr.mention_position, pr.sentiment, pr.competitor_mentions
    from public.prompt_results pr
    where pr.brand_id = p_brand_id
      and pr.platform <> 'chatgpt-shopping'
      and (p_models is null or pr.model_used = any (p_models))
      and (p_region is null or pr.region = p_region)
      and pr.created_at >= p_prev_from
      and pr.created_at <= p_cur_to
      and (p_topic_id is null or exists (
             select 1 from public.prompts p
             where p.id = pr.prompt_id and p.topic_id = p_topic_id))
  ),
  windowed as (
    select 'cur' as win, f.* from filtered f
    where f.created_at >= p_cur_from and f.created_at <= p_cur_to
    union all
    select 'prev' as win, f.* from filtered f
    where f.created_at >= p_prev_from and f.created_at <= p_prev_to
  ),
  presence as (
    select prompt_id,
           bool_or(win = 'cur')  as in_cur,
           bool_or(win = 'prev') as in_prev
    from windowed
    group by prompt_id
  ),
  same_prompts as (
    select prompt_id from presence where in_cur and in_prev
  ),
  same_rows as (
    select w.* from windowed w join same_prompts s using (prompt_id)
  ),
  brand_agg as (
    select win,
           count(*)                                                   as answers,
           count(*) filter (where mention_count > 0)                  as mention_answers,
           count(*) filter (where citation_count > 0)                 as citation_answers,
           avg(1.0 / mention_position) filter (where mention_position is not null)
                                                                      as position_factor,
           coalesce(sum(mention_count), 0)                            as total_mentions,
           coalesce(sum(citation_count), 0)                           as total_citations,
           count(*) filter (where sentiment = 'positive')             as positive_count,
           count(*) filter (where mention_count > 0 or citation_count > 0)
                                                                      as mentioning_answers,
           count(*) filter (where sentiment = 'negative')             as negative_count,
           sum(mention_position) filter (where mention_position is not null)
                                                                      as sum_position,
           count(*) filter (where mention_position is not null)       as position_count,
           count(distinct prompt_id) filter (where mention_count > 0 or citation_count > 0)
                                                                      as visible_prompts
    from same_rows
    group by win
  ),
  comp_agg as (
    select r.win,
           cm.value->>'competitor_id' as competitor_id,
           max(c.name)                as name,
           count(*) filter (where coalesce((cm.value->>'mention_count')::int, 0) > 0)
                                      as mention_answers,
           count(*) filter (where coalesce((cm.value->>'citation_count')::int, 0) > 0)
                                      as citation_answers,
           avg(1.0 / (cm.value->>'mention_position')::numeric)
             filter (where (cm.value->>'mention_position') is not null)
                                      as position_factor
    from same_rows r
    cross join lateral jsonb_array_elements(coalesce(r.competitor_mentions, '[]'::jsonb)) cm
    join public.competitors c
      on c.id::text = cm.value->>'competitor_id' and c.brand_id = p_brand_id
    where cm.value ? 'competitor_id'
    group by r.win, cm.value->>'competitor_id'
  ),
  -- Every competitor's mentions on the shared prompts, for share of voice.
  comp_mentions as (
    select r.win, sum(coalesce((cm.value->>'mention_count')::int, 0)) as mentions
    from same_rows r
    cross join lateral jsonb_array_elements(coalesce(r.competitor_mentions, '[]'::jsonb)) cm
    where cm.value ? 'competitor_id'
    group by r.win
  ),
  windows(win) as (values ('cur'), ('prev'))
  select jsonb_build_object(
    'complete',        true,
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
  );
$$;

-- ─── Sparklines: one row of components per day ────────────────────────────
--
-- From the prompt-grain rollups, so a topic filter works too (a topic is a
-- set of prompts). Each day's values are that day's own, for the cards'
-- sparklines; the card values themselves come from the window aggregates.

create or replace function public.insights_kpi_series(
  p_brand_id uuid,
  p_day_from date default null,
  p_day_to date default null,
  p_models text[] default null,
  p_region text default null,
  p_topic_id uuid default null
)
returns jsonb
language sql
stable
security invoker
set search_path to 'public'
as $$
  with prompt_rows as (
    select d.*
    from public.insights_prompt_daily d
    where d.brand_id = p_brand_id
      and (p_models is null or d.model_used = any (p_models))
      and (p_region is null or d.region = p_region)
      and (p_day_from is null or d.day >= p_day_from)
      and (p_day_to is null or d.day <= p_day_to)
      and (p_topic_id is null or exists (
             select 1 from public.prompts p
             where p.id = d.prompt_id and p.topic_id = p_topic_id))
  ),
  comp_days as (
    select cd.day, sum(cd.mention_count) as competitor_mentions
    from public.insights_competitor_prompt_daily cd
    where cd.brand_id = p_brand_id
      and (p_models is null or cd.model_used = any (p_models))
      and (p_region is null or cd.region = p_region)
      and (p_day_from is null or cd.day >= p_day_from)
      and (p_day_to is null or cd.day <= p_day_to)
      and (p_topic_id is null or exists (
             select 1 from public.prompts p
             where p.id = cd.prompt_id and p.topic_id = p_topic_id))
    group by cd.day
  ),
  days as (
    select r.day,
           sum(r.answer_count)       as answers,
           sum(r.citation_answers)   as citation_answers,
           sum(r.total_mentions)     as total_mentions,
           sum(r.total_citations)    as total_citations,
           sum(r.positive_count)     as positive_count,
           sum(r.negative_count)     as negative_count,
           sum(r.mentioning_answers) as mentioning_answers,
           sum(r.sum_position)       as sum_position,
           sum(r.position_count)     as position_count,
           count(distinct r.prompt_id) filter (where r.has_mention or r.has_citation)
                                     as visible_prompts,
           count(distinct r.prompt_id) as active_prompts
    from prompt_rows r
    group by r.day
  )
  select jsonb_build_object(
    'complete', not exists (
                  select 1 from prompt_rows
                  where mention_answers is null or negative_count is null),
    'days', coalesce(
      (select jsonb_agg(jsonb_build_object(
                'day',                 d.day,
                'answers',             d.answers,
                'citation_answers',    d.citation_answers,
                'total_mentions',      d.total_mentions,
                'total_citations',     d.total_citations,
                'positive_count',      d.positive_count,
                'negative_count',      d.negative_count,
                'mentioning_answers',  d.mentioning_answers,
                'sum_position',        d.sum_position,
                'position_count',      d.position_count,
                'visible_prompts',     d.visible_prompts,
                'active_prompts',      d.active_prompts,
                'competitor_mentions', coalesce(c.competitor_mentions, 0))
              order by d.day)
       from days d
       left join comp_days c using (day)),
      '[]'::jsonb)
  );
$$;

revoke all on function public.insights_kpi_series(uuid, date, date, text[], text, uuid) from public;
grant execute on function public.insights_kpi_series(uuid, date, date, text[], text, uuid)
  to authenticated, service_role;

comment on function public.insights_kpi_series(uuid, date, date, text[], text, uuid) is
  'Insights KPI sparklines (VIS-003, 00131): the cards'' components per day from the prompt-grain rollups, topic filter included. complete=false until the rows are rewritten by refresh_insights_daily.';
