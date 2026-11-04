-- Mentions & Sentiment (MS-04): where AI names the brand, the tone of those
-- answers, and the competitors named beside it, for any window, without
-- re-reading every answer on each page load.
--
-- Tracking already stores what the page needs on each answer (prompt_results):
-- mention_count (how often the brand is named), mention_position (where among
-- the brands it is named, 00038), competitor_mentions (each competitor's
-- count) and sentiment (the answer's tone toward the brand; set only when the
-- brand is named). Opening the page or changing a filter therefore never
-- calls an LLM: every number is an aggregation of those columns.
--
-- Two daily rollups, refreshed the way the Insights and Citations rollups are
-- (backend/src/lib/mentionsRollups.js): when a run's ledger row is stamped,
-- by the nightly sweep for the trailing days, and once over each brand's
-- history by backend/src/scripts/backfillMentionsDaily.js.
--
--   * mentions_prompt_daily, one row per (UTC day, prompt, platform, region):
--     the answers, the answers naming the brand ("mentions": an answer naming
--     it twice is one mention), the occurrences, the positive and negative
--     answers among the mentions (neutral is the rest, never dropped), and the
--     brand's positions. The prompt grain lets the page filter by topic and
--     search prompts, and count prompts with mentions, from the rollup.
--   * mentions_competitor_daily, one row per (day, prompt, platform, region,
--     competitor) where the competitor is named: the answers naming it, and
--     those naming the brand too ("in the same answer as you"). Sparse.
--
-- A prompt keeps its history under the topic it is in now: the topic is read
-- from prompts at query time, so a topic move needs no rebuild.
-- chatgpt-shopping stays out, as in every rollup (#155).
--
-- mentions_overview reads a window. As topics_overview_window (00156) does,
-- a window under two days (24 hours) reads its answers, and the previous
-- window's, directly: today's run may not be in the rollups yet, and a day of
-- answers is a small read. A longer window reads whole UTC days counted back
-- from its end. Like 00147–00156 it is plpgsql with force_custom_plan, so
-- each call is planned with its real window (and the branch it doesn't take
-- is pruned), and security definer with the organization check made
-- explicit, returning null to a caller outside the brand's organization.

-- ─── Tables ─────────────────────────────────────────────────────────────────

create table if not exists public.mentions_prompt_daily (
  brand_id            uuid not null references public.brands(id) on delete cascade,
  day                 date not null,
  prompt_id           uuid not null,
  platform            text,
  region              text,
  answer_count        integer not null,
  -- Answers naming the brand at least once.
  mention_answers     integer not null,
  -- Times the brand is named, over all answers.
  mention_occurrences bigint not null,
  -- Tone of the answers naming the brand; neutral is the rest.
  positive_answers    integer not null,
  negative_answers    integer not null,
  -- The brand's position among the brands an answer names (1 = first).
  position_sum        bigint not null,
  position_count      integer not null,
  last_answer_at      timestamptz not null
);

create index if not exists idx_mentions_prompt_daily_brand_day
  on public.mentions_prompt_daily (brand_id, day);

create table if not exists public.mentions_competitor_daily (
  brand_id           uuid not null references public.brands(id) on delete cascade,
  day                date not null,
  prompt_id          uuid not null,
  platform           text,
  region             text,
  -- Text, as in the competitor_mentions payload and the Insights rollups.
  competitor_id      text not null,
  -- Answers naming the competitor.
  mention_answers    integer not null,
  -- Of those, the answers naming the brand too.
  co_mention_answers integer not null
);

create index if not exists idx_mentions_competitor_daily_brand_day
  on public.mentions_competitor_daily (brand_id, day);

-- ─── RLS — same shape as prompt_results ─────────────────────────────────────

alter table public.mentions_prompt_daily enable row level security;
alter table public.mentions_competitor_daily enable row level security;

create policy "Users can read own org mention rollups"
  on public.mentions_prompt_daily for select
  using (brand_id in (
    select b.id from public.brands b
    join public.profiles p on p.organization_id = b.organization_id
    where p.id = auth.uid()));

create policy "Users can read own org competitor mention rollups"
  on public.mentions_competitor_daily for select
  using (brand_id in (
    select b.id from public.brands b
    join public.profiles p on p.organization_id = b.organization_id
    where p.id = auth.uid()));

-- ─── Refresh ────────────────────────────────────────────────────────────────
-- Recomputes a brand's mention rollups for an inclusive UTC day range from
-- prompt_results: delete + insert in one transaction, so it is idempotent
-- and readers never see a half-refreshed day. Service-role only.

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

-- ─── Read ───────────────────────────────────────────────────────────────────
-- The Overview's figures for a window and the window of the same length just
-- before it, in one call:
--   current / previous  answers, mentions, occurrences, positive, negative,
--                       position_sum / position_count, prompts (answered),
--                       prompts_with_mentions, last_answer_at
--   platforms           the same per platform, current and prev_*
--   daily               per UTC day of the window: answers, mentions,
--                       positive, negative
--   competitors         every configured competitor: mentions (answers naming
--                       it), co_mentions (also naming the brand),
--                       prev_mentions
-- Filters: platform, region, topic, and a case-insensitive search over the
-- prompt's text.

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
           coalesce(sum(positive) filter (where cur), 0)::bigint      as positive,
           coalesce(sum(negative) filter (where cur), 0)::bigint      as negative,
           coalesce(sum(answers)  filter (where not cur), 0)::bigint  as prev_answers,
           coalesce(sum(mentions) filter (where not cur), 0)::bigint  as prev_mentions,
           coalesce(sum(positive) filter (where not cur), 0)::bigint  as prev_positive,
           coalesce(sum(negative) filter (where not cur), 0)::bigint  as prev_negative
    from facts
    group by platform
  ),
  daily as (
    select day,
           sum(answers)::bigint  as answers,
           sum(mentions)::bigint as mentions,
           sum(positive)::bigint as positive,
           sum(negative)::bigint as negative
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
    'platforms',   coalesce((select jsonb_agg(to_jsonb(p) order by p.mentions desc, p.platform)
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

revoke execute on function public.mentions_overview(uuid, timestamptz, timestamptz, text, text, uuid, text)
  from public, anon;
grant execute on function public.mentions_overview(uuid, timestamptz, timestamptz, text, text, uuid, text)
  to authenticated, service_role;
