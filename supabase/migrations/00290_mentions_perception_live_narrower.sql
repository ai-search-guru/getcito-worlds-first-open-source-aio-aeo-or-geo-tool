-- ============================================================================
-- 00290: the Perception tab's filtered views, read faster (Mentions & Sentiment, MS-09)
-- ============================================================================
-- 00241 computes the default view ahead; a filtered one (a platform, a
-- country, a topic or a search) still reads mentions_perception_live. On
-- production (2026-10-26, the GetCito brand, read-only):
--   * ChatGPT only took 6.3 s at 30 days, and failed at 90 days (8.7 s twice,
--     past the 8 s statement timeout: "Couldn't load");
--   * a search failed at 30 days the same way;
--   * the morning report's 'mentions_perception_live' probe took 10.9 s at
--     30 days and 8.9 s at 90.
-- The default view opened in 1.1–1.2 s from its snapshot. The target is 3 s
-- for every view.
--
-- The same output for every window and filter, with less read:
--   1. The window before is read only for what the tab shows of it: each
--      entity's mentions and co-mentions (mentions_entities_daily, small)
--      and the previous answers of the brand's 15 terms shown. 00237 summed
--      every shown entity's every term over both windows for those 15
--      numbers.
--      * The rollups (whole days, no topic or search) now read the shown
--        entities' terms for the window and only the brand's for the window
--        before: about 6 entity-windows of rows instead of 10.
--      * A topic or a search (and a window under two days) still reads both
--        windows' answers, which the mentions and co-mentions need, but
--        unnests only the brand's from the window before.
--      A platform or a country is checked inside the key (after the day), so
--      a filtered view reads as many index entries as the default one.
--   2. mentions_terms_daily's key carries the count (include answers), so
--      the terms' sums come from the index alone. It replaces 00231's
--      mentions_terms_daily_key: the same key, still unique, nulls not
--      distinct.
--   3. Autovacuum runs on both rollups about daily, as 00236 does for the
--      Insights rollups: each refresh deletes and rewrites a range of days,
--      and an index-only scan still goes to the table for a page that isn't
--      all-visible yet. mentions_entities_daily has no covering index; it
--      gets the dead rows cleared and its statistics kept current.
--
-- On a large mentions_terms_daily, build the index by hand first, which
-- doesn't hold back the refreshes, with no statement timeout; this migration
-- then finds it in place:
--   set statement_timeout = 0;
--   create unique index concurrently if not exists mentions_terms_daily_key_cover
--     on public.mentions_terms_daily (brand_id, entity, day, platform, region, term)
--     include (answers) nulls not distinct;
--   -- indisvalid must be true before the old key goes:
--   select indisvalid from pg_index
--     where indexrelid = 'public.mentions_terms_daily_key_cover'::regclass;
--   drop index concurrently if exists public.mentions_terms_daily_key;
-- A build that stopped part way leaves an invalid index under that name;
-- drop it and build again. This migration refuses to drop the old key while
-- the new one is invalid.

create unique index if not exists mentions_terms_daily_key_cover
  on public.mentions_terms_daily (brand_id, entity, day, platform, region, term)
  include (answers)
  nulls not distinct;

do $$
begin
  if exists (
    select 1 from pg_index
    where indexrelid = 'public.mentions_terms_daily_key_cover'::regclass
      and not indisvalid
  ) then
    raise exception 'mentions_terms_daily_key_cover is invalid (a concurrent build stopped part way): drop it and build it again';
  end if;
end;
$$;

-- The Perception reads and the refreshes don't queue behind the drop for
-- long: it gives up after 3 s instead (run it again).
set lock_timeout = '3s';

drop index if exists public.mentions_terms_daily_key;

reset lock_timeout;

alter table public.mentions_terms_daily set (
  autovacuum_vacuum_scale_factor = 0.01,
  autovacuum_vacuum_insert_scale_factor = 0.01,
  autovacuum_analyze_scale_factor = 0.02
);

alter table public.mentions_entities_daily set (
  autovacuum_vacuum_scale_factor = 0.01,
  autovacuum_vacuum_insert_scale_factor = 0.01,
  autovacuum_analyze_scale_factor = 0.02
);

