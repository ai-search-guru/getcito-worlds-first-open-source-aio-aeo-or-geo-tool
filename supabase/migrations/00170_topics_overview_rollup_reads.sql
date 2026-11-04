-- The Topics overview's longer windows read the rollups alone (#1000).
--
-- topics_overview_window (00156) read a window of two days or more from the
-- prompt-grain rollups, but two things kept it slow when cold:
--
--   * It joined insights_prompt_daily and insights_competitor_prompt_daily
--     to the brand's prompts first. Since 00164 added (brand_id, prompt_id,
--     day), the planner walks that index once per prompt and fetches every
--     row's page on its own: 199k buffers for 180 days of the largest brand
--     (720 prompts), against 55k read by (brand_id, day), where a day's rows
--     sit together. Cold, the 90-day view took 23 s and the 30-day one 7 s,
--     against the authenticated role's 8 s statement timeout. Each table is
--     now read by brand and days first (materialized) and only then joined
--     to the topics' prompts.
--   * Each topic's last answer time came from prompt_results. It is now the
--     rollups' max_created_at (00164), over the window's whole days, as the
--     row's other figures are.
--
-- So a window of two days or more reads no prompt_results. The 24-hour view
-- still reads the answers, as 00156 explains. Output is 00156's otherwise:
-- on production, both brands checked returned the same rows for 7, 30 and
-- 90 days, last run times included, in 1.1 s instead of 5.3 s for the
-- largest brand's 30 days and 0.14 s instead of 2.7 s for another's 90.

create or replace function public.topics_overview_window(
  p_brand_id  uuid,
  p_date_from timestamptz,
  p_date_to   timestamptz default null
)
returns table (
  topic_id              uuid,
  answers               bigint,
  mention_answers       bigint,
  citation_answers      bigint,
  pos_sum               double precision,
  pos_n                 bigint,
  prev_answers          bigint,
  prev_mention_answers  bigint,
  prev_citation_answers bigint,
  prev_pos_sum          double precision,
  prev_pos_n            bigint,
  total_mentions        bigint,
  total_citations       bigint,
  comp_mentions         bigint,
  active_prompts        bigint,
  visible_prompts       bigint,
  last_run_at           timestamptz,
  competitors           jsonb,
  daily                 jsonb
)
language plpgsql
stable
security definer
set search_path to 'public'
set work_mem to '64MB'
set plan_cache_mode to 'force_custom_plan'
as $$
#variable_conflict use_column
declare
  v_to        timestamptz := coalesce(p_date_to, now());
  v_from      timestamptz := least(p_date_from, coalesce(p_date_to, now()));
  -- Whole days the window spans, at least one, with an hour of slack: a
  -- rolling 7 days starts where the browser put it and ends at now(), a
  -- moment later, which must not make it 8 (lib/topicTrend.ts counts alike).
  v_days      integer;
  -- The rollup days of a longer window, and of the window before it.
  v_day_to    date;
  v_day_from  date;
  v_prev_from date;
