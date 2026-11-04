-- Insights: compute the visibility trend's per-day inputs once.
--
-- visibility_rate_trend_daily builds each day's competitor list with a
-- correlated subselect over comp_daily and comp_visible. Those CTEs are
-- referenced once, so PostgreSQL inlined them into the subselect and
-- re-aggregated the competitor rollups for every day of the window: 6.3 s
-- for the largest brand's 30-day view (60 days with the previous period),
-- near the 8 s statement timeout. Marking them (and prompt_daily)
-- MATERIALIZED computes each once: 1.7 s, with byte-identical output.
-- work_mem is raised for their distinct counts, as for
-- competitor_aggregates_daily (00110).
--
-- If this function is recreated (CREATE OR REPLACE resets its settings and
-- body), keep the MATERIALIZED CTEs and `set work_mem`.

create or replace function public.visibility_rate_trend_daily(
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
set work_mem to '64MB'
as $$
  with brand_daily as (
    select d.day,
           sum(d.answer_count)     as answers,
           sum(d.mention_answers)  as mention_answers,
           sum(d.citation_answers) as citation_answers,
           sum(d.sum_inv_position) / nullif(sum(d.position_count), 0) as position_factor,
           sum(d.position_count)   as position_n
    from public.insights_brand_daily d
    where d.brand_id = p_brand_id
      and (p_platform is null or d.platform = p_platform)
      and (p_models is null or d.model_used = any (p_models))
      and (p_region is null or d.region = p_region)
      and (p_day_from is null or d.day >= p_day_from)
      and (p_day_to is null or d.day <= p_day_to)
    group by d.day
  ),
  prompt_daily as materialized (
    select d.day,
           count(distinct d.prompt_id) as prompt_count,
           count(distinct d.prompt_id)
             filter (where d.has_mention or d.has_citation) as visible_prompts
    from public.insights_prompt_daily d
    where d.brand_id = p_brand_id
      and (p_platform is null or d.platform = p_platform)
      and (p_models is null or d.model_used = any (p_models))
      and (p_region is null or d.region = p_region)
      and (p_day_from is null or d.day >= p_day_from)
      and (p_day_to is null or d.day <= p_day_to)
    group by d.day
  ),
  comp_daily as materialized (
    select cd.day, cd.competitor_id,
           sum(cd.mention_answers)  as mention_answers,
           sum(cd.citation_answers) as citation_answers,
           sum(cd.sum_inv_position) / nullif(sum(cd.position_count), 0) as position_factor,
           sum(cd.position_count)   as position_n
    from public.insights_competitor_daily cd
    join public.competitors c
      on c.id::text = cd.competitor_id and c.brand_id = p_brand_id
    where cd.brand_id = p_brand_id
      and (p_platform is null or cd.platform = p_platform)
      and (p_models is null or cd.model_used = any (p_models))
      and (p_region is null or cd.region = p_region)
      and (p_day_from is null or cd.day >= p_day_from)
      and (p_day_to is null or cd.day <= p_day_to)
    group by cd.day, cd.competitor_id
  ),
  comp_visible as materialized (
    select cpd.day, cpd.competitor_id,
           count(distinct cpd.prompt_id) as visible_prompts
    from public.insights_competitor_prompt_daily cpd
    join public.competitors c
      on c.id::text = cpd.competitor_id and c.brand_id = p_brand_id
    where cpd.brand_id = p_brand_id
      and (p_platform is null or cpd.platform = p_platform)
      and (p_models is null or cpd.model_used = any (p_models))
      and (p_region is null or cpd.region = p_region)
      and (p_day_from is null or cpd.day >= p_day_from)
      and (p_day_to is null or cpd.day <= p_day_to)
    group by cpd.day, cpd.competitor_id
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