-- 00241's read, the window before narrowed to the brand's terms shown.
create or replace function public.mentions_perception_live(
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
  v_to         timestamptz := coalesce(p_date_to, now());
  v_from       timestamptz := least(p_date_from, coalesce(p_date_to, now()));
  v_days       integer;
  v_day_to     date;
  v_start      timestamptz;
  v_end        timestamptz;
  v_prev_start timestamptz;
  v_search     text := nullif(btrim(lower(coalesce(p_search, ''))), '');
  v_rollup     boolean;
  v_start_day  date;
  v_end_day    date;
  v_prev_day   date;
  v_result     jsonb;
begin
  v_days := greatest(1, ceil(extract(epoch from v_to - v_from) / 86400.0 - 1.0 / 24)::integer);
  if v_days < 2 then
    v_start := v_from;
    v_end   := v_to + interval '1 microsecond';
  else
    v_day_to := (v_to at time zone 'utc')::date;
    v_start  := (v_day_to - (v_days - 1))::timestamp at time zone 'utc';
    v_end    := (v_day_to + 1)::timestamp at time zone 'utc';
  end if;
  v_prev_start := v_start - (v_end - v_start);
  -- Whole UTC days with no topic or search read the daily rollups (00231);
  -- a window under two days, or a filter on the prompts, reads the answers'
  -- terms as before. The branch not taken is pruned (plan_cache_mode).
  v_rollup    := v_days >= 2 and p_topic_id is null and v_search is null;
  v_start_day := (v_start at time zone 'utc')::date;
  v_end_day   := (v_end at time zone 'utc')::date;
  v_prev_day  := (v_prev_start at time zone 'utc')::date;

  with
  prompts_in as (
    select p.id
    from public.prompts p
    join public.prompt_sets ps on ps.id = p.prompt_set_id
    where ps.brand_id = p_brand_id
      and (p_topic_id is null or p.topic_id = p_topic_id)
      and (v_search is null or position(v_search in lower(p.text)) > 0)
  ),
  rows_in as (
    select t.result_id, t.entity, t.terms, (t.created_at >= v_start) as cur
    from public.mentions_answer_terms t
    join prompts_in pi on pi.id = t.prompt_id
    where not v_rollup
      and t.brand_id = p_brand_id
      and t.created_at >= v_prev_start
      and t.created_at < v_end
      and (p_platform is null or t.platform = p_platform)
      and (p_region is null or t.region = p_region)
  ),
  entity_counts as (
    select entity,
           count(*) filter (where cur)     as mentions,
           count(*) filter (where not cur) as prev_mentions
    from rows_in
    group by entity
    union all
    select d.entity,
           coalesce(sum(d.answers) filter (where d.day >= v_start_day), 0),
           coalesce(sum(d.answers) filter (where d.day < v_start_day), 0)
    from public.mentions_entities_daily d
    where v_rollup
      and d.brand_id = p_brand_id
      and d.day >= v_prev_day
      and d.day < v_end_day
      and (p_platform is null or d.platform = p_platform)
      and (p_region is null or d.region = p_region)
    group by d.entity
  ),
  shown as (
    select 'brand'::text as entity, 0 as rank
    union all
    select * from (
      select ec.entity, row_number() over (order by ec.mentions desc, ec.entity)::int
      from entity_counts ec
      join public.competitors co on co.id::text = ec.entity and co.brand_id = p_brand_id
      where ec.mentions > 0
      order by ec.mentions desc, ec.entity
      limit 4
    ) top_competitors
  ),
  -- The shown entities' terms in the window. The window before is read
  -- only for the brand's terms shown (brand_prev).
  term_counts_all as (
    select r.entity, term, count(*) as answers
    from rows_in r
    join shown s on s.entity = r.entity
    cross join lateral unnest(r.terms) as term
    where r.cur
    group by r.entity, term
    union all
    select d.entity, d.term, sum(d.answers)
    from public.mentions_terms_daily d
    join shown s on s.entity = d.entity
    where v_rollup
      and d.brand_id = p_brand_id
      and d.day >= v_start_day
      and d.day < v_end_day
      and (p_platform is null or d.platform = p_platform)
      and (p_region is null or d.region = p_region)
    group by d.entity, d.term
  ),
  -- Each entity's 60 most frequent terms are the candidates.
  candidates as (
    select entity, term, answers
    from (
      select t.*, row_number() over (partition by t.entity order by t.answers desc, t.term) as rn
      from term_counts_all t
      where t.answers > 0
    ) ranked
    where rn <= 60
  ),
  -- A word that nearly always comes in one phrase is that phrase: "fresh" and
  -- "roast" give way to "fresh roast" when it has 80% of their answers.
  term_counts as (
    select c.*
    from candidates c
    where position(' ' in c.term) > 0
       or not exists (
         select 1 from candidates p
         where p.entity = c.entity
           and position(' ' in p.term) > 0
           and (p.term like c.term || ' %' or p.term like '% ' || c.term)
           and p.answers >= 0.8 * c.answers)
  ),
  brand_terms as (
    select term, answers
    from term_counts
    where entity = 'brand' and answers > 0
    order by answers desc, term
    limit 15
  ),
  -- Those terms' answers in the window before, for their trend.
  brand_prev as (
    select term, count(*) as prev_answers
    from rows_in r
    cross join lateral unnest(r.terms) as term
    where not r.cur
      and r.entity = 'brand'
      and term in (select bt.term from brand_terms bt)
    group by term
    union all
    select d.term, sum(d.answers)
    from public.mentions_terms_daily d
    where v_rollup
      and d.brand_id = p_brand_id
      and d.entity = 'brand'
      and d.day >= v_prev_day
      and d.day < v_start_day
      and d.term in (select bt.term from brand_terms bt)
      and (p_platform is null or d.platform = p_platform)
      and (p_region is null or d.region = p_region)
    group by d.term
  ),
  -- The terms that tell the brands apart most: the widest spread between the
  -- highest and lowest share of mentions, then the highest shares.
  attributes as (
    select u.term
    from (select distinct term from term_counts) u
    cross join shown s
    left join term_counts_all tc on tc.entity = s.entity and tc.term = u.term
    left join entity_counts ec on ec.entity = s.entity
    group by u.term
    order by
      max(coalesce(tc.answers, 0)::numeric / nullif(ec.mentions, 0))
        - min(coalesce(tc.answers, 0)::numeric / nullif(ec.mentions, 0)) desc nulls last,
      sum(coalesce(tc.answers, 0)::numeric / nullif(ec.mentions, 0)) desc nulls last,
      u.term
    limit 8
  ),
  -- A competitor's rows in answers that name the brand too, in one pass.
  co as (
    select x.entity,
           count(*) filter (where x.cur)     as co_mentions,
           count(*) filter (where not x.cur) as prev_co_mentions
    from (
      select r.entity, r.cur,
             bool_or(r.entity = 'brand') over (partition by r.result_id) as with_brand
      from rows_in r
    ) x
    where x.entity <> 'brand' and x.with_brand
    group by x.entity
    union all
    select d.entity,
           coalesce(sum(d.with_brand) filter (where d.day >= v_start_day), 0),
           coalesce(sum(d.with_brand) filter (where d.day < v_start_day), 0)
    from public.mentions_entities_daily d
    where v_rollup
      and d.entity <> 'brand'
      and d.brand_id = p_brand_id
      and d.day >= v_prev_day
      and d.day < v_end_day
      and (p_platform is null or d.platform = p_platform)
      and (p_region is null or d.region = p_region)
    group by d.entity
    having sum(d.with_brand) > 0
  )
  select jsonb_build_object(
    'window', jsonb_build_object('from', v_start, 'to', v_end, 'days', v_days),
    'entities', coalesce((
      select jsonb_agg(jsonb_build_object(
               'entity', s.entity,
               'name', case when s.entity = 'brand' then b.name else co.name end,
               'is_brand', s.entity = 'brand',
               'mentions', coalesce(ec.mentions, 0),
               'prev_mentions', coalesce(ec.prev_mentions, 0))
             order by s.rank)
      from shown s
      left join entity_counts ec on ec.entity = s.entity
      left join public.brands b on s.entity = 'brand' and b.id = p_brand_id
      left join public.competitors co on co.id::text = s.entity and co.brand_id = p_brand_id
    ), '[]'::jsonb),
    'brand_terms', coalesce((
      select jsonb_agg(jsonb_build_object(
               'term', bt.term, 'answers', bt.answers,
               'prev_answers', coalesce(bp.prev_answers, 0))
             order by bt.answers desc, bt.term)
      from brand_terms bt
      left join brand_prev bp on bp.term = bt.term
    ), '[]'::jsonb),
    'attributes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'term', a.term,
               'values', (
                 select jsonb_agg(jsonb_build_object(
                          'entity', s.entity, 'answers', coalesce(tc.answers, 0))
                        order by s.rank)
                 from shown s
                 left join term_counts_all tc on tc.entity = s.entity and tc.term = a.term)))
      from attributes a
    ), '[]'::jsonb),
    'co_mentions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'competitor_id', c.entity,
               'name', comp.name,
               'co_mentions', c.co_mentions,
               'prev_co_mentions', c.prev_co_mentions)
             order by c.co_mentions desc, comp.name)
      from co c
      join public.competitors comp on comp.id::text = c.entity and comp.brand_id = p_brand_id
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;

revoke all on function public.mentions_perception_live(uuid, timestamptz, timestamptz, text, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.mentions_perception_live(uuid, timestamptz, timestamptz, text, text, uuid, text)
  to service_role;
