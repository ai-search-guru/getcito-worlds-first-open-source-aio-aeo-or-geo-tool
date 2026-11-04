-- ============================================================================
-- 00423: Why did it move — the counts explain_change reads
-- ============================================================================
-- Why did it move (CHAT-22 §1, explain_change) compares a metric between two
-- periods prompt × engine by prompt × engine, from scheduled tracking only
-- (Addendum 2 G). chat_why_cells sums the Insights rollups for it in one
-- call, so the web never pages through day rows (max_rows 1000):
--
--   * cells: per prompt, platform, model and location, and period (a or b):
--     the tracked day rows (runs) and those where the brand was named or
--     cited (visible_runs); answers, those naming the brand and those citing
--     its pages; its mentions and its tracked competitors' (share of voice as
--     Insights counts it: total_mentions against the competitors'
--     mention_count); the positions where it was named (sum, sum of 1/position
--     for the Visibility score's position factor, and count); and the newest
--     answer.
--   * daily: the same sums per day from p_series_from to p_b_to, with the
--     prompts named or cited and those tracked (visibility as Insights counts
--     it), for the change point (§1 item 5.2).
--   * complete: false while a row read predates 00130/00131's columns (its
--     sums count as 0 until the daily refresh rewrites its day), as
--     insights_kpi_series says it.
--
-- From insights_prompt_daily and insights_competitor_prompt_daily, on their
-- (brand_id, day) index, each with its own day ranges; the competitors' sums
-- are grouped on their own before they meet the brand's, so no join repeats a
-- row. Server only, behind CHAT_AGENTIC: the web checks the brand is the
-- caller's workspace's first (as the MCP data functions do), then calls it as
-- the service role. Periods and the series are 92 days at most, a before b,
-- so one call stays small. plpgsql for those checks; it reads only.

