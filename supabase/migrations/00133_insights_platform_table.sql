-- Insights "By AI platform" table (VIS-008).
--
-- The v2 mockup replaces the Share of Voice donut and trend with one table:
-- per platform, Visibility, its change, Coverage, Share of voice and Avg.
-- position, with "Low sample" / "No runs this period" in place of numbers
-- a platform can't support.
--
-- insights_platform_compare[_daily] (00132) already return each platform's
-- Visibility components in both windows; this adds what Coverage and Avg.
-- position need: the position sum (00131) and, for the current window, the
-- prompts answered on each engine and the ones where the brand appeared.
-- They are prompt ids, not counts, because the app folds engines into
-- platforms (ChatGPT is several models and a scraper): a prompt answered
-- by two of them must still count once.
--
-- The window bounds now default to null, read as open, and a missing
-- previous window reads the current one alone: the table also shows on All
-- time, which has nothing to compare with. Same argument order, so the
-- summary line keeps reading them unchanged. `complete` now also waits for
-- the 00131 backfill, which the position sum depends on.

create or replace function public.insights_platform_compare_daily(
  p_brand_id uuid,
  p_cur_from date default null,
  p_cur_to date default null,
  p_prev_from date default null,
  p_prev_to date default null,
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
           case when d.day between coalesce(p_cur_from, '-infinity'::date)
                               and coalesce(p_cur_to, 'infinity'::date)
                then 'cur' else 'prev' end as win
    from public.insights_prompt_daily d
    where d.brand_id = p_brand_id
      and (p_models is null or d.model_used = any (p_models))
      and (p_region is null or d.region = p_region)
      and (d.day between coalesce(p_cur_from, '-infinity'::date)
                     and coalesce(p_cur_to, 'infinity'::date)
           or d.day between p_prev_from and p_prev_to)
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
           sum(position_count)   as position_count,
           sum(sum_position)     as sum_position,
           case when win = 'cur' then
             coalesce(array_agg(distinct prompt_id) filter (where has_mention or has_citation),
                      '{}')
           end                   as visible_prompt_ids,
           case when win = 'cur' then array_agg(distinct prompt_id) end
                                 as active_prompt_ids
    from scoped
    group by model_used, platform, win
  )
  select jsonb_build_object(
    'complete', not exists (
                  select 1 from prompt_rows
                  where mention_answers is null or negative_count is null),
    'platforms', coalesce(
      (select jsonb_agg(jsonb_build_object(
                'model_used',         p.model_used,
                'platform',           p.platform,
                'win',                p.win,
                'answers',            p.answers,
                'mention_answers',    p.mention_answers,
                'citation_answers',   p.citation_answers,
                'sum_inv_position',   p.sum_inv_position,
                'position_count',     p.position_count,
                'sum_position',       p.sum_position,
                'visible_prompt_ids', p.visible_prompt_ids,
                'active_prompt_ids',  p.active_prompt_ids))
       from platforms p),
      '[]'::jsonb)
  );
$$;

create or replace function public.insights_platform_compare(
  p_brand_id uuid,
  p_cur_from timestamptz default null,
  p_cur_to timestamptz default null,
  p_prev_from timestamptz default null,
  p_prev_to timestamptz default null,
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
      and pr.created_at >= coalesce(p_prev_from, p_cur_from, '-infinity'::timestamptz)
      and pr.created_at <= coalesce(p_cur_to, 'infinity'::timestamptz)
      and (p_topic_id is null or exists (
             select 1 from public.prompts p
             where p.id = pr.prompt_id and p.topic_id = p_topic_id))
  ),
  -- Each window selected on its own, inclusive at both ends like the card.
  windowed as (
    select 'cur' as win, f.* from filtered f
    where f.created_at >= coalesce(p_cur_from, '-infinity'::timestamptz)
      and f.created_at <= coalesce(p_cur_to, 'infinity'::timestamptz)
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
           count(*) filter (where mention_position is not null) as position_count,
           sum(mention_position) filter (where mention_position is not null)
                                                            as sum_position,
           case when win = 'cur' then
             coalesce(array_agg(distinct prompt_id)
                        filter (where mention_count > 0 or citation_count > 0),
                      '{}')
           end                                              as visible_prompt_ids,
           case when win = 'cur' then array_agg(distinct prompt_id) end
                                                            as active_prompt_ids
    from scoped
    group by model_used, platform, win
  )
  select jsonb_build_object(
    'complete', true,
    'platforms', coalesce(
      (select jsonb_agg(jsonb_build_object(
                'model_used',         p.model_used,
                'platform',           p.platform,
                'win',                p.win,
                'answers',            p.answers,
                'mention_answers',    p.mention_answers,
                'citation_answers',   p.citation_answers,
                'sum_inv_position',   p.sum_inv_position,
                'position_count',     p.position_count,
                'sum_position',       p.sum_position,
                'visible_prompt_ids', p.visible_prompt_ids,
                'active_prompt_ids',  p.active_prompt_ids))
       from platforms p),
      '[]'::jsonb)
  );
$$;
