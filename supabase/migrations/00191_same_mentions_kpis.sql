-- ============================================================================
-- 00191: Insights and Mentions count mentions and net sentiment the same way
-- ============================================================================
-- The two pages showed different "Mentions" and "Net sentiment" for the same
-- days. The product decision (2026-10-20):
--
--   * Mentions are every time an answer names the brand (an answer naming it
--     three times counts three), as Insights counted them. The Mentions
--     page's Total mentions card, its trend and its platform table now read
--     occurrences; its RPC gains them per day and per platform
--     (`daily[].occurrences`, `platforms[].occurrences`).
--   * Net sentiment is (positive − negative) over the answers that name the
--     brand, as the Mentions page computed it. Insights divided by answers
--     that name OR cite it (#508); cited-only answers are always neutral, so
--     they pulled its net toward zero. The Insights aggregates (the daily
--     rollup read and the raw window read) gain the answers that name the
--     brand (`mention_results`) and the sparkline series gains them per day
--     (`days[].mention_answers`).
--
-- Each function is the latest definition (00164, 00131, 00157) with only
-- those fields added, and Mentions' platforms ordered by occurrences, the
-- column they show; existing fields are unchanged, so a web build from
-- before this migration keeps working.

create or replace function public.insights_aggregates_daily(
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
           d.citation_answers, d.negative_count, d.sum_position, d.position_count,
           d.mention_answers
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
           d.citation_answers, d.negative_count, d.sum_position, d.position_count,
           d.mention_answers
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
      -- Answers naming the brand: Net sentiment's base, as on the Mentions page.
      coalesce(sum(mention_answers), 0)    as mention_results,
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
    'mention_results',    t.mention_results,
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

-- The raw window read (00131's definition, still security invoker) gains the
-- same base: reports (no `days`), the 24h window and the Daily Pulse read it,
-- and without it they'd fall back to answers that name or cite the brand.
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
      COUNT(*) FILTER (WHERE mention_count > 0)               AS mention_results,
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
    'mention_results',     t.mention_results,
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
           sum(r.mention_answers)    as mention_answers,
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
                'mention_answers',     d.mention_answers,
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

create or replace function public.mentions_overview(
  p_brand_id  uuid,
  p_date_from timestamptz,
  p_date_to   timestamptz default null,
  p_platform  text default null,
  p_region    text default null,
  p_topic_id  uuid default null,
  p_search    text default null
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
  v_to        timestamptz := coalesce(p_date_to, now());
  v_from      timestamptz := least(p_date_from, coalesce(p_date_to, now()));
  v_span      interval;
  -- Whole days the window spans, at least one, with an hour of slack: a
  -- rolling 7 days ends at now(), a moment after the browser started it.
  v_days      integer;
  -- Under two days the answers are read directly.
  v_raw       boolean;
  v_day_to    date;
  v_day_from  date;
  v_prev_from date;
  v_search    text := nullif(btrim(lower(coalesce(p_search, ''))), '');
  v_result    jsonb;
begin
  if auth.role() is distinct from 'service_role' and not exists (
    select 1 from public.brands b
    join public.profiles pf on pf.organization_id = b.organization_id
    where b.id = p_brand_id and pf.id = auth.uid()
  ) then
    return null;
  end if;

  v_span      := v_to - v_from;
  v_days      := greatest(1, ceil(extract(epoch from v_span) / 86400.0 - 1.0 / 24)::integer);
  v_raw       := v_days < 2;
  v_day_to    := (v_to at time zone 'utc')::date;
  v_day_from  := v_day_to - (v_days - 1);
  v_prev_from := v_day_from - v_days;

  with
  prompts_in as (
    select p.id
    from public.prompts p
    join public.prompt_sets ps on ps.id = p.prompt_set_id
    where ps.brand_id = p_brand_id
      and (p_topic_id is null or p.topic_id = p_topic_id)
      and (v_search is null or position(v_search in lower(p.text)) > 0)
  ),
  facts as (
    select (d.day >= v_day_from)            as cur,
           d.day,
           d.prompt_id,
           d.platform,
           d.answer_count::bigint            as answers,
           d.mention_answers::bigint         as mentions,
           d.mention_occurrences             as occurrences,
           d.positive_answers::bigint        as positive,
           d.negative_answers::bigint        as negative,
           d.position_sum,
           d.position_count::bigint          as position_count,
           d.last_answer_at
    from public.mentions_prompt_daily d
    join prompts_in pi on pi.id = d.prompt_id
    where not v_raw
      and d.brand_id = p_brand_id
      and d.day between v_prev_from and v_day_to
      and (p_platform is null or d.platform = p_platform)
      and (p_region is null or d.region = p_region)
    union all
    select (pr.created_at >= v_from),
           (pr.created_at at time zone 'utc')::date,
           pr.prompt_id,
           pr.platform,
           1,
           (pr.mention_count > 0)::int,
           coalesce(pr.mention_count, 0),
           (pr.mention_count > 0 and pr.sentiment = 'positive')::int,
           (pr.mention_count > 0 and pr.sentiment = 'negative')::int,
           case when pr.mention_count > 0 then coalesce(pr.mention_position, 0) else 0 end,
           (pr.mention_count > 0 and pr.mention_position is not null)::int,
           pr.created_at
    from public.prompt_results pr
    join prompts_in pi on pi.id = pr.prompt_id
    where v_raw
      and pr.brand_id = p_brand_id
      and pr.platform <> 'chatgpt-shopping'
      and pr.created_at >= v_from - v_span
      and pr.created_at <= v_to
      and (p_platform is null or pr.platform = p_platform)
      and (p_region is null or pr.region = p_region)
  ),
  totals as (
    select cur,
           sum(answers)::bigint                                     as answers,
           sum(mentions)::bigint                                    as mentions,
           sum(occurrences)::bigint                                 as occurrences,
           sum(positive)::bigint                                    as positive,
           sum(negative)::bigint                                    as negative,
           sum(position_sum)::bigint                                as position_sum,
           sum(position_count)::bigint                              as position_count,
           count(distinct prompt_id)                                as prompts,
           count(distinct prompt_id) filter (where mentions > 0)    as prompts_with_mentions,
           max(last_answer_at)                                      as last_answer_at
    from facts
    group by cur
  ),
  platforms as (
    select platform,
           coalesce(sum(answers)  filter (where cur), 0)::bigint      as answers,
           coalesce(sum(mentions) filter (where cur), 0)::bigint      as mentions,
           coalesce(sum(occurrences) filter (where cur), 0)::bigint   as occurrences,
           coalesce(sum(positive) filter (where cur), 0)::bigint      as positive,
           coalesce(sum(negative) filter (where cur), 0)::bigint      as negative,
           coalesce(sum(answers)  filter (where not cur), 0)::bigint  as prev_answers,
           coalesce(sum(mentions) filter (where not cur), 0)::bigint  as prev_mentions,
           coalesce(sum(positive) filter (where not cur), 0)::bigint  as prev_positive,
           coalesce(sum(negative) filter (where not cur), 0)::bigint  as prev_negative
    from facts
    group by platform
  ),
  daily as (
    select day,
           sum(answers)::bigint     as answers,
           sum(mentions)::bigint    as mentions,
           sum(occurrences)::bigint as occurrences,
           sum(positive)::bigint    as positive,
           sum(negative)::bigint    as negative
    from facts
    where cur
    group by day
  ),
  comp_facts as (
    select (c.day >= v_day_from)              as cur,
           c.competitor_id,
           c.mention_answers::bigint           as mentions,
           c.co_mention_answers::bigint        as co_mentions
    from public.mentions_competitor_daily c
    join prompts_in pi on pi.id = c.prompt_id
    where not v_raw
      and c.brand_id = p_brand_id
      and c.day between v_prev_from and v_day_to
      and (p_platform is null or c.platform = p_platform)
      and (p_region is null or c.region = p_region)
    union all
    select (pr.created_at >= v_from),
           cm.value->>'competitor_id',
           1,
           (pr.mention_count > 0)::int
    from public.prompt_results pr
    join prompts_in pi on pi.id = pr.prompt_id
    cross join lateral jsonb_array_elements(coalesce(pr.competitor_mentions, '[]'::jsonb)) cm
    where v_raw
      and pr.brand_id = p_brand_id
      and pr.platform <> 'chatgpt-shopping'
      and pr.created_at >= v_from - v_span
      and pr.created_at <= v_to
      and (p_platform is null or pr.platform = p_platform)
      and (p_region is null or pr.region = p_region)
      and cm.value ? 'competitor_id'
      and coalesce((cm.value->>'mention_count')::int, 0) > 0
  ),
  competitors as (
    select co.id::text                                                 as competitor_id,
           co.name,
           coalesce(sum(f.mentions)    filter (where f.cur), 0)::bigint     as mentions,
           coalesce(sum(f.co_mentions) filter (where f.cur), 0)::bigint     as co_mentions,
           coalesce(sum(f.mentions)    filter (where not f.cur), 0)::bigint as prev_mentions
    from public.competitors co
    left join comp_facts f on f.competitor_id = co.id::text
    where co.brand_id = p_brand_id
    group by co.id, co.name
  )
  select jsonb_build_object(
    'window', jsonb_build_object(
      'from', v_from, 'to', v_to, 'days', v_days,
      'source', case when v_raw then 'answers' else 'days' end,
      'day_from', v_day_from, 'day_to', v_day_to),
    'current',     (select to_jsonb(t) - 'cur' from totals t where t.cur),
    'previous',    (select to_jsonb(t) - 'cur' from totals t where not t.cur),
    -- In the order of the column the table shows: occurrences, then responses.
    'platforms',   coalesce((select jsonb_agg(to_jsonb(p)
                                              order by p.occurrences desc, p.mentions desc, p.platform)
                             from platforms p), '[]'::jsonb),
    'daily',       coalesce((select jsonb_agg(to_jsonb(d) order by d.day) from daily d),
                            '[]'::jsonb),
    'competitors', coalesce((select jsonb_agg(to_jsonb(c) order by c.mentions desc, c.name)
                             from competitors c), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;

notify pgrst, 'reload schema';
