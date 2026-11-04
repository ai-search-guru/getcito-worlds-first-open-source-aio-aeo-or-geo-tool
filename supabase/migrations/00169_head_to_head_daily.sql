-- Head-to-head on the Competitors page, from the daily rollups (#923).
--
-- getHeadToHeadComparison read the brand's raw prompt_results in one
-- request, which PostgREST caps at 1,000 rows, and summed them in the app:
-- a brand past 1,000 answers was compared on its newest 1,000 only, with no
-- sign of it. The largest brand has ~220k answers.
--
-- Every number the page shows is a sum the rollups already keep (00164):
--   * groups, one per (prompt, platform, model, region): runs and the
--     brand's visibility from insights_prompt_daily; the competitor's from
--     its sightings in insights_competitor_prompt_daily. An answer that is
--     not a sighting has the competitor at 0, which is what the page counted
--     for a group's runs without it.
--   * the averages per engine and overall: the brand's over every answer
--     (insights_brand_daily, answers with no prompt included), the
--     competitor's over the answers that list it (insights_competitor_daily
--     has one row per answer listing the competitor). The app folds engines
--     into display providers.
-- All time, as the page always read. The prompts' text comes along, once per
-- prompt, so the app needn't send hundreds of prompt ids back in a query
-- string. On the largest brand: 5,724 groups over 720 prompts, 1.1 s as a
-- member, every answer counted.
--
-- plpgsql with force_custom_plan, security definer with the organization
-- check made explicit, as the other Insights reads (00147): a caller
-- outside the brand's organization gets null.

create or replace function public.head_to_head_daily(
  p_brand_id uuid,
  p_competitor_id text
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
begin
  if auth.role() is distinct from 'service_role' and not exists (
    select 1 from public.brands b
    join public.profiles pf on pf.organization_id = b.organization_id
    where b.id = p_brand_id and pf.id = auth.uid()
  ) then
    return null;
  end if;

  with brand_groups as (
    select d.prompt_id, d.platform, d.model_used, d.region,
           sum(d.answer_count)   as runs,
           sum(d.sum_visibility) as brand_total,
           max(d.max_created_at) as latest_at
    from public.insights_prompt_daily d
    where d.brand_id = p_brand_id
    group by d.prompt_id, d.platform, d.model_used, d.region
  ),
  comp_groups as (
    select cd.prompt_id, cd.platform, cd.model_used, cd.region,
           sum(cd.sum_visibility) as comp_total
    from public.insights_competitor_prompt_daily cd
    where cd.brand_id = p_brand_id
      and cd.competitor_id = p_competitor_id
    group by cd.prompt_id, cd.platform, cd.model_used, cd.region
  ),
  brand_engines as (
    select d.platform, d.model_used,
           sum(d.answer_count)   as brand_count,
           sum(d.sum_visibility) as brand_total
    from public.insights_brand_daily d
    where d.brand_id = p_brand_id
    group by d.platform, d.model_used
  ),
  comp_engines as (
    select cd.platform, cd.model_used,
           sum(cd.answer_count)   as comp_count,
           sum(cd.sum_visibility) as comp_total
    from public.insights_competitor_daily cd
    where cd.brand_id = p_brand_id
      and cd.competitor_id = p_competitor_id
    group by cd.platform, cd.model_used
  )
  select jsonb_build_object(
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object(
               'prompt_id',       g.prompt_id,
               'platform',        g.platform,
               'model_used',      g.model_used,
               'region',          g.region,
               'runs',            g.runs,
               'brand_total',     coalesce(g.brand_total, 0),
               'comp_total',      coalesce(c.comp_total, 0),
               'latest_at',       g.latest_at))
      from brand_groups g
      left join comp_groups c
        on c.prompt_id = g.prompt_id
       and c.platform is not distinct from g.platform
       and c.model_used is not distinct from g.model_used
       and c.region is not distinct from g.region
    ), '[]'::jsonb),
    -- Each prompt's text once, rather than on each of its groups.
    'prompts', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'text', p.text, 'category', p.category))
      from public.prompts p
      where p.id in (select g.prompt_id from brand_groups g)
    ), '[]'::jsonb),
    'engines', coalesce((
      select jsonb_agg(jsonb_build_object(
               'platform',    e.platform,
               'model_used',  e.model_used,
               'brand_count', e.brand_count,
               'brand_total', coalesce(e.brand_total, 0),
               'comp_count',  coalesce(c.comp_count, 0),
               'comp_total',  coalesce(c.comp_total, 0)))
      from brand_engines e
      left join comp_engines c
        on c.platform is not distinct from e.platform
       and c.model_used is not distinct from e.model_used
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;

revoke execute on function public.head_to_head_daily(uuid, text) from public, anon;
grant execute on function public.head_to_head_daily(uuid, text) to authenticated, service_role;

notify pgrst, 'reload schema';
