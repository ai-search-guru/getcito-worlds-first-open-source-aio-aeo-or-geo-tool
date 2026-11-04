-- ============================================================================
-- 00231: daily rollups for the Perception tab (Mentions & Sentiment, MS-09)
-- ============================================================================
-- mentions_perception (00161) read every answer's terms for the window and
-- the window before it, unnested per call: 30 days read 60 days of
-- mentions_answer_terms. On production the Perception tab's 30 and 90 days
-- failed on every try at the authenticated 8 s timeout (2026-10-21, the
-- GetCito brand; ~10 s cold at 30 days on the largest brand in #1124's
-- review). The terms are now counted once a day, when they are written. This
-- migration adds the rollups and keeps them current; 00237 moves the read
-- onto them once they are filled:
--
--   * mentions_entities_daily: per brand, UTC day, platform and region, the
--     answers naming each entity ('brand' or a competitor's id), and how many
--     of those name the brand too. Exact: the tab's mention counts, its top
--     competitors and its co-mentions come from here.
--   * mentions_terms_daily: per brand, day, platform, region and entity, the
--     answers each term is next to. A term is kept when it is among any
--     entity's 200 most frequent that day, platform and region, and then for
--     every entity there: the attributes heat map compares the entities on
--     the same terms, so a competitor's count of a term another entity uses a
--     lot must not be cut short (a cap per entity left those cells 25–60%
--     short on the largest brand). A rarer term's count can still come out
--     short on the days it missed every entity's 200, the price of a bounded
--     table (keeping every term would be 3.7× the rows).
--   * One row per key on both (unique, nulls not distinct), as 00192 gave the
--     Mentions rollups: the advisory lock alone kept a day from being counted
--     twice. The terms' key leads with the entity, so the read takes only the
--     entities the tab shows (5 of the largest brand's 19).
--   * refresh_mention_terms_daily(brand, from, to) rebuilds a day range from
--     mentions_answer_terms. refresh_mention_terms (00161) calls it after
--     writing the same days' terms, in the same transaction; the server's
--     deleted-prompt rebuild calls it for the days a deleted prompt leaves
--     (its terms rows went with its answers). Service-role only.
--
-- The history is not filled here: on production it would hold a lock on
-- brands (the tables reference it) for minutes, past the statement timeout.
-- Apply in this order:
--   1. this migration;
--   2. the server (its deleted-prompt rebuild calls refresh_mention_terms_daily);
--   3. `node src/scripts/backfillMentionTermsDaily.js` (server), which
--      rebuilds each brand's history a week per call;
--   4. 00237, the read.

-- ─── Tables ─────────────────────────────────────────────────────────────────

create table if not exists public.mentions_entities_daily (
  brand_id   uuid not null references public.brands(id) on delete cascade,
  day        date not null,
  platform   text not null,
  region     text,
  -- 'brand', or the competitor's id.
  entity     text not null,
  -- Answers naming it.
  answers    integer not null,
  -- Of those, answers naming the brand too.
  with_brand integer not null
);

create unique index if not exists mentions_entities_daily_key
  on public.mentions_entities_daily (brand_id, day, platform, region, entity)
  nulls not distinct;

create table if not exists public.mentions_terms_daily (
  brand_id uuid not null references public.brands(id) on delete cascade,
  day      date not null,
  platform text not null,
  region   text,
  entity   text not null,
  term     text not null,
  -- Answers whose sentences naming the entity hold the term.
  answers  integer not null
);

-- The entity first: the read joins the shown entities to it.
create unique index if not exists mentions_terms_daily_key
  on public.mentions_terms_daily (brand_id, entity, day, platform, region, term)
  nulls not distinct;

-- Read through mentions_perception (security definer) only.
alter table public.mentions_entities_daily enable row level security;
alter table public.mentions_terms_daily enable row level security;

comment on table public.mentions_entities_daily is
  'Mentions Perception (00231): per brand, UTC day, platform, region and entity, the answers naming it and those naming the brand too. Rebuilt from mentions_answer_terms by refresh_mention_terms_daily.';
comment on table public.mentions_terms_daily is
  'Mentions Perception (00231): per brand, UTC day, platform, region and entity, the answers next to each term among any entity''s 200 most frequent that day, platform and region. Rebuilt from mentions_answer_terms by refresh_mention_terms_daily.';

-- ─── Refresh ────────────────────────────────────────────────────────────────

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
end;
$$;

revoke execute on function public.refresh_mention_terms_daily(uuid, date, date)
  from public, anon, authenticated;

-- 00161's terms refresh, unchanged but for the rollups at its end.

create or replace function public.refresh_mention_terms(
  p_brand_id uuid,
  p_day_from date,
  p_day_to   date
) returns void
language plpgsql
set search_path to 'public'
as $$
declare
  -- The range's bounds as instants, so the answers are found by range.
  v_from timestamptz := p_day_from::timestamp at time zone 'utc';
  v_to   timestamptz := (p_day_to + 1)::timestamp at time zone 'utc';
begin
  -- One refresh per brand at a time, as refresh_mentions_daily (00192): a
  -- run's refresh and the nightly sweep can cover the same days, and the
  -- second insert would fail on the (result_id, entity) key. The lock
  -- releases at commit.
  perform pg_advisory_xact_lock(
    hashtextextended('refresh_mention_terms:' || p_brand_id::text, 0));

  delete from public.mentions_answer_terms
    where brand_id = p_brand_id and created_at >= v_from and created_at < v_to;

  -- The terms next to each entity an answer names, matched by the same names
  -- tracking counts: the brand's name and domains, each competitor's name
  -- and domain.
  with brand_names as (
    select array_remove(array[b.name] || coalesce(
             (select array_agg(bd.domain) from public.brand_domains bd where bd.brand_id = b.id),
             '{}'), null) as names
    from public.brands b
    where b.id = p_brand_id
  ),
  competitor_names as (
    select c.id::text as entity, array_remove(array[c.name, nullif(c.domain, '')], null) as names
    from public.competitors c
    where c.brand_id = p_brand_id
  ),
  name_words as (
    select coalesce(array_agg(distinct w), '{}') as words
    from (
      select regexp_split_to_table(lower(n), '[^[:alnum:]-]+') as w
      from (
        select unnest(names) as n from brand_names
        union all
        select unnest(names) from competitor_names
      ) all_names
    ) split
    where w <> ''
  )
  insert into public.mentions_answer_terms (
    brand_id, result_id, created_at, prompt_id, platform, region, entity, terms)
  select
    p_brand_id, pr.id, pr.created_at, pr.prompt_id, pr.platform, pr.region, e.entity,
    public.mention_terms(
      pr.response,
      e.names,
      (select words from name_words) || regexp_split_to_array(lower(p.text), '[^[:alnum:]-]+'))
  from public.prompt_results pr
  join public.prompts p on p.id = pr.prompt_id
  cross join lateral (
    select 'brand'::text as entity, (select names from brand_names) as names
    where pr.mention_count > 0
    union all
    select cn.entity, cn.names
    from competitor_names cn
    where exists (
      select 1
      from jsonb_array_elements(coalesce(pr.competitor_mentions, '[]'::jsonb)) cm
      where cm.value->>'competitor_id' = cn.entity
        and coalesce((cm.value->>'mention_count')::int, 0) > 0)
  ) e
  where pr.brand_id = p_brand_id
    and pr.prompt_id is not null
    and pr.platform <> 'chatgpt-shopping'
    and pr.created_at >= v_from
    and pr.created_at < v_to;

  -- The Perception tab's daily rollups of the same days (00231), in the
  -- same transaction, so they never lag the terms.
  perform public.refresh_mention_terms_daily(p_brand_id, p_day_from, p_day_to);
end;
$$;

revoke execute on function public.refresh_mention_terms(uuid, date, date)
  from public, anon, authenticated;
