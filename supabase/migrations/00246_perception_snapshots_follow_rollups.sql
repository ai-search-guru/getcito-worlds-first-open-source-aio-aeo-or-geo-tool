-- ============================================================================
-- 00246: the Perception snapshots never older than their rollups (MS-09)
-- ============================================================================
-- 00241 serves the Perception tab's default view from a snapshot the server
-- refreshes after a brand's Mentions rollups are rebuilt. When that refresh
-- failed, or the rollups were rebuilt another way (a backfill in SQL), the
-- default view kept the snapshot's older figures until the next refresh,
-- while a filtered view already read the new rollups.
--
-- refresh_mention_terms_daily (00231), which every rebuild of the Perception
-- rollups goes through, now sets the brand's snapshots aside at its end, in
-- the rebuild's transaction: once new rollups commit, the tab reads them
-- live until the snapshots are refreshed. A refresh already under way can't
-- write over that; only one starting in the instant between the set-aside
-- and the commit could, and the refresh after the rebuild replaces it. The
-- function is otherwise 00231's, unchanged.

create or replace function public.refresh_mention_terms_daily(
  p_brand_id uuid,
  p_day_from date,
  p_day_to   date
) returns void
language plpgsql
set search_path to 'public'
as $$
declare
  v_from timestamptz := p_day_from::timestamp at time zone 'utc';
  v_to   timestamptz := (p_day_to + 1)::timestamp at time zone 'utc';
begin
  -- One rebuild per brand at a time: a run's refresh and the deleted-prompt
  -- rebuild can cover the same days. The lock releases at commit.
  perform pg_advisory_xact_lock(
    hashtextextended('refresh_mention_terms_daily:' || p_brand_id::text, 0));

  -- The terms' key leads with the entity, so their rows go by the entities
  -- those days name (the same rows the entities' come from), before those.
  delete from public.mentions_terms_daily
    where brand_id = p_brand_id
      and entity in (
        select distinct e.entity
        from public.mentions_entities_daily e
        where e.brand_id = p_brand_id and e.day between p_day_from and p_day_to)
      and day between p_day_from and p_day_to;
  delete from public.mentions_entities_daily
    where brand_id = p_brand_id and day between p_day_from and p_day_to;

  insert into public.mentions_entities_daily (
    brand_id, day, platform, region, entity, answers, with_brand)
  select p_brand_id, x.day, x.platform, x.region, x.entity,
         count(*), count(*) filter (where x.with_brand)
  from (
    select (t.created_at at time zone 'utc')::date as day, t.platform, t.region, t.entity,
           bool_or(t.entity = 'brand') over (partition by t.result_id) as with_brand
    from public.mentions_answer_terms t
    where t.brand_id = p_brand_id
      and t.created_at >= v_from
      and t.created_at < v_to
  ) x
  group by x.day, x.platform, x.region, x.entity;

  with c as materialized (
    select (t.created_at at time zone 'utc')::date as day, t.platform, t.region, t.entity,
           term, count(*)::integer as answers
    from public.mentions_answer_terms t
    cross join lateral unnest(t.terms) as term
    where t.brand_id = p_brand_id
      and t.created_at >= v_from
      and t.created_at < v_to
    group by 1, 2, 3, 4, 5
  ),
  -- The terms among any entity's 200 most frequent of a day, platform and
  -- region, kept for every entity there. coalesce rather than "is not
  -- distinct from", so the join below can hash.
  keep as (
    select distinct r.day, r.platform, coalesce(r.region, '') as region_key, r.term
    from (
      select c.day, c.platform, c.region, c.term,
             row_number() over (
               partition by c.day, c.platform, c.region, c.entity
               order by c.answers desc, c.term) as rn
      from c
    ) r
    where r.rn <= 200
  )
  insert into public.mentions_terms_daily (
    brand_id, day, platform, region, entity, term, answers)
  select p_brand_id, c.day, c.platform, c.region, c.entity, c.term, c.answers
  from c
  join keep k on k.day = c.day and k.platform = c.platform
             and k.region_key = coalesce(c.region, '') and k.term = c.term;

  -- The brand's precomputed default views (00241) now count from rollups
  -- older than these: set aside, as forget_mentions_perception_snapshots
  -- does, so the tab reads the rollups live until the server refreshes
  -- them, never older figures. Last, in the same transaction: a refresh
  -- that started before this (and read the old rollups) can't write over
  -- it, as its computed_at is earlier.
  update public.mentions_perception_snapshots
  set day_to = date '1970-01-01', computed_at = clock_timestamp()
  where brand_id = p_brand_id;
end;
$$;

revoke execute on function public.refresh_mention_terms_daily(uuid, date, date)
  from public, anon, authenticated;

comment on table public.mentions_perception_snapshots is
  'The Perception tab''s default view (MS-09) per brand and window (7, 30 or 90 days, every platform and region, no topic or search), as mentions_perception returns it. Written by refresh_mentions_perception_snapshot; set aside when the brand''s competitors or name change, or its Perception rollups are rebuilt (00246).';
