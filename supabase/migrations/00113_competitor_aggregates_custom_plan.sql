-- Competitors / Insights: plan competitor_aggregates_daily with its arguments.
--
-- As a `language sql` function its body was planned with the arguments as
-- opaque parameters, so the planner never saw the brand or the window: it
-- estimated ~2.5k competitor-prompt rows where the largest brand's 30-day
-- window has ~240k, and picked plans for the small case. Measured as the page
-- runs it: 4.4 s, against 0.66 s for the same query with the values inlined.
--
-- Same cure as the citation reads (00070, 00077): plpgsql, which plans through
-- the SPI cache with the argument values in hand, and plan_cache_mode =
-- force_custom_plan so it never settles on a generic plan. The body is the
-- 00066 query unchanged, returned as one expression; work_mem stays at the
-- 64 MB from 00110. Verified md5-identical output before and after on four
-- argument sets (all-time, 30-day, 7-day with platform, 7-day with model and
-- region).
--
-- If this function is recreated, keep it plpgsql with these settings.

create or replace function public.competitor_aggregates_daily(
  p_brand_id uuid,
  p_platform text default null,
  p_models text[] default null,
  p_region text default null,
  p_day_from date default null,
  p_day_to date default null
) returns jsonb
language plpgsql
stable
set search_path to 'public'
set work_mem to '64MB'
set plan_cache_mode to 'force_custom_plan'
as $$
begin
  return (
    with brand_days as (
      select * from public.insights_brand_daily d
      where d.brand_id = p_brand_id
        and (p_platform is null or d.platform = p_platform)
        and (p_models is null or d.model_used = any (p_models))
        and (p_region is null or d.region = p_region)
        and (p_day_from is null or d.day >= p_day_from)
        and (p_day_to is null or d.day <= p_day_to)
    ),
    prompt_days as (
      select * from public.insights_prompt_daily d
      where d.brand_id = p_brand_id
        and (p_platform is null or d.platform = p_platform)
        and (p_models is null or d.model_used = any (p_models))
        and (p_region is null or d.region = p_region)
        and (p_day_from is null or d.day >= p_day_from)
        and (p_day_to is null or d.day <= p_day_to)
    ),
    comp_days as (
      select cd.* from public.insights_competitor_daily cd
      join public.competitors c
        on c.id::text = cd.competitor_id and c.brand_id = p_brand_id
      where cd.brand_id = p_brand_id
        and (p_platform is null or cd.platform = p_platform)
        and (p_models is null or cd.model_used = any (p_models))
        and (p_region is null or cd.region = p_region)
        and (p_day_from is null or cd.day >= p_day_from)
        and (p_day_to is null or cd.day <= p_day_to)
    ),
    comp_prompt_days as (
      select cpd.* from public.insights_competitor_prompt_daily cpd
      join public.competitors c
        on c.id::text = cpd.competitor_id and c.brand_id = p_brand_id
      where cpd.brand_id = p_brand_id
        and (p_platform is null or cpd.platform = p_platform)
        and (p_models is null or cpd.model_used = any (p_models))
        and (p_region is null or cpd.region = p_region)
        and (p_day_from is null or cpd.day >= p_day_from)
        and (p_day_to is null or cpd.day <= p_day_to)
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
    -- Grouped once each, then joined — a correlated subselect here rescans
    -- comp_prompt_days per output group (13 + ~119 of them), which measured
    -- 1.6s on the largest brand's all-time window against ~100ms this way.
    visible_by_comp as (
      select competitor_id, count(distinct prompt_id) as visible_prompts
      from comp_prompt_days group by competitor_id
    ),
    visible_by_comp_engine as (
      select competitor_id, model_used, platform,
             count(distinct prompt_id) as visible_prompts
      from comp_prompt_days group by competitor_id, model_used, platform
    ),
    by_competitor as (
      select
        cd.competitor_id,
        max(c.name)               as name,
        sum(cd.sum_visibility)    as sum_visibility,
        sum(cd.answer_count)      as row_count,
        coalesce(sum(cd.total_mentions), 0)::bigint  as total_mentions,
        coalesce(sum(cd.total_citations), 0)::bigint as total_citations,
        coalesce(max(v.visible_prompts), 0)          as visible_prompts
      from comp_days cd
      join public.competitors c
        on c.id::text = cd.competitor_id and c.brand_id = p_brand_id
      left join visible_by_comp v on v.competitor_id = cd.competitor_id
      group by cd.competitor_id
    ),
    by_competitor_provider as (
      select
        cd.model_used, cd.platform, cd.competitor_id,
        max(c.name)                         as competitor_name,
        sum(cd.sum_visibility)              as sum_visibility,
        sum(cd.answer_count)                as row_count,
        coalesce(max(v.visible_prompts), 0) as visible_prompts
      from comp_days cd
      join public.competitors c
        on c.id::text = cd.competitor_id and c.brand_id = p_brand_id
      left join visible_by_comp_engine v
        on v.competitor_id = cd.competitor_id
       and v.model_used is not distinct from cd.model_used
       and v.platform is not distinct from cd.platform
      group by cd.model_used, cd.platform, cd.competitor_id
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
