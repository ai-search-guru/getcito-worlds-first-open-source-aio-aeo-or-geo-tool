-- ============================================================================
-- 00192: the Mentions rollups refresh one at a time, and a deleted prompt
--        leaves the Insights rollups
-- ============================================================================
-- Two ways the Insights and Mentions pages could still show different numbers
-- for the same days once they count the same things (00191).
--
-- 1. refresh_mentions_daily (00157) deletes a day range and inserts it again
--    with no lock. A run's refresh and the nightly sweep (or a backfill) for
--    the same brand could overlap: both delete, both insert, and the days
--    they share are counted twice. refresh_insights_daily had the same gap
--    until 00164 (#1020). It now takes the same per-brand advisory lock, rows
--    written twice before are dropped (the copy with the latest answer is
--    kept; the next refresh of those days rewrites them anyway), and unique
--    keys make a second copy impossible.
--
-- 2. Deleting a prompt cascades its prompt_results. The Mentions page drops
--    its rows at read time (it reads existing prompts only), but
--    insights_brand_daily keeps them until something refreshes those days,
--    and the nightly sweep only covers the last 3. A trigger now queues the
--    brand with the deleted prompt's day range (read from
--    insights_prompt_daily before the delete), and the server refreshes that
--    range, as the citation rollups' queue does (00118).

-- ─── One refresh per brand at a time ────────────────────────────────────────

create or replace function public.refresh_mentions_daily(
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
  -- One refresh per brand at a time, as refresh_insights_daily (00164); the
  -- lock releases at commit.
  perform pg_advisory_xact_lock(
    hashtextextended('refresh_mentions_daily:' || p_brand_id::text, 0));

  delete from public.mentions_prompt_daily
    where brand_id = p_brand_id and day between p_day_from and p_day_to;
  delete from public.mentions_competitor_daily
    where brand_id = p_brand_id and day between p_day_from and p_day_to;

  insert into public.mentions_prompt_daily (
    brand_id, day, prompt_id, platform, region,
    answer_count, mention_answers, mention_occurrences,
    positive_answers, negative_answers, position_sum, position_count, last_answer_at)
  select
    p_brand_id,
    (pr.created_at at time zone 'utc')::date,
    pr.prompt_id, pr.platform, pr.region,
    count(*),
    count(*) filter (where pr.mention_count > 0),
    coalesce(sum(pr.mention_count), 0),
    count(*) filter (where pr.mention_count > 0 and pr.sentiment = 'positive'),
    count(*) filter (where pr.mention_count > 0 and pr.sentiment = 'negative'),
    coalesce(sum(pr.mention_position)
      filter (where pr.mention_count > 0 and pr.mention_position is not null), 0),
    count(*) filter (where pr.mention_count > 0 and pr.mention_position is not null),
    max(pr.created_at)
  from public.prompt_results pr
  where pr.brand_id = p_brand_id
    and pr.prompt_id is not null
    and pr.platform <> 'chatgpt-shopping'
    and pr.created_at >= v_from
    and pr.created_at < v_to
  group by 2, pr.prompt_id, pr.platform, pr.region;

  insert into public.mentions_competitor_daily (
    brand_id, day, prompt_id, platform, region, competitor_id,
    mention_answers, co_mention_answers)
  select
    p_brand_id,
    (pr.created_at at time zone 'utc')::date,
    pr.prompt_id, pr.platform, pr.region,
    cm.value->>'competitor_id',
    count(*),
    count(*) filter (where pr.mention_count > 0)
  from public.prompt_results pr
  cross join lateral jsonb_array_elements(coalesce(pr.competitor_mentions, '[]'::jsonb)) cm
  where pr.brand_id = p_brand_id
    and pr.prompt_id is not null
    and pr.platform <> 'chatgpt-shopping'
    and pr.created_at >= v_from
    and pr.created_at < v_to
    and cm.value ? 'competitor_id'
    and coalesce((cm.value->>'mention_count')::int, 0) > 0
  group by 2, pr.prompt_id, pr.platform, pr.region, cm.value->>'competitor_id';
end;
$$;

revoke execute on function public.refresh_mentions_daily(uuid, date, date)
  from public, anon, authenticated;

-- ─── Rows written twice ─────────────────────────────────────────────────────

delete from public.mentions_prompt_daily d
using (
  select ctid,
         row_number() over (
           partition by brand_id, day, prompt_id, platform, region
           order by last_answer_at desc, answer_count desc) as n
  from public.mentions_prompt_daily
) x
where d.ctid = x.ctid and x.n > 1;

delete from public.mentions_competitor_daily d
using (
  select ctid,
         row_number() over (
           partition by brand_id, day, prompt_id, platform, region, competitor_id
           order by mention_answers desc) as n
  from public.mentions_competitor_daily
) x
where d.ctid = x.ctid and x.n > 1;

-- On large tables, build these by hand first with `create unique index
-- concurrently`, which doesn't hold back the refreshes; these statements then
-- find them in place. A null platform or region is one key, not many.
create unique index if not exists mentions_prompt_daily_key
  on public.mentions_prompt_daily (brand_id, day, prompt_id, platform, region)
  nulls not distinct;

create unique index if not exists mentions_competitor_daily_key
  on public.mentions_competitor_daily (brand_id, day, prompt_id, platform, region, competitor_id)
  nulls not distinct;

-- ─── A deleted prompt queues its days ───────────────────────────────────────

-- No foreign key on purpose, as citation_rollup_rebuilds: a brand delete must
-- never fail on it. A brand gone by the time the server reads its entry has
-- no rows left, so the refresh is a no-op and the entry is cleared.
create table if not exists public.insights_rollup_rebuilds (
  brand_id     uuid primary key,
  day_from     date not null,
  day_to       date not null,
  requested_at timestamptz not null default now()
);

-- Service role only: no policies.
alter table public.insights_rollup_rebuilds enable row level security;

-- Before the delete, so the prompt's rows are still there to give its days.
create or replace function public.queue_insights_rollup_rebuild()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_brand uuid;
  v_from  date;
  v_to    date;
begin
  -- Only for a brand that still exists: during a brand delete the cascade
  -- removes the brand first, so its prompts queue nothing.
  select ps.brand_id into v_brand
  from public.prompt_sets ps
  join public.brands b on b.id = ps.brand_id
  where ps.id = old.prompt_set_id;
  if v_brand is null then
    return old;
  end if;

  select min(d.day), max(d.day) into v_from, v_to
  from public.insights_prompt_daily d
  where d.brand_id = v_brand and d.prompt_id = old.id;
  if v_from is null then
    return old;
  end if;

  insert into public.insights_rollup_rebuilds as q (brand_id, day_from, day_to)
  values (v_brand, v_from, v_to)
  on conflict (brand_id) do update
    set day_from = least(q.day_from, excluded.day_from),
        day_to = greatest(q.day_to, excluded.day_to),
        requested_at = now();
  return old;
end;
$$;

revoke execute on function public.queue_insights_rollup_rebuild()
  from public, anon, authenticated;

drop trigger if exists prompts_queue_insights_rollup_rebuild on public.prompts;
create trigger prompts_queue_insights_rollup_rebuild
  before delete on public.prompts
  for each row execute function public.queue_insights_rollup_rebuild();

notify pgrst, 'reload schema';
