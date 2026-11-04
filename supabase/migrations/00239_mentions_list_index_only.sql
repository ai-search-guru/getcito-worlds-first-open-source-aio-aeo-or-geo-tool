-- ============================================================================
-- 00239: the Mentions table's read from its index alone (Mentions & Sentiment)
-- ============================================================================
-- mentions_list (00158) read every mention in the window from the table,
-- each with its competitor_mentions jsonb, to count competitors named beside
-- the brand. On the largest brand that took 8.4 s cold at 30 days, past the
-- 8 s statement timeout, and 4.9 s at 90 days (prod, 2026-10-22). The user's
-- target is every Mentions & Sentiment tab under 3-4 s cold.
--
-- Two changes, with the same output for every filter, sort and group:
--   1. The partial index on the brand's mentions carries the columns the
--      window needs (id, prompt_id, platform, region, sentiment), so the
--      total, the prompt count and the page's order come from the index
--      alone. It replaces 00158's idx_prompt_results_brand_mentions, which
--      had the same key and predicate, so every read that used it can use
--      this one.
--   2. competitor_mentions is read only when the table sorts by competitors
--      named or filters by a competitor; the page's 100 rows still read it
--      for the names shown beside each answer.
--
-- On a large prompt_results, build the index by hand first, which doesn't
-- hold back tracking's writes; this migration then finds it in place:
--   create index concurrently if not exists idx_prompt_results_brand_mentions_cover
--     on public.prompt_results (brand_id, created_at desc)
--     include (id, prompt_id, platform, region, sentiment)
--     where mention_count > 0;
--   drop index concurrently if exists public.idx_prompt_results_brand_mentions;
--
-- health_probe also gains 'mentions_list' and 'mentions_perception', timed
-- over the last p_days days, so the morning report shows these reads.

create index if not exists idx_prompt_results_brand_mentions_cover
  on public.prompt_results (brand_id, created_at desc)
  include (id, prompt_id, platform, region, sentiment)
  where mention_count > 0;

drop index if exists public.idx_prompt_results_brand_mentions;

