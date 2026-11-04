-- ============================================================================
-- 00236: the Topics tab's 24 hours and long windows, under the time it gets
-- ============================================================================
-- Measured on production on 2026-10-22, for the GetCito brand, as the page
-- runs it: the Topics tab's default 24 hours failed every time ("Failed to
-- load", the request ending at the authenticated role's 8 s statement
-- timeout), and 90 days took 5.9 s. 7 and 30 days took 2.9 and 3.5 s.
--
-- * 24 hours. topics_overview_window (00156, 00170) reads a window under two
--   days from the answers themselves: both windows' rows, each with its
--   competitor_mentions jsonb, which only the answer's row holds. Now the
--   counts come from idx_prompt_results_brand_created_metrics (00232) alone,
--   an index-only scan, and competitor_mentions is read for the window's
--   answers only, the half the competitor share counts. Output is 00170's.
-- * Longer windows read insights_prompt_daily and
--   insights_competitor_prompt_daily by (brand_id, day), then each row's
--   page for its figures. Covering indexes on the same key hold those
--   figures, so the reads are index-only; they replace the plain
--   (brand_id, day) indexes. On a large table, build them by hand first with
--   `create index concurrently` (and drop the old ones the same way), which
--   doesn't hold back the nightly refresh's writes; these statements then
--   find the work done.
-- * The morning health report (backend/src/lib/health) timed
--   topics_overview_aggregates, which the page stopped reading at 00156: its
--   fixed 30 days of raw answers ran past 20 s while the page itself never
--   waited on it. health_probe gains 'topics_overview_window', so the report
--   times the tab's own reads: 24 hours and 90 days.


create index if not exists idx_insights_prompt_daily_brand_day_cover
  on public.insights_prompt_daily (brand_id, day)
  include (prompt_id, answer_count, mention_answers, citation_answers, mentioning_answers,
           total_mentions, total_citations, sum_inv_position, position_count, max_created_at);

create index if not exists idx_insights_competitor_prompt_daily_brand_day_cover
  on public.insights_competitor_prompt_daily (brand_id, day)
  include (prompt_id, competitor_id, mention_count);

-- Each replaces the plain (brand_id, day) index (00066): same key, so every
-- read that used it can use these, and the planner no longer picks the
-- narrower one and fetches the rows anyway.
drop index if exists public.idx_insights_prompt_daily_brand_day;
drop index if exists public.idx_insights_competitor_prompt_daily_brand_day;

-- An index-only scan skips a row's page only once the visibility map covers
-- it. The nightly refresh rewrites the latest days of both tables, which at
-- the default scale factors autovacuum reached weeks later; as 00224 does for
-- the answers, vacuum and analyze them about daily.
alter table public.insights_prompt_daily set (
  autovacuum_vacuum_scale_factor = 0.01,
  autovacuum_vacuum_insert_scale_factor = 0.01,
  autovacuum_analyze_scale_factor = 0.02
);

