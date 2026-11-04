-- Insights summary line (VIS-006): which platform moved Visibility most.
--
-- The v2 mockup's summary line names the platform whose Visibility rose most
-- and the one that fell most ("Up most: Google AI Mode +16.1 · Down most:
-- ChatGPT −3.2"). That needs each platform's score components in both
-- comparison windows, and with "Compare: Same prompts" (00130) only over the
-- prompts answered in both, like every other change on the page.
--
-- These return one row per (model_used, platform, window) with the
-- Visibility components; the app folds model slugs into providers and scores
-- them with the card's formula. Same windows and filters as
-- insights_same_prompt_compare[_daily]: the rollups for whole days, the raw
-- rows for the 24h and topic views. `complete` is false while the
-- prompt-grain rollups behind the window are not backfilled (00130).

create or replace function public.insights_platform_compare_daily(
  p_brand_id uuid,
  p_cur_from date,
  p_cur_to date,
  p_prev_from date,
  p_prev_to date,
  p_models text[] default null,
  p_region text default null,
  p_same_prompts boolean default true
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
           sum(position_count)   as position_count
    from scoped
    group by model_used, platform, win
  )
  select jsonb_build_object(
    'complete', not exists (select 1 from prompt_rows where mention_answers is null),
    'platforms', coalesce(
      (select jsonb_agg(jsonb_build_object(
                'model_used',       p.model_used,
                'platform',         p.platform,
                'win',              p.win,
                'answers',          p.answers,
                'mention_answers',  p.mention_answers,
                'citation_answers', p.citation_answers,
                'sum_inv_position', p.sum_inv_position,
                'position_count',   p.position_count))
       from platforms p),
      '[]'::jsonb)
  );
$$;

create or replace function public.insights_platform_compare(
  p_brand_id uuid,
  p_cur_from timestamptz,
  p_cur_to timestamptz,
  p_prev_from timestamptz,
  p_prev_to timestamptz,
  p_models text[] default null,
  p_region text default null,
  p_topic_id uuid default null,
  p_same_prompts boolean default true
)
returns jsonb
language sql
stable
security invoker
set search_path to 'public'
as $$
  with filtered as (
    select pr.prompt_id, pr.model_used, pr.platform, pr.created_at,
           pr.mention_count, pr.citation_count, pr.mention_position
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
  -- Each window selected on its own, inclusive at both ends like the card.
  windowed as (
    select 'cur' as win, f.* from filtered f
    where f.created_at >= p_cur_from and f.created_at <= p_cur_to
    union all
    select 'prev' as win, f.* from filtered f
    where f.created_at >= p_prev_from and f.created_at <= p_prev_to
  ),
  shared as (
    select prompt_id
    from windowed
    group by prompt_id
    having bool_or(win = 'cur') and bool_or(win = 'prev')
  ),
  scoped as (
    select * from windowed
    where not p_same_prompts or prompt_id in (select prompt_id from shared)
  ),
  platforms as (
    select model_used, platform, win,
           count(*)                                         as answers,
           count(*) filter (where mention_count > 0)        as mention_answers,
           count(*) filter (where citation_count > 0)       as citation_answers,
           sum(1.0 / mention_position) filter (where mention_position is not null)
                                                            as sum_inv_position,
           count(*) filter (where mention_position is not null) as position_count
    from scoped
    group by model_used, platform, win
  )
  select jsonb_build_object(
    'complete', true,
    'platforms', coalesce(
      (select jsonb_agg(jsonb_build_object(
                'model_used',       p.model_used,
                'platform',         p.platform,
                'win',              p.win,
                'answers',          p.answers,
                'mention_answers',  p.mention_answers,
                'citation_answers', p.citation_answers,
                'sum_inv_position', p.sum_inv_position,
                'position_count',   p.position_count))
       from platforms p),
      '[]'::jsonb)
  );
$$;

revoke all on function public.insights_platform_compare_daily(
  uuid, date, date, date, date, text[], text, boolean
) from public;
grant execute on function public.insights_platform_compare_daily(
  uuid, date, date, date, date, text[], text, boolean
) to authenticated, service_role;

revoke all on function public.insights_platform_compare(
  uuid, timestamptz, timestamptz, timestamptz, timestamptz, text[], text, uuid, boolean
) from public;
grant execute on function public.insights_platform_compare(
  uuid, timestamptz, timestamptz, timestamptz, timestamptz, text[], text, uuid, boolean
) to authenticated, service_role;

comment on function public.insights_platform_compare_daily(
  uuid, date, date, date, date, text[], text, boolean
) is
  'Insights summary line (VIS-006, 00132): Visibility components per (model, platform) in both comparison windows, over the prompts answered in both when p_same_prompts, from the prompt-grain rollups. complete=false until they are backfilled (00130).';

comment on function public.insights_platform_compare(
  uuid, timestamptz, timestamptz, timestamptz, timestamptz, text[], text, uuid, boolean
) is
  'Insights summary line (VIS-006, 00132) for timestamp windows (24h, topic views), from prompt_results. Same output as insights_platform_compare_daily.';
