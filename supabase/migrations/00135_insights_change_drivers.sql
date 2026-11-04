-- Insights "Why it changed" (VIS-009).
--
-- The v2 mockup explains the Visibility change beside the By AI platform
-- table: the platforms, topics and prompts that moved it most, each with its
-- own score before → after and its effect on the overall score, plus a line
-- for the prompts added this period ("509 new prompts · Sep 29 · own
-- baseline, not counted").
--
-- These return the Visibility components per prompt and per (model,
-- platform) in both comparison windows, over the prompts answered in both
-- when p_same_prompts (00130), with each prompt's text and topic; the app
-- folds engines into platforms and prompts into topics, and scores every
-- slice with the card's formula. They also count the prompts answered this
-- period but not the one before, and when the ones created this period were
-- added. The rollups serve whole days, so the box costs what the cards cost;
-- prompt_results serves the 24h and topic views, like
-- insights_platform_compare (00132).
-- `complete` is false while the prompt-grain rollups behind the window are
-- not backfilled (00130).

create or replace function public.insights_change_drivers_daily(
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
  presence as (
    select prompt_id,
           bool_or(win = 'cur')  as in_cur,
           bool_or(win = 'prev') as in_prev
    from prompt_rows
    group by prompt_id
  ),
  scoped as (
    select r.* from prompt_rows r join presence p using (prompt_id)
    where not p_same_prompts or (p.in_cur and p.in_prev)
  ),
  by_prompt as (
    select prompt_id, win,
           sum(answer_count)     as answers,
           sum(mention_answers)  as mention_answers,
           sum(citation_answers) as citation_answers,
           sum(sum_inv_position) as sum_inv_position,
           sum(position_count)   as position_count
    from scoped
    group by prompt_id, win
  ),
  by_engine as (
    select model_used, platform, win,
           sum(answer_count)     as answers,
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
    'complete', not exists (select 1 from prompt_rows where mention_answers is null),
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
  );
$$;

create or replace function public.insights_change_drivers(
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
  presence as (
    select prompt_id,
           bool_or(win = 'cur')  as in_cur,
           bool_or(win = 'prev') as in_prev
    from windowed
    group by prompt_id
  ),
  scoped as (
    select w.* from windowed w join presence p using (prompt_id)
    where not p_same_prompts or (p.in_cur and p.in_prev)
  ),
  by_prompt as (
    select prompt_id, win,
           count(*)                                    as answers,
           count(*) filter (where mention_count > 0)   as mention_answers,
           count(*) filter (where citation_count > 0)  as citation_answers,
           sum(1.0 / mention_position) filter (where mention_position is not null)
                                                       as sum_inv_position,
           count(*) filter (where mention_position is not null) as position_count
    from scoped
    group by prompt_id, win
  ),
  by_engine as (
    select model_used, platform, win,
           count(*)                                    as answers,
           count(*) filter (where mention_count > 0)   as mention_answers,
           count(*) filter (where citation_count > 0)  as citation_answers,
           sum(1.0 / mention_position) filter (where mention_position is not null)
                                                       as sum_inv_position,
           count(*) filter (where mention_position is not null) as position_count
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
    'complete', true,
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
                      'first_added', min(created_at) filter (where created_at >= p_cur_from),
                      'last_added',  max(created_at) filter (where created_at >= p_cur_from))
                    from added)
  );
$$;

revoke all on function public.insights_change_drivers_daily(
  uuid, date, date, date, date, text[], text, boolean
) from public;
grant execute on function public.insights_change_drivers_daily(
  uuid, date, date, date, date, text[], text, boolean
) to authenticated, service_role;

revoke all on function public.insights_change_drivers(
  uuid, timestamptz, timestamptz, timestamptz, timestamptz, text[], text, uuid, boolean
) from public;
grant execute on function public.insights_change_drivers(
  uuid, timestamptz, timestamptz, timestamptz, timestamptz, text[], text, uuid, boolean
) to authenticated, service_role;

comment on function public.insights_change_drivers_daily(
  uuid, date, date, date, date, text[], text, boolean
) is
  'Insights "Why it changed" (VIS-009, 00135): Visibility components per prompt and per (model, platform) in both comparison windows, over the prompts answered in both when p_same_prompts, with prompt text and topic, and the prompts new this period, from the prompt-grain rollups. complete=false until they are backfilled (00130).';

comment on function public.insights_change_drivers(
  uuid, timestamptz, timestamptz, timestamptz, timestamptz, text[], text, uuid, boolean
) is
  'Insights "Why it changed" (VIS-009, 00135) for timestamp windows (24h, topic views), from prompt_results. Same output as insights_change_drivers_daily.';