alter table public.insights_competitor_prompt_daily set (
  autovacuum_vacuum_scale_factor = 0.01,
  autovacuum_vacuum_insert_scale_factor = 0.01,
  autovacuum_analyze_scale_factor = 0.02
);

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
    topic_prompts as (
      select p.id as prompt_id, p.topic_id
      from public.prompts p
      join public.prompt_sets ps on ps.id = p.prompt_set_id
      where ps.brand_id = p_brand_id
        and p.topic_id is not null
    ),
    -- Both windows' answers from idx_prompt_results_brand_created_metrics
    -- (00232) alone: every column read here is in the index, so the answers'
    -- rows (and their competitor_mentions) stay unread.
    rows as materialized (
      select tp.topic_id,
             pr.prompt_id,
             pr.created_at,
             (pr.created_at >= v_from)                        as in_window,
             coalesce(pr.mention_count, 0)                    as mentions,
             coalesce(pr.citation_count, 0)                   as citations,
             pr.mention_position,
             (coalesce(pr.mention_count, 0) > 0
               or coalesce(pr.citation_count, 0) > 0)         as visible
      from public.prompt_results pr
      join topic_prompts tp on tp.prompt_id = pr.prompt_id
      where pr.brand_id = p_brand_id
        and pr.platform <> 'chatgpt-shopping'
        and pr.created_at >= v_from - (v_to - v_from)
        and pr.created_at <= v_to
    ),
    -- The competitor share is the window's alone, so only the window's
    -- answers are read for their competitor_mentions: half the rows 00156
    -- read, and none of the window before.
    comps as (
      select tp.topic_id,
             cm.value->>'competitor_id'                              as competitor_id,
             min(c.name)                                             as name,
             sum(coalesce((cm.value->>'mention_count')::int, 0))::bigint as mentions
      from public.prompt_results pr
      join topic_prompts tp on tp.prompt_id = pr.prompt_id
      cross join lateral jsonb_array_elements(coalesce(pr.competitor_mentions, '[]'::jsonb)) cm
      join public.competitors c on c.id::text = cm.value->>'competitor_id' and c.brand_id = p_brand_id
      where pr.brand_id = p_brand_id
        and pr.platform <> 'chatgpt-shopping'
        and pr.created_at >= v_from
        and pr.created_at <= v_to
      group by tp.topic_id, cm.value->>'competitor_id'
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

create or replace function public.health_probe(
  p_user_id uuid,
  p_brand_id uuid,
  p_probe text,
  p_days integer default null
) returns numeric
language plpgsql
security invoker
set search_path to 'public'
as $$
declare
  t0 timestamptz;
  ts_from timestamptz := case when p_days is null then null else now() - make_interval(days => p_days) end;
  day_from date := (now() at time zone 'utc')::date - coalesce(p_days, 0);
  page_day_from date := case when p_days is null then null
                             else (now() at time zone 'utc')::date - (p_days - 1) end;
  n bigint;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user_id, 'role', 'authenticated')::text,
    true
  );
  t0 := clock_timestamp();

  case p_probe
    when 'citations_window_stats' then
      select count(*) into n from public.citations_window_stats(
        p_brand_id => p_brand_id, p_date_from => ts_from, p_date_to => null,
        p_models => null, p_regions => null, p_prompt_ids => null, p_topic_ids => null);
    when 'citations_domains' then
      select count(*) into n from public.citations_domains(
        p_brand_id => p_brand_id, p_date_from => ts_from, p_date_to => null,
        p_models => null, p_regions => null, p_prompt_ids => null, p_topic_ids => null);
    when 'citations_urls' then
      select count(*) into n from public.citations_urls(
        p_brand_id => p_brand_id, p_date_from => ts_from, p_date_to => null,
        p_models => null, p_regions => null, p_prompt_ids => null, p_topic_ids => null,
        p_limit => 100, p_domains => null, p_exclude_domains => null);
    when 'citations_domains_daily' then
      select count(*) into n from public.citations_domains_daily(
        p_brand_id => p_brand_id, p_day_from => page_day_from, p_day_to => null);
    when 'citations_urls_daily' then
      select count(*) into n from public.citations_urls_daily(
        p_brand_id => p_brand_id, p_day_from => page_day_from, p_day_to => null,
        p_limit => 2000);
    when 'insights_aggregates_daily' then
      select count(*) into n from public.insights_aggregates_daily(
        p_brand_id => p_brand_id, p_platform => null, p_models => null, p_region => null,
        p_day_from => case when p_days is null then null else day_from end, p_day_to => null);
    when 'competitor_aggregates_daily' then
      select count(*) into n from public.competitor_aggregates_daily(
        p_brand_id => p_brand_id, p_platform => null, p_models => null, p_region => null,
        p_day_from => case when p_days is null then null else day_from end, p_day_to => null);
    when 'topics_overview_aggregates' then
      select count(*) into n from public.topics_overview_aggregates(p_brand_id => p_brand_id);
    -- What the Topics tab runs: its window, the last p_days days (a day when
    -- unset, the tab's default 24 hours).
    when 'topics_overview_window' then
      select count(*) into n from public.topics_overview_window(
        p_brand_id => p_brand_id,
        p_date_from => now() - make_interval(days => coalesce(p_days, 1)),
        p_date_to => null);
    else
      raise exception 'unknown health probe: %', p_probe;
  end case;

  return round(extract(epoch from clock_timestamp() - t0)::numeric, 2);
end;
$$;


revoke all on function public.health_probe(uuid, uuid, text, integer) from public, anon, authenticated;
grant execute on function public.health_probe(uuid, uuid, text, integer) to service_role;

notify pgrst, 'reload schema';
