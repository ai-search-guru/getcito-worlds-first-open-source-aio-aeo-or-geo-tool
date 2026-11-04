-- Insights "Topics vs competitors" (VIS-010).
--
-- The v2 mockup's heat map has a row per topic and a column for you and each
-- competitor on the trend, each cell the Visibility score in that topic. The
-- score is the card's formula with the brand's answers as the shared
-- denominator (as the leaderboard scores competitors), so this returns, per
-- active topic, the brand's components over the topic's prompts and each
-- live competitor's components over the same answers. The app scores them
-- and picks the columns.
--
-- Prompts take their history to the topic they're in now (topic is read at
-- query time, like the other topic reads). Whole UTC days only, from the
-- prompt-grain rollups (00130): the heat map isn't shown on the 24h view.
-- `complete` is false while those rollups aren't backfilled.

create or replace function public.insights_topic_competitors_daily(
  p_brand_id uuid,
  p_day_from date default null,
  p_day_to date default null,
  p_models text[] default null,
  p_region text default null
)
returns jsonb
language sql
stable
security invoker
set search_path to 'public'
as $$
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
                'competitors', coalesce(
                  (select jsonb_agg(jsonb_build_object(
                            'competitor_id',    c.competitor_id,
                            'mention_answers',  c.mention_answers,
                            'citation_answers', c.citation_answers,
                            'sum_inv_position', c.sum_inv_position,
                            'position_count',   c.position_count))
                   from competitor c
                   where c.topic_id = b.topic_id),
                  '[]'::jsonb)))
       from brand b
       join public.topics t on t.id = b.topic_id),
      '[]'::jsonb)
  );
$$;

revoke all on function public.insights_topic_competitors_daily(
  uuid, date, date, text[], text
) from public;
grant execute on function public.insights_topic_competitors_daily(
  uuid, date, date, text[], text
) to authenticated, service_role;

comment on function public.insights_topic_competitors_daily(uuid, date, date, text[], text) is
  'Insights "Topics vs competitors" (VIS-010, 00137): per active topic, the brand''s Visibility components over the topic''s prompts and each live competitor''s components over the same answers, from the prompt-grain rollups. complete=false until they are backfilled (00130).';
