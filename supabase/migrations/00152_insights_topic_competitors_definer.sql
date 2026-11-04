-- "Topics vs competitors" timed out on the largest brand (#1044 review).
--
-- insights_topic_competitors_daily (00137) took 13.5 s for a signed-in
-- member of the largest brand over 30 days, against the authenticated
-- role's 8 s statement_timeout, and 1.3 s with the same body planned with
-- its real arguments. A SQL-language function is planned without its
-- argument values (PostgreSQL 17 and older), so the day range was a guess:
-- the competitor rows (212k) were joined to the topic prompts (611) in a
-- nested loop that discarded 129M rows. And the per-topic competitor
-- subquery rescanned every competitor row once per topic.
--
-- As insights_same_prompt_compare (00147) and insights_change_drivers
-- (00148) do, the function becomes plpgsql with force_custom_plan, so every
-- call is planned with its real arguments, and work_mem; and security
-- definer with the organization check made explicit, as citations_urls_daily
-- does (00119). Each topic's competitors are folded once, by topic and
-- competitor, and joined to its row. Output and counting rules are 00137's.

create or replace function public.insights_topic_competitors_daily(
  p_brand_id uuid,
  p_day_from date default null,
  p_day_to date default null,
  p_models text[] default null,
  p_region text default null
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

  with topic_prompts as (
    select p.id as prompt_id, t.id as topic_id
    from public.prompts p
    join public.prompt_sets ps on ps.id = p.prompt_set_id
    join public.topics t on t.id = p.topic_id
    where ps.brand_id = p_brand_id
      and t.is_active
  ),
  brand_rows as (
    select tp.topic_id, d.prompt_id, d.answer_count, d.mention_answers, d.citation_answers,
           d.sum_inv_position, d.position_count
    from public.insights_prompt_daily d
    join topic_prompts tp on tp.prompt_id = d.prompt_id
    where d.brand_id = p_brand_id
      and (p_day_from is null or d.day >= p_day_from)
      and (p_day_to is null or d.day <= p_day_to)
      and (p_models is null or d.model_used = any (p_models))
      and (p_region is null or d.region = p_region)
  ),
  competitor_rows as (
    select tp.topic_id, c.id as competitor_id, cpd.mention_answers, cpd.citation_answers,
           cpd.sum_inv_position, cpd.position_count
    from public.insights_competitor_prompt_daily cpd
    join topic_prompts tp on tp.prompt_id = cpd.prompt_id
    -- Live competitors only, like the leaderboard.
    join public.competitors c on c.id::text = cpd.competitor_id and c.brand_id = p_brand_id
    where cpd.brand_id = p_brand_id
      and (p_day_from is null or cpd.day >= p_day_from)
      and (p_day_to is null or cpd.day <= p_day_to)
      and (p_models is null or cpd.model_used = any (p_models))
      and (p_region is null or cpd.region = p_region)
  ),
  brand as (
    select topic_id,
           count(distinct prompt_id) as prompts,
           sum(answer_count)         as answers,
           sum(mention_answers)      as mention_answers,
           sum(citation_answers)     as citation_answers,
           sum(sum_inv_position)     as sum_inv_position,
           sum(position_count)       as position_count
    from brand_rows
    group by topic_id
  ),
  competitor as (
    select topic_id, competitor_id,
           sum(mention_answers)  as mention_answers,
           sum(citation_answers) as citation_answers,
           sum(sum_inv_position) as sum_inv_position,
           sum(position_count)   as position_count
    from competitor_rows
    group by topic_id, competitor_id
  ),
  -- Each topic's competitors, folded once and joined to its row below.
  competitor_lists as (
    select topic_id,
           jsonb_agg(jsonb_build_object(
             'competitor_id',    competitor_id,
             'mention_answers',  mention_answers,
             'citation_answers', citation_answers,
             'sum_inv_position', sum_inv_position,
             'position_count',   position_count)) as competitors
    from competitor
    group by topic_id
  )
  select jsonb_build_object(
    'complete', not exists (select 1 from brand_rows where mention_answers is null)
                and not exists (select 1 from competitor_rows where mention_answers is null),
    'topics', coalesce(
      (select jsonb_agg(jsonb_build_object(
                'topic_id',         b.topic_id,
                'name',             t.name,
                'prompts',          b.prompts,
                'answers',          b.answers,
                'mention_answers',  b.mention_answers,
                'citation_answers', b.citation_answers,
                'sum_inv_position', b.sum_inv_position,
                'position_count',   b.position_count,
                'competitors',      coalesce(cl.competitors, '[]'::jsonb)))
       from brand b
       join public.topics t on t.id = b.topic_id
       left join competitor_lists cl on cl.topic_id = b.topic_id),
      '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;

revoke execute on function public.insights_topic_competitors_daily(
  uuid, date, date, text[], text
) from public, anon;
grant execute on function public.insights_topic_competitors_daily(
  uuid, date, date, text[], text
) to authenticated, service_role;

comment on function public.insights_topic_competitors_daily(uuid, date, date, text[], text) is
  'Insights "Topics vs competitors" (VIS-010, 00137; planned with its arguments, security definer, 00152): per active topic, the brand''s Visibility components over the topic''s prompts and each live competitor''s components over the same answers, from the prompt-grain rollups. complete=false until they are backfilled (00130). Null when the caller is not a member of the brand''s organization.';
