-- The Topics overview for any window, for its date range (24h, 7d, 30d, 90d,
-- custom), fast enough not to fail.
--
-- topics_overview_aggregates (00057, 00098) reads fixed windows from the raw
-- answers: 30 days for the table, the last 7 days against the 7 before for
-- the change, 14 days for the trend. On the largest brand it now runs past the
-- authenticated role's 8 s statement timeout, so the page fails to load
-- ("Failed to load topics"; the request ends in a 500 after ~9 s).
--
-- This takes the window instead: the table's figures cover it, the change
-- compares it with the window of the same length just before, and the trend
-- has a point per UTC day of it. It reads in two ways:
--
--   * A window under two days (24 hours, the page's default) reads its
--     answers, and the previous window's, directly: two days of answers are a
--     small read, and today's run may not be in the rollups yet. Its
--     competitor share comes from those answers' competitor_mentions. It has
--     no trend: one day has no line to draw.
--   * A longer window reads whole UTC days from the daily rollups the Insights
--     page reads (insights_prompt_daily, 00130; insights_competitor_prompt_daily,
--     00098), counted back from the window's end, the rule 00098 used for the
--     competitor share over 30 days: a rolling 7 days is today and the 6 days
--     before. A day enters the rollups when its run completes, and a sweep
--     re-refreshes the last days every morning (backend/src/lib/insightsRollups.js).
--     Only each topic's last answer time is read from the answers, as an
--     index-only scan of idx_prompt_results_brand_created_cover.
--
-- Prompts take their history to the topic they are in now, as before.
-- chatgpt-shopping stays out (#155); the rollups leave it out too.
--
-- As 00147, 00148, 00152 and 00153 do, it is plpgsql with force_custom_plan,
-- so every call is planned with its real window, and work_mem; and security
-- definer with the organization check made explicit (the same rule as
-- prompt_results' RLS), returning nothing for a caller outside the brand's
-- organization. topics_overview_aggregates stays for a web build deployed
-- before this migration, which falls back to it.

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
  days as (
    select tp.topic_id,
           d.prompt_id,
           d.day,
           (d.day >= v_day_from) as in_window,
           d.answer_count,
           d.mention_answers,
           d.citation_answers,
           d.mentioning_answers,
           d.total_mentions,
           d.total_citations,
           d.sum_inv_position,
           d.position_count
    from public.insights_prompt_daily d
    join topic_prompts tp on tp.prompt_id = d.prompt_id
    where d.brand_id = p_brand_id
      and d.day between v_prev_from and v_day_to
  ),
  comps as (
    select tp.topic_id,
           cpd.competitor_id,
           min(c.name)                     as name,
           sum(cpd.mention_count)::bigint  as mentions
    from public.insights_competitor_prompt_daily cpd
    join topic_prompts tp     on tp.prompt_id = cpd.prompt_id
    join public.competitors c on c.id::text = cpd.competitor_id and c.brand_id = p_brand_id
    where cpd.brand_id = p_brand_id
      and cpd.day between v_day_from and v_day_to
    group by tp.topic_id, cpd.competitor_id
    having sum(cpd.mention_count) > 0
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
  -- Each topic's last answer in the window: the covering index holds
  -- (brand_id, created_at) with the prompt, so this never reads the rows.
  last_runs as (
    select tp.topic_id, max(pr.created_at) as last_run_at
    from public.prompt_results pr
    join topic_prompts tp on tp.prompt_id = pr.prompt_id
    where pr.brand_id = p_brand_id
      and pr.created_at >= v_from
      and pr.created_at <= v_to
      and pr.platform <> 'chatgpt-shopping'
    group by tp.topic_id
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