create or replace function public.mentions_list(
  p_brand_id      uuid,
  p_date_from     timestamptz,
  p_date_to       timestamptz default null,
  p_platform      text default null,
  p_region        text default null,
  p_topic_id      uuid default null,
  p_search        text default null,
  p_sentiment     text default null,
  p_competitor_id text default null,
  p_sort          text default 'newest',
  p_group         text default null,
  p_limit         integer default 100,
  p_offset        integer default 0
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
  v_to       timestamptz := coalesce(p_date_to, now());
  v_from     timestamptz := least(p_date_from, coalesce(p_date_to, now()));
  v_days     integer;
  v_day_to   date;
  v_start    timestamptz;
  v_end      timestamptz;
  v_search   text := nullif(btrim(lower(coalesce(p_search, ''))), '');
  v_limit    integer := least(greatest(coalesce(p_limit, 100), 1), 100);
  v_offset   integer := greatest(coalesce(p_offset, 0), 0);
  v_group    text := case when p_group in ('prompt', 'platform') then p_group end;
  -- Only these read each answer's competitor_mentions: the rest of the
  -- table's choices are answered from the index alone.
  v_competitors boolean := p_sort = 'co_mentions' or p_competitor_id is not null;
  v_result   jsonb;
begin
  if auth.role() is distinct from 'service_role' and not exists (
    select 1 from public.brands b
    join public.profiles pf on pf.organization_id = b.organization_id
    where b.id = p_brand_id and pf.id = auth.uid()
  ) then
    return null;
  end if;

  -- The same window as mentions_overview's current one.
  v_days := greatest(1, ceil(extract(epoch from v_to - v_from) / 86400.0 - 1.0 / 24)::integer);
  if v_days < 2 then
    v_start := v_from;
    v_end   := v_to + interval '1 microsecond';
  else
    v_day_to := (v_to at time zone 'utc')::date;
    v_start  := (v_day_to - (v_days - 1))::timestamp at time zone 'utc';
    v_end    := (v_day_to + 1)::timestamp at time zone 'utc';
  end if;

  with
  prompts_in as (
    select p.id, p.text, p.topic_id
    from public.prompts p
    join public.prompt_sets ps on ps.id = p.prompt_set_id
    where ps.brand_id = p_brand_id
      and (p_topic_id is null or p.topic_id = p_topic_id)
      and (v_search is null or position(v_search in lower(p.text)) > 0)
  ),
  -- The brand's mentions in the window, read first, through the partial
  -- index above, and only then joined to the prompts. Driven by the prompts
  -- instead, the planner walks each prompt's whole history: 8.8 s for 30
  -- days of the largest brand, against 0.2 s this way. Every column here is
  -- in that index, so the window is read without visiting the table.
  mention_rows as materialized (
    select pr.id, pr.created_at, pr.prompt_id, pr.platform, pr.sentiment
    from public.prompt_results pr
    where pr.brand_id = p_brand_id
      and pr.mention_count > 0
      and pr.platform <> 'chatgpt-shopping'
      and pr.created_at >= v_start
      and pr.created_at < v_end
      and (p_platform is null or pr.platform = p_platform)
      and (p_region is null or pr.region = p_region)
      and (p_sentiment is null
           or (p_sentiment in ('positive', 'negative') and pr.sentiment = p_sentiment)
           or (p_sentiment = 'neutral'
               and pr.sentiment is distinct from 'positive'
               and pr.sentiment is distinct from 'negative'))
  ),
  hits as (
    select m.id,
           m.created_at,
           m.prompt_id,
           pi.text as prompt_text,
           m.platform,
           m.sentiment,
           co.co_count,
           co.with_competitor
    from mention_rows m
    join prompts_in pi on pi.id = m.prompt_id
    -- Competitors named beside you (the array lists every competitor, named
    -- or not), read from the answer only when the sort or the competitor
    -- filter asks: otherwise v_competitors is false, the plan's one-time
    -- filter skips it, and co_count is never used.
    left join lateral (
      select (select count(*)
                from jsonb_array_elements(coalesce(x.competitor_mentions, '[]'::jsonb)) cm
               where cm.value ? 'competitor_id'
                 and coalesce((cm.value->>'mention_count')::int, 0) > 0) as co_count,
             (p_competitor_id is not null and p_competitor_id <> 'none' and exists (
                select 1
                  from jsonb_array_elements(coalesce(x.competitor_mentions, '[]'::jsonb)) cm
                 where cm.value->>'competitor_id' = p_competitor_id
                   and coalesce((cm.value->>'mention_count')::int, 0) > 0)) as with_competitor
      from public.prompt_results x
      where v_competitors and x.id = m.id
    ) co on true
  ),
  filtered as (
    select h.*,
           case v_group
             when 'prompt' then h.prompt_id::text
             when 'platform' then h.platform
           end as group_key
    from hits h
    where p_competitor_id is null
       or (p_competitor_id = 'none' and h.co_count = 0)
       or h.with_competitor
  ),
  grouped as (
    select f.*,
           case when v_group is not null
                then count(*) over (partition by f.group_key) end as group_count
    from filtered f
  ),
  page as (
    select g.*
    from grouped g
    order by
      case when v_group is not null then g.group_count end desc nulls last,
      case when v_group = 'prompt' then lower(g.prompt_text) end,
      g.group_key,
      case when p_sort = 'negative' then
        case g.sentiment when 'negative' then 0 when 'positive' then 2 else 1 end
      end,
      case when p_sort = 'co_mentions' then g.co_count end desc nulls last,
      case when p_sort = 'oldest' then g.created_at end,
      g.created_at desc,
      g.id
    limit v_limit
    offset v_offset
  ),
  rows_out as (
    select pg.*,
           pr.model_used,
           pr.region,
           pr.mention_count,
           pr.mention_position,
           pr.mentioned_entity_count,
           pr.response,
           pi.topic_id,
           t.name as topic_name,
           coalesce((
             select jsonb_agg(jsonb_build_object(
                      'competitor_id', cm.value->>'competitor_id',
                      'name', coalesce(co.name, cm.value->>'name'),
                      'mention_position', cm.value->'mention_position')
                    order by (cm.value->>'mention_position')::int nulls last,
                             coalesce(co.name, cm.value->>'name'))
               from jsonb_array_elements(coalesce(pr.competitor_mentions, '[]'::jsonb)) cm
               left join public.competitors co
                 on co.id::text = cm.value->>'competitor_id' and co.brand_id = p_brand_id
              where cm.value ? 'competitor_id'
                and coalesce((cm.value->>'mention_count')::int, 0) > 0
           ), '[]'::jsonb) as co_mentioned
    from page pg
    join public.prompt_results pr on pr.id = pg.id
    join prompts_in pi on pi.id = pg.prompt_id
    left join public.topics t on t.id = pi.topic_id
  )
  select jsonb_build_object(
    'total',   (select count(*) from filtered),
    'prompts', (select count(distinct prompt_id) from filtered),
    'rows',    coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id,
               'created_at', r.created_at,
               'prompt_id', r.prompt_id,
               'prompt_text', r.prompt_text,
               'topic_id', r.topic_id,
               'topic_name', r.topic_name,
               'platform', r.platform,
               'model_used', r.model_used,
               'region', r.region,
               'sentiment', r.sentiment,
               'mention_count', r.mention_count,
               'mention_position', r.mention_position,
               'mentioned_entity_count', r.mentioned_entity_count,
               'co_mentioned', r.co_mentioned,
               'response', r.response,
               'group_key', r.group_key,
               'group_count', r.group_count)
             order by
               case when v_group is not null then r.group_count end desc nulls last,
               case when v_group = 'prompt' then lower(r.prompt_text) end,
               r.group_key,
               case when p_sort = 'negative' then
                 case r.sentiment when 'negative' then 0 when 'positive' then 2 else 1 end
               end,
               case when p_sort = 'co_mentions' then r.co_count end desc nulls last,
               case when p_sort = 'oldest' then r.created_at end,
               r.created_at desc,
               r.id)
      from rows_out r
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;

revoke execute on function public.mentions_list(
  uuid, timestamptz, timestamptz, text, text, uuid, text, text, text, text, text, integer, integer)
  from public, anon;
grant execute on function public.mentions_list(
  uuid, timestamptz, timestamptz, text, text, uuid, text, text, text, text, text, integer, integer)
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
    -- The Mentions & Sentiment tabs' reads over the last p_days days (a
    -- month when unset), as the page asks for them: the table's first page,
    -- newest first, and the Perception figures.
    when 'mentions_list' then
      perform public.mentions_list(
        p_brand_id => p_brand_id,
        p_date_from => now() - make_interval(days => coalesce(p_days, 30)),
        p_date_to => null);
    when 'mentions_perception' then
      perform public.mentions_perception(
        p_brand_id => p_brand_id,
        p_date_from => now() - make_interval(days => coalesce(p_days, 30)),
        p_date_to => null);
    else
      raise exception 'unknown health probe: %', p_probe;
  end case;

  return round(extract(epoch from clock_timestamp() - t0)::numeric, 2);
end;
$$;


revoke all on function public.health_probe(uuid, uuid, text, integer) from public, anon, authenticated;
grant execute on function public.health_probe(uuid, uuid, text, integer) to service_role;
