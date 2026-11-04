-- ============================================================================
-- 00195: the Mentions page takes its changes on the same prompts as Insights
-- ============================================================================
-- After 00191 both pages show the same mentions and net sentiment, but their
-- "vs the previous period" changes still differed: Insights compares only the
-- prompts answered in both windows (insights_same_prompt_compare_daily,
-- 00164), so adding or removing prompts doesn't read as a rise or a fall; the
-- Mentions page compared all of them.
--
-- mentions_overview (00191's definition) now also returns `same`: how many
-- prompts both windows answered, how many are new or dropped, and both
-- windows' totals over the shared ones; each platform row gains the same
-- counts on them (same_*, same_prev_*). The page takes every change from
-- these. Existing fields are unchanged, so either deploy order works; the
-- platforms keep 00191's order by occurrences.

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
  -- Prompts answered in both windows: every change is taken on them, as
  -- Insights takes its changes (insights_same_prompt_compare_daily, 00164),
  -- so adding or removing prompts doesn't read as a rise or a fall.
  presence as (
    select prompt_id,
           bool_or(cur and answers > 0)     as in_cur,
           bool_or(not cur and answers > 0) as in_prev
    from facts
    group by prompt_id
  ),
  flagged as (
    select f.*, (p.in_cur and p.in_prev) as shared
    from facts f
    join presence p using (prompt_id)
  ),
  same_totals as (
    select cur,
           sum(answers)::bigint                                     as answers,
           sum(mentions)::bigint                                    as mentions,
           sum(occurrences)::bigint                                 as occurrences,
           sum(positive)::bigint                                    as positive,
           sum(negative)::bigint                                    as negative,
           count(distinct prompt_id)                                as prompts,
           count(distinct prompt_id) filter (where mentions > 0)    as prompts_with_mentions
    from flagged
    where shared
    group by cur
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
           coalesce(sum(negative) filter (where not cur), 0)::bigint  as prev_negative,
           -- The same on the shared prompts, for the platform's change.
           coalesce(sum(answers)  filter (where cur and shared), 0)::bigint      as same_answers,
           coalesce(sum(mentions) filter (where cur and shared), 0)::bigint      as same_mentions,
           coalesce(sum(positive) filter (where cur and shared), 0)::bigint      as same_positive,
           coalesce(sum(negative) filter (where cur and shared), 0)::bigint      as same_negative,
           coalesce(sum(answers)  filter (where not cur and shared), 0)::bigint  as same_prev_answers,
           coalesce(sum(mentions) filter (where not cur and shared), 0)::bigint  as same_prev_mentions,
           coalesce(sum(positive) filter (where not cur and shared), 0)::bigint  as same_prev_positive,
           coalesce(sum(negative) filter (where not cur and shared), 0)::bigint  as same_prev_negative
    from flagged
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
    'same',        jsonb_build_object(
                     'prompts',         (select count(*) from presence where in_cur and in_prev),
                     'new_prompts',     (select count(*) from presence where in_cur and not in_prev),
                     'dropped_prompts', (select count(*) from presence where in_prev and not in_cur),
                     'current',  (select to_jsonb(t) - 'cur' from same_totals t where t.cur),
                     'previous', (select to_jsonb(t) - 'cur' from same_totals t where not t.cur)),
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