create or replace function public.chat_why_cells(
  p_brand_id uuid,
  p_a_from date,
  p_a_to date,
  p_b_from date,
  p_b_to date,
  p_series_from date,
  p_models text[] default null,
  p_region text default null,
  p_topic_id uuid default null
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if p_brand_id is null or p_a_from is null or p_a_to is null or p_b_from is null
     or p_b_to is null or p_series_from is null then
    raise exception 'chat_why_cells: the brand and every date are needed' using errcode = '22023';
  end if;
  if p_a_from > p_a_to or p_b_from > p_b_to then
    raise exception 'chat_why_cells: a period ends before it starts' using errcode = '22023';
  end if;
  if p_a_to >= p_b_from then
    raise exception 'chat_why_cells: period a ends before period b starts' using errcode = '22023';
  end if;
  if p_series_from > p_b_to then
    raise exception 'chat_why_cells: the series starts after period b ends' using errcode = '22023';
  end if;
  if p_a_to - p_a_from > 92 or p_b_to - p_b_from > 92 or p_b_to - p_series_from > 92 then
    raise exception 'chat_why_cells: a period or the series is over 92 days' using errcode = '22023';
  end if;

  with brand_rows as (
    select d.day, d.prompt_id, d.platform, d.model_used, d.region,
           case
             when d.day between p_a_from and p_a_to then 'a'
             when d.day between p_b_from and p_b_to then 'b'
           end as period,
           d.answer_count, d.has_mention, d.has_citation,
           coalesce(d.mention_answers, 0) as mention_answers,
           coalesce(d.citation_answers, 0) as citation_answers,
           coalesce(d.total_mentions, 0) as total_mentions,
           coalesce(d.sum_position, 0) as sum_position,
           coalesce(d.sum_inv_position, 0) as sum_inv_position,
           coalesce(d.position_count, 0) as position_count,
           d.max_created_at,
           -- A row the daily refresh hasn't rewritten since 00130/00131.
           (d.mention_answers is null or d.negative_count is null) as stale
    from public.insights_prompt_daily d
    where d.brand_id = p_brand_id
      -- One range on the (brand_id, day) index; the periods narrow it below.
      and d.day between least(p_a_from, p_series_from) and p_b_to
      and (d.day between p_a_from and p_a_to
           or d.day between p_b_from and p_b_to
           or d.day between p_series_from and p_b_to)
      and (p_models is null or d.model_used = any (p_models))
      and (p_region is null or d.region = p_region)
      and (p_topic_id is null
           or d.prompt_id in (select p.id from public.prompts p where p.topic_id = p_topic_id))
  ),
  competitor_rows as (
    select c.day, c.prompt_id, c.platform, c.model_used, c.region,
           case
             when c.day between p_a_from and p_a_to then 'a'
             when c.day between p_b_from and p_b_to then 'b'
           end as period,
           c.mention_count
    from public.insights_competitor_prompt_daily c
    where c.brand_id = p_brand_id
      -- One range on the (brand_id, day) index; the periods narrow it below.
      and c.day between least(p_a_from, p_series_from) and p_b_to
      and (c.day between p_a_from and p_a_to
           or c.day between p_b_from and p_b_to
           or c.day between p_series_from and p_b_to)
      and (p_models is null or c.model_used = any (p_models))
      and (p_region is null or c.region = p_region)
      and (p_topic_id is null
           or c.prompt_id in (select p.id from public.prompts p where p.topic_id = p_topic_id))
  ),
  brand_cells as (
    select r.prompt_id, r.platform, r.model_used, r.region, r.period,
           count(*)::integer as runs,
           (count(*) filter (where r.has_mention or r.has_citation))::integer as visible_runs,
           sum(r.answer_count)::integer as answers,
           sum(r.mention_answers)::integer as mention_answers,
           sum(r.citation_answers)::integer as citation_answers,
           sum(r.total_mentions)::integer as brand_mentions,
           sum(r.sum_position) as sum_position,
           sum(r.sum_inv_position) as sum_inv_position,
           sum(r.position_count)::integer as position_count,
           max(r.max_created_at) as last_at
    from brand_rows r
    where r.period is not null
    group by r.prompt_id, r.platform, r.model_used, r.region, r.period
  ),
  competitor_cells as (
    select r.prompt_id, r.platform, r.model_used, r.region, r.period,
           sum(r.mention_count)::integer as competitor_mentions
    from competitor_rows r
    where r.period is not null
    group by r.prompt_id, r.platform, r.model_used, r.region, r.period
  ),
  brand_daily as (
    select r.day,
           count(*)::integer as runs,
           (count(*) filter (where r.has_mention or r.has_citation))::integer as visible_runs,
           sum(r.answer_count)::integer as answers,
           sum(r.mention_answers)::integer as mention_answers,
           sum(r.citation_answers)::integer as citation_answers,
           sum(r.total_mentions)::integer as brand_mentions,
           sum(r.sum_position) as sum_position,
           sum(r.sum_inv_position) as sum_inv_position,
           sum(r.position_count)::integer as position_count,
           -- Visibility as Insights counts it: prompts named or cited, of those tracked.
           (count(distinct r.prompt_id) filter (where r.has_mention or r.has_citation))::integer
             as visible_prompts,
           count(distinct r.prompt_id)::integer as active_prompts
    from brand_rows r
    where r.day between p_series_from and p_b_to
    group by r.day
  ),
  competitor_daily as (
    select r.day, sum(r.mention_count)::integer as competitor_mentions
    from competitor_rows r
    where r.day between p_series_from and p_b_to
    group by r.day
  )
  select jsonb_build_object(
    -- As insights_kpi_series: false while a row read predates 00130/00131's columns.
    'complete', not exists (select 1 from brand_rows r where r.stale),
    'cells', coalesce((
      select jsonb_agg(jsonb_build_object(
        'prompt_id', b.prompt_id,
        'platform', b.platform,
        'model_used', b.model_used,
        'region', b.region,
        'period', b.period,
        'runs', b.runs,
        'visible_runs', b.visible_runs,
        'answers', b.answers,
        'mention_answers', b.mention_answers,
        'citation_answers', b.citation_answers,
        'brand_mentions', b.brand_mentions,
        'sum_position', b.sum_position,
        'sum_inv_position', b.sum_inv_position,
        'position_count', b.position_count,
        'competitor_mentions', coalesce(c.competitor_mentions, 0),
        'last_at', b.last_at
      ) order by b.prompt_id, b.platform, b.model_used, b.region, b.period)
      from brand_cells b
      left join competitor_cells c
        on c.prompt_id = b.prompt_id
       and c.platform is not distinct from b.platform
       and c.model_used is not distinct from b.model_used
       and c.region is not distinct from b.region
       and c.period = b.period
    ), '[]'::jsonb),
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object(
        'day', b.day,
        'runs', b.runs,
        'visible_runs', b.visible_runs,
        'answers', b.answers,
        'mention_answers', b.mention_answers,
        'citation_answers', b.citation_answers,
        'brand_mentions', b.brand_mentions,
        'sum_position', b.sum_position,
        'sum_inv_position', b.sum_inv_position,
        'position_count', b.position_count,
        'visible_prompts', b.visible_prompts,
        'active_prompts', b.active_prompts,
        'competitor_mentions', coalesce(c.competitor_mentions, 0)
      ) order by b.day)
      from brand_daily b
      left join competitor_daily c on c.day = b.day
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;

comment on function public.chat_why_cells(uuid, date, date, date, date, date, text[], text, uuid) is
  'Why did it move (CHAT-22 §1, 00423): the Insights rollups summed per prompt × engine × location × period (a, b) and per day from p_series_from, for explain_change. Periods and the series are 92 days at most. Server only: the web checks the brand is the caller''s first.';

revoke all on function public.chat_why_cells(uuid, date, date, date, date, date, text[], text, uuid)
  from public, anon, authenticated;
grant execute on function public.chat_why_cells(uuid, date, date, date, date, date, text[], text, uuid)
  to service_role;

notify pgrst, 'reload schema';