begin
  if auth.role() is distinct from 'service_role' and not exists (
    select 1 from public.brands b
    join public.profiles pf on pf.organization_id = b.organization_id
    where b.id = p_brand_id and pf.id = auth.uid()
  ) then
    return;
  end if;

  v_days := greatest(1, ceil(extract(epoch from (v_to - v_from)) / 86400.0 - 1.0 / 24)::integer);

  if v_days < 2 then
    return query
    with
    rows as (
      select p.topic_id,
             pr.prompt_id,
             pr.created_at,
             pr.competitor_mentions,
             (pr.created_at >= v_from)                        as in_window,
             coalesce(pr.mention_count, 0)                    as mentions,
             coalesce(pr.citation_count, 0)                   as citations,
             pr.mention_position,
             (coalesce(pr.mention_count, 0) > 0
               or coalesce(pr.citation_count, 0) > 0)         as visible
      from public.prompt_results pr
      join public.prompts p      on p.id = pr.prompt_id
      join public.prompt_sets ps on ps.id = p.prompt_set_id
      where pr.brand_id = p_brand_id
        and ps.brand_id = p_brand_id
        and p.topic_id is not null
        and pr.platform <> 'chatgpt-shopping'
        and pr.created_at >= v_from - (v_to - v_from)
        and pr.created_at <= v_to
    ),
    comps as (
      select r.topic_id,
             cm.value->>'competitor_id'                              as competitor_id,
             min(c.name)                                             as name,
             sum(coalesce((cm.value->>'mention_count')::int, 0))::bigint as mentions
      from rows r
      cross join lateral jsonb_array_elements(coalesce(r.competitor_mentions, '[]'::jsonb)) cm
      join public.competitors c on c.id::text = cm.value->>'competitor_id' and c.brand_id = p_brand_id
      where r.in_window
      group by r.topic_id, cm.value->>'competitor_id'
      having sum(coalesce((cm.value->>'mention_count')::int, 0)) > 0
    ),
    comp_totals as (
      select topic_id,
             sum(mentions)::bigint as comp_mentions,
             jsonb_object_agg(competitor_id, jsonb_build_object('name', name, 'sov', mentions))
               as competitors
      from comps
      group by topic_id
    ),
    main as (
      select r.topic_id,
             count(*) filter (where r.in_window)::bigint                          as answers,
             count(*) filter (where r.in_window and r.mentions > 0)::bigint       as mention_answers,
             count(*) filter (where r.in_window and r.citations > 0)::bigint      as citation_answers,
             coalesce(sum(1.0 / r.mention_position)
               filter (where r.in_window and r.mention_position > 0), 0)::double precision
                                                                                   as pos_sum,
             count(*) filter (where r.in_window and r.mention_position > 0)::bigint
                                                                                   as pos_n,
             count(*) filter (where not r.in_window)::bigint                      as prev_answers,
             count(*) filter (where not r.in_window and r.mentions > 0)::bigint   as prev_mention_answers,
             count(*) filter (where not r.in_window and r.citations > 0)::bigint  as prev_citation_answers,
             coalesce(sum(1.0 / r.mention_position)
               filter (where not r.in_window and r.mention_position > 0), 0)::double precision
                                                                                   as prev_pos_sum,
             count(*) filter (where not r.in_window and r.mention_position > 0)::bigint
                                                                                   as prev_pos_n,
             coalesce(sum(r.mentions) filter (where r.in_window), 0)::bigint      as total_mentions,
             coalesce(sum(r.citations) filter (where r.in_window), 0)::bigint     as total_citations,
             count(distinct r.prompt_id) filter (where r.in_window)::bigint       as active_prompts,
             count(distinct r.prompt_id) filter (where r.in_window and r.visible)::bigint
                                                                                   as visible_prompts,
             max(r.created_at) filter (where r.in_window)                         as last_run_at
      from rows r
      group by r.topic_id
    )
    select m.topic_id,
           m.answers, m.mention_answers, m.citation_answers, m.pos_sum, m.pos_n,
           m.prev_answers, m.prev_mention_answers, m.prev_citation_answers, m.prev_pos_sum, m.prev_pos_n,
           m.total_mentions, m.total_citations,
           coalesce(ct.comp_mentions, 0)::bigint,
           m.active_prompts, m.visible_prompts, m.last_run_at,
           coalesce(ct.competitors, '{}'::jsonb),
           '{}'::jsonb
    from main m
    left join comp_totals ct on ct.topic_id = m.topic_id
    where m.answers > 0;
    return;
  end if;

  v_day_to := (v_to at time zone 'UTC')::date;
  v_day_from := v_day_to - (v_days - 1);
  v_prev_from := v_day_from - v_days;

  return query
  with
  topic_prompts as (
    select p.id as prompt_id, p.topic_id
    from public.prompts p
    join public.prompt_sets ps on ps.id = p.prompt_set_id
    where ps.brand_id = p_brand_id
      and p.topic_id is not null
  ),
  -- The brand's rows of both windows, read by (brand_id, day) and only then
  -- matched to the topics' prompts (see the header).
  prompt_rows as materialized (
    select d.prompt_id,
           d.day,
           d.answer_count,
           d.mention_answers,
           d.citation_answers,
           d.mentioning_answers,
           d.total_mentions,
           d.total_citations,
           d.sum_inv_position,
           d.position_count,
           d.max_created_at
    from public.insights_prompt_daily d
    where d.brand_id = p_brand_id
      and d.day between v_prev_from and v_day_to
  ),
  days as (
    select tp.topic_id,
           r.prompt_id,
           r.day,
           (r.day >= v_day_from) as in_window,
           r.answer_count,
           r.mention_answers,
           r.citation_answers,
           r.mentioning_answers,
           r.total_mentions,
           r.total_citations,
           r.sum_inv_position,
           r.position_count,
           r.max_created_at
    from prompt_rows r
    join topic_prompts tp on tp.prompt_id = r.prompt_id
  ),
  sightings as materialized (
    select cpd.prompt_id, cpd.competitor_id, cpd.mention_count
    from public.insights_competitor_prompt_daily cpd
    where cpd.brand_id = p_brand_id
      and cpd.day between v_day_from and v_day_to
  ),
  comps as (
    select tp.topic_id,
           s.competitor_id,
           min(c.name)                   as name,
           sum(s.mention_count)::bigint  as mentions
    from sightings s
    join topic_prompts tp     on tp.prompt_id = s.prompt_id
    join public.competitors c on c.id::text = s.competitor_id and c.brand_id = p_brand_id
    group by tp.topic_id, s.competitor_id
    having sum(s.mention_count) > 0
  ),
  comp_totals as (
    select topic_id,
           sum(mentions)::bigint as comp_mentions,
           jsonb_object_agg(competitor_id, jsonb_build_object('name', name, 'sov', mentions))
             as competitors
    from comps
    group by topic_id
  ),
  -- A point per UTC day, keyed as the client builds its keys
  -- (Date.toISOString()).
  daily as (
    select x.topic_id,
           jsonb_object_agg(x.day, jsonb_build_object('visible', x.visible, 'count', x.count))
             as daily
    from (
      select topic_id,
             to_char(day, 'YYYY-MM-DD')     as day,
             sum(mentioning_answers)::bigint as visible,
             sum(answer_count)::bigint       as count
      from days
      where in_window
      group by topic_id, day
    ) x
    group by x.topic_id
  ),
  -- Each topic's last answer in the window, from the rollups (00164).
  last_runs as (
    select topic_id, max(max_created_at) as last_run_at
    from days
    where in_window
    group by topic_id
  ),
  main as (
    select topic_id,
           coalesce(sum(answer_count) filter (where in_window), 0)::bigint         as answers,
           coalesce(sum(mention_answers) filter (where in_window), 0)::bigint      as mention_answers,
           coalesce(sum(citation_answers) filter (where in_window), 0)::bigint     as citation_answers,
           coalesce(sum(sum_inv_position) filter (where in_window), 0)::double precision
                                                                                   as pos_sum,
           coalesce(sum(position_count) filter (where in_window), 0)::bigint       as pos_n,
           coalesce(sum(answer_count) filter (where not in_window), 0)::bigint     as prev_answers,
           coalesce(sum(mention_answers) filter (where not in_window), 0)::bigint  as prev_mention_answers,
           coalesce(sum(citation_answers) filter (where not in_window), 0)::bigint as prev_citation_answers,
           coalesce(sum(sum_inv_position) filter (where not in_window), 0)::double precision
                                                                                   as prev_pos_sum,
           coalesce(sum(position_count) filter (where not in_window), 0)::bigint   as prev_pos_n,
           coalesce(sum(total_mentions) filter (where in_window), 0)::bigint       as total_mentions,
           coalesce(sum(total_citations) filter (where in_window), 0)::bigint      as total_citations,
           count(distinct prompt_id) filter (where in_window and answer_count > 0)::bigint
                                                                                   as active_prompts,
           count(distinct prompt_id) filter (where in_window and mentioning_answers > 0)::bigint
                                                                                   as visible_prompts
    from days
    group by topic_id
  )
  select m.topic_id,
         m.answers, m.mention_answers, m.citation_answers, m.pos_sum, m.pos_n,
         m.prev_answers, m.prev_mention_answers, m.prev_citation_answers, m.prev_pos_sum, m.prev_pos_n,
         m.total_mentions, m.total_citations,
         coalesce(ct.comp_mentions, 0)::bigint,
         m.active_prompts, m.visible_prompts, lr.last_run_at,
         coalesce(ct.competitors, '{}'::jsonb),
         coalesce(dl.daily, '{}'::jsonb)
  from main m
  left join comp_totals ct on ct.topic_id = m.topic_id
  left join daily dl       on dl.topic_id = m.topic_id
  left join last_runs lr   on lr.topic_id = m.topic_id
  where m.answers > 0;
end;
$$;

revoke execute on function public.topics_overview_window(uuid, timestamptz, timestamptz)
  from public, anon;
grant execute on function public.topics_overview_window(uuid, timestamptz, timestamptz)
  to authenticated, service_role;
