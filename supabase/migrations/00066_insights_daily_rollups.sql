-- Insights stops recomputing history on every page load.
--
-- The Insights aggregate RPCs scan every prompt_results row a brand has ever
-- produced and explode competitor_mentions jsonb on the fly — 566,908 array
-- elements for the largest brand. Under the authenticated role's 8s
-- statement_timeout, competitor_aggregates takes 9.7s on that brand's
-- all-time window, so 30d/90d/all render as an opaque server error. The cost
-- grows with accumulated history: rewriting the query buys weeks, not a fix.
--
-- These tables invert the work. Each brand-day is aggregated ONCE — when the
-- brand's tracking run completes (the same drain point Daily Pulse waits on),
-- with a daily catch-up sweep as backstop — and the page reads the daily
-- rows. Read cost then scales with days in the window, never with results.
--
-- Grain: (day, model_used, platform, region), because those are exactly the
-- page's filter dimensions. Two extra tables carry the prompt dimension: the
-- leaderboard's rate is COUNT(DISTINCT prompt_id) over the window, which
-- cannot be summed across days. insights_prompt_daily mirrors one row per
-- answered (prompt, engine, day); insights_competitor_prompt_daily keeps only
-- VISIBLE competitor sightings — 9.4% of elements on the largest brand
-- (53,331 of 566,908) — so the distinct-count input stays small.
--
-- Two deliberate semantic carriers, verified against the live definitions:
--   * share_of_voice_aggregates counts competitor mentions WITHOUT a join to
--     competitors (deleted competitors included); competitor_aggregates and
--     ai_visibility_aggregates filter to live competitors. The rollups store
--     every competitor_id seen in the jsonb, and the liveness join is applied
--     by the read functions that had it — parity for both, and a competitor
--     deleted tomorrow disappears from reads without touching stored rows.
--   * Topic- and prompt-filtered calls stay on the raw RPCs: topic is a live
--     prompt attribute (reassignment must move history with it), and both
--     filters cut the scanned set far below the danger line.
--
-- The old RPCs are left untouched — MCP, reports and pulse call them under
-- the service role, which has no statement timeout. Only day-window reads
-- move here.

-- ─── Tables ─────────────────────────────────────────────────────────────────

-- Brand-side additive measures. One row per (day, engine, region).
create table if not exists public.insights_brand_daily (
  brand_id               uuid not null references public.brands(id) on delete cascade,
  day                    date not null,
  model_used             text,
  platform               text,
  region                 text,
  answer_count           integer not null,
  mention_answers        integer not null,
  citation_answers       integer not null,
  -- mention OR citation — not derivable from the two columns above.
  mentioning_answers     integer not null,
  sum_visibility         numeric not null,
  -- SUM(visibility_score) over mentioning answers only (visible_prompt_stats).
  sum_visibility_visible numeric not null,
  total_mentions         bigint not null,
  total_citations        bigint not null,
  positive_count         integer not null,
  -- AVG(1.0/mention_position) folds as sum/count across any window.
  sum_inv_position       numeric,
  position_count         integer not null,
  max_created_at         timestamptz not null
);

create index if not exists idx_insights_brand_daily_brand_day
  on public.insights_brand_daily (brand_id, day);

-- Per-competitor additive measures. Dense: every competitor_id present in an
-- answer's jsonb gets a row, zeros included, because the comparison table
-- shows a row (and an answer count) even for a competitor never mentioned.
create table if not exists public.insights_competitor_daily (
  brand_id         uuid not null references public.brands(id) on delete cascade,
  day              date not null,
  -- Text, not uuid: it mirrors the jsonb payload verbatim, and the read
  -- functions echo it back as the old RPCs did.
  competitor_id    text not null,
  model_used       text,
  platform         text,
  region           text,
  answer_count     integer not null,
  sum_visibility   numeric,
  total_mentions   bigint not null,
  total_citations  bigint not null,
  mention_answers  integer not null,
  citation_answers integer not null,
  sum_inv_position numeric,
  position_count   integer not null
);

create index if not exists idx_insights_competitor_daily_brand_day
  on public.insights_competitor_daily (brand_id, day);

-- One row per answered (prompt, engine, region, day) — the input for every
-- COUNT(DISTINCT prompt_id) the page shows. The widest of the four tables,
-- but each row is a few booleans; the largest brand adds ~1,800/day.
create table if not exists public.insights_prompt_daily (
  brand_id     uuid not null references public.brands(id) on delete cascade,
  day          date not null,
  prompt_id    uuid not null,
  model_used   text,
  platform     text,
  region       text,
  answer_count integer not null,
  has_mention  boolean not null,
  has_citation boolean not null
);

create index if not exists idx_insights_prompt_daily_brand_day
  on public.insights_prompt_daily (brand_id, day);

-- Visible competitor sightings only: (competitor, prompt, engine, day) rows
-- where the competitor was actually mentioned, cited or scored. Existence is
-- the datum — the per-competitor visible-prompt distinct counts read this.
create table if not exists public.insights_competitor_prompt_daily (
  brand_id      uuid not null references public.brands(id) on delete cascade,
  day           date not null,
  competitor_id text not null,
  prompt_id     uuid not null,
  model_used    text,
  platform      text,
  region        text
);

create index if not exists idx_insights_competitor_prompt_daily_brand_day
  on public.insights_competitor_prompt_daily (brand_id, day);

-- ─── RLS — same shape as prompt_results ─────────────────────────────────────

alter table public.insights_brand_daily enable row level security;
alter table public.insights_competitor_daily enable row level security;
alter table public.insights_prompt_daily enable row level security;
alter table public.insights_competitor_prompt_daily enable row level security;

create policy "Users can read own org insights rollups"
  on public.insights_brand_daily for select
  using (brand_id in (
    select b.id from public.brands b
    join public.profiles p on p.organization_id = b.organization_id
    where p.id = auth.uid()));

create policy "Users can read own org competitor rollups"
  on public.insights_competitor_daily for select
  using (brand_id in (
    select b.id from public.brands b
    join public.profiles p on p.organization_id = b.organization_id
    where p.id = auth.uid()));

create policy "Users can read own org prompt rollups"
  on public.insights_prompt_daily for select
  using (brand_id in (
    select b.id from public.brands b
    join public.profiles p on p.organization_id = b.organization_id
    where p.id = auth.uid()));

create policy "Users can read own org competitor prompt rollups"
  on public.insights_competitor_prompt_daily for select
  using (brand_id in (
    select b.id from public.brands b
    join public.profiles p on p.organization_id = b.organization_id
    where p.id = auth.uid()));

-- ─── Refresh ────────────────────────────────────────────────────────────────

-- Recomputes a brand's rollup rows for a day range from prompt_results.
-- Delete + insert in one transaction: idempotent by construction (no upsert
-- arbiter needed, so NULL dimension values need no synthetic encoding), and
-- readers never see a half-refreshed day. Day-scoped, so the jsonb explode
-- that makes the read path unaffordable stays cheap here: one day of the
-- largest brand is ~1,800 answers.
--
-- Service-role only. The web tier must never trigger writes; execute is
-- revoked from anon/authenticated below.
create or replace function public.refresh_insights_daily(
  p_brand_id uuid,
  p_day_from date,
  p_day_to date
) returns void
language plpgsql
set search_path to 'public'
as $$
begin
  delete from public.insights_brand_daily
    where brand_id = p_brand_id and day between p_day_from and p_day_to;
  delete from public.insights_competitor_daily
    where brand_id = p_brand_id and day between p_day_from and p_day_to;
  delete from public.insights_prompt_daily
    where brand_id = p_brand_id and day between p_day_from and p_day_to;
  delete from public.insights_competitor_prompt_daily
    where brand_id = p_brand_id and day between p_day_from and p_day_to;

  insert into public.insights_brand_daily (
    brand_id, day, model_used, platform, region,
    answer_count, mention_answers, citation_answers, mentioning_answers,
    sum_visibility, sum_visibility_visible, total_mentions, total_citations,
    positive_count, sum_inv_position, position_count, max_created_at)
  select
    p_brand_id,
    (pr.created_at at time zone 'utc')::date,
    pr.model_used, pr.platform, pr.region,
    count(*),
    count(*) filter (where pr.mention_count > 0),
    count(*) filter (where pr.citation_count > 0),
    count(*) filter (where pr.mention_count > 0 or pr.citation_count > 0),
    coalesce(sum(pr.visibility_score), 0),
    coalesce(sum(pr.visibility_score)
      filter (where pr.mention_count > 0 or pr.citation_count > 0), 0),
    coalesce(sum(pr.mention_count), 0),
    coalesce(sum(pr.citation_count), 0),
    count(*) filter (where pr.sentiment = 'positive'),
    sum(1.0 / pr.mention_position) filter (where pr.mention_position is not null),
    count(*) filter (where pr.mention_position is not null),
    max(pr.created_at)
  from public.prompt_results pr
  where pr.brand_id = p_brand_id
    and pr.platform <> 'chatgpt-shopping'  -- #155 — isolate from Insights
    and (pr.created_at at time zone 'utc')::date between p_day_from and p_day_to
  group by 2, pr.model_used, pr.platform, pr.region;

  insert into public.insights_prompt_daily (
    brand_id, day, prompt_id, model_used, platform, region,
    answer_count, has_mention, has_citation)
  select
    p_brand_id,
    (pr.created_at at time zone 'utc')::date,
    pr.prompt_id, pr.model_used, pr.platform, pr.region,
    count(*),
    bool_or(pr.mention_count > 0),
    bool_or(pr.citation_count > 0)
  from public.prompt_results pr
  where pr.brand_id = p_brand_id
    and pr.prompt_id is not null
    and pr.platform <> 'chatgpt-shopping'
    and (pr.created_at at time zone 'utc')::date between p_day_from and p_day_to
  group by 2, pr.prompt_id, pr.model_used, pr.platform, pr.region;

  insert into public.insights_competitor_daily (
    brand_id, day, competitor_id, model_used, platform, region,
    answer_count, sum_visibility, total_mentions, total_citations,
    mention_answers, citation_answers, sum_inv_position, position_count)
  select
    p_brand_id,
    (pr.created_at at time zone 'utc')::date,
    cm.value->>'competitor_id',
    pr.model_used, pr.platform, pr.region,
    count(*),
    sum((cm.value->>'visibility_score')::numeric),
    coalesce(sum(coalesce((cm.value->>'mention_count')::int, 0)), 0),
    coalesce(sum(coalesce((cm.value->>'citation_count')::int, 0)), 0),
    count(*) filter (where coalesce((cm.value->>'mention_count')::int, 0) > 0),
    count(*) filter (where coalesce((cm.value->>'citation_count')::int, 0) > 0),
    sum(1.0 / (cm.value->>'mention_position')::numeric)
      filter (where (cm.value->>'mention_position') is not null),
    count(*) filter (where (cm.value->>'mention_position') is not null)
  from public.prompt_results pr,
       lateral jsonb_array_elements(coalesce(pr.competitor_mentions, '[]'::jsonb)) cm
  where pr.brand_id = p_brand_id
    and pr.platform <> 'chatgpt-shopping'
    and (pr.created_at at time zone 'utc')::date between p_day_from and p_day_to
    and cm.value ? 'competitor_id'
  group by 2, cm.value->>'competitor_id', pr.model_used, pr.platform, pr.region;

  insert into public.insights_competitor_prompt_daily (
    brand_id, day, competitor_id, prompt_id, model_used, platform, region)
  select distinct
    p_brand_id,
    (pr.created_at at time zone 'utc')::date,
    cm.value->>'competitor_id',
    pr.prompt_id, pr.model_used, pr.platform, pr.region
  from public.prompt_results pr,
       lateral jsonb_array_elements(coalesce(pr.competitor_mentions, '[]'::jsonb)) cm
  where pr.brand_id = p_brand_id
    and pr.prompt_id is not null
    and pr.platform <> 'chatgpt-shopping'
    and (pr.created_at at time zone 'utc')::date between p_day_from and p_day_to
    and cm.value ? 'competitor_id'
    and (coalesce((cm.value->>'mention_count')::int, 0) > 0
      or coalesce((cm.value->>'citation_count')::int, 0) > 0
      or coalesce((cm.value->>'visibility_score')::numeric, 0) > 0);
end;
$$;

revoke execute on function public.refresh_insights_daily(uuid, date, date)
  from public, anon, authenticated;

-- ─── Read functions ─────────────────────────────────────────────────────────
--
-- Each mirrors its raw counterpart's payload byte for byte — same keys, same
-- ordering clauses — so the web mapping code cannot tell which one answered,
-- and the cutover can be shadow-verified by diffing the two outputs. All are
-- SECURITY INVOKER: the caller's RLS on the rollup tables scopes the read,
-- exactly as the raw RPCs lean on prompt_results RLS.
--
-- Windows are whole days (p_day_from .. p_day_to inclusive, UTC), which is
-- what makes the rollup readable at all. The one caller-visible consequence —
-- a preset window covers calendar days instead of sliding with the clock —
-- is deliberate: numbers move once per completed run instead of drifting
-- within the day.

-- insights_aggregates over rollups.
create or replace function public.insights_aggregates_daily(
  p_brand_id uuid,
  p_platform text default null,
  p_models text[] default null,
  p_region text default null,
  p_day_from date default null,
  p_day_to date default null
) returns jsonb
language sql
stable
set search_path to 'public'
as $$
  with filtered as (
    select * from public.insights_brand_daily d
    where d.brand_id = p_brand_id
      and (p_platform is null or d.platform = p_platform)
      and (p_models is null or d.model_used = any (p_models))
      and (p_region is null or d.region = p_region)
      and (p_day_from is null or d.day >= p_day_from)
      and (p_day_to is null or d.day <= p_day_to)
  ),
  totals as (
    select
      coalesce(sum(answer_count), 0)       as total_results,
      coalesce(sum(sum_visibility), 0)     as sum_visibility,
      coalesce(sum(total_mentions), 0)     as total_mentions,
      coalesce(sum(total_citations), 0)    as total_citations,
      coalesce(sum(positive_count), 0)     as positive_count,
      coalesce(sum(mentioning_answers), 0) as mentioning_results,
      max(max_created_at)                  as last_checked_at
    from filtered
  ),
  by_model as (
    select
      coalesce(model_used, 'unknown') as model_used,
      sum(sum_visibility)             as sum_visibility,
      sum(answer_count)               as result_count
    from filtered
    group by coalesce(model_used, 'unknown')
  )
  select jsonb_build_object(
    'total_results',      t.total_results,
    'sum_visibility',     t.sum_visibility,
    'total_mentions',     t.total_mentions,
    'total_citations',    t.total_citations,
    'positive_count',     t.positive_count,
    'mentioning_results', t.mentioning_results,
    'last_checked_at',    t.last_checked_at,
    'by_model', coalesce(
      (select jsonb_agg(jsonb_build_object(
                'model_used',     bm.model_used,
                'sum_visibility', bm.sum_visibility,
                'result_count',   bm.result_count)
              order by bm.result_count desc, bm.model_used)
       from by_model bm),
      '[]'::jsonb)
  )
  from totals t;
$$;

-- visible_prompt_stats over rollups.
create or replace function public.visible_prompt_stats_daily(
  p_brand_id uuid,
  p_platform text default null,
  p_models text[] default null,
  p_region text default null,
  p_day_from date default null,
  p_day_to date default null
) returns jsonb
language sql
stable
set search_path to 'public'
as $$
  select jsonb_build_object(
    'visible_prompts',
      (select count(distinct pd.prompt_id)
       from public.insights_prompt_daily pd
       where pd.brand_id = p_brand_id
         and (pd.has_mention or pd.has_citation)
         and (p_platform is null or pd.platform = p_platform)
         and (p_models is null or pd.model_used = any (p_models))
         and (p_region is null or pd.region = p_region)
         and (p_day_from is null or pd.day >= p_day_from)
         and (p_day_to is null or pd.day <= p_day_to)),
    'visible_results',
      coalesce((select sum(bd.mentioning_answers)
       from public.insights_brand_daily bd
       where bd.brand_id = p_brand_id
         and (p_platform is null or bd.platform = p_platform)
         and (p_models is null or bd.model_used = any (p_models))
         and (p_region is null or bd.region = p_region)
         and (p_day_from is null or bd.day >= p_day_from)
         and (p_day_to is null or bd.day <= p_day_to)), 0),
    'sum_visibility_visible',
      coalesce((select sum(bd.sum_visibility_visible)
       from public.insights_brand_daily bd
       where bd.brand_id = p_brand_id
         and (p_platform is null or bd.platform = p_platform)
         and (p_models is null or bd.model_used = any (p_models))
         and (p_region is null or bd.region = p_region)
         and (p_day_from is null or bd.day >= p_day_from)
         and (p_day_to is null or bd.day <= p_day_to)), 0)
  );
$$;

-- tracked_prompt_count over rollups.
create or replace function public.tracked_prompt_count_daily(
  p_brand_id uuid,
  p_platform text default null,
  p_models text[] default null,
  p_region text default null,
  p_day_from date default null,
  p_day_to date default null
) returns integer
language sql
stable
set search_path to 'public'
as $$
  select count(distinct pd.prompt_id)::integer
  from public.insights_prompt_daily pd
  where pd.brand_id = p_brand_id
    and (p_platform is null or pd.platform = p_platform)
    and (p_models is null or pd.model_used = any (p_models))
    and (p_region is null or pd.region = p_region)
    and (p_day_from is null or pd.day >= p_day_from)
    and (p_day_to is null or pd.day <= p_day_to)
$$;

-- ai_visibility_aggregates over rollups. Liveness join preserved: only
-- competitors that still exist appear, exactly like the raw RPC's EXISTS.
-- Names come from competitors.name (live) rather than the jsonb snapshot the
-- raw RPC MAX()es over — a renamed competitor shows its current name.
create or replace function public.ai_visibility_aggregates_daily(
  p_brand_id uuid,
  p_platform text default null,
  p_models text[] default null,
  p_region text default null,
  p_day_from date default null,
  p_day_to date default null
) returns jsonb
language sql
stable
set search_path to 'public'
as $$
  with brand_agg as (
    select
      coalesce(sum(answer_count), 0)    as answers,
      coalesce(sum(mention_answers), 0) as mention_answers,
      coalesce(sum(citation_answers), 0) as citation_answers,
      sum(sum_inv_position) / nullif(sum(position_count), 0) as position_factor
    from public.insights_brand_daily d
    where d.brand_id = p_brand_id
      and (p_platform is null or d.platform = p_platform)
      and (p_models is null or d.model_used = any (p_models))
      and (p_region is null or d.region = p_region)
      and (p_day_from is null or d.day >= p_day_from)
      and (p_day_to is null or d.day <= p_day_to)
  ),
  comp_agg as (
    select
      cd.competitor_id,
      max(c.name)                as name,
      sum(cd.mention_answers)    as mention_answers,
      sum(cd.citation_answers)   as citation_answers,
      sum(cd.sum_inv_position) / nullif(sum(cd.position_count), 0) as position_factor
    from public.insights_competitor_daily cd
    join public.competitors c
      on c.id::text = cd.competitor_id and c.brand_id = p_brand_id
    where cd.brand_id = p_brand_id
      and (p_platform is null or cd.platform = p_platform)
      and (p_models is null or cd.model_used = any (p_models))
      and (p_region is null or cd.region = p_region)
      and (p_day_from is null or cd.day >= p_day_from)
      and (p_day_to is null or cd.day <= p_day_to)
    group by cd.competitor_id
  )
  select jsonb_build_object(
    'answers',          b.answers,
    'mention_answers',  b.mention_answers,
    'citation_answers', b.citation_answers,
    'position_factor',  b.position_factor,
    'by_competitor', coalesce(
      (select jsonb_agg(jsonb_build_object(
                'competitor_id',    ca.competitor_id,
                'name',             ca.name,
                'mention_answers',  ca.mention_answers,
                'citation_answers', ca.citation_answers,
                'position_factor',  ca.position_factor)
              order by ca.mention_answers desc, ca.competitor_id)
       from comp_agg ca),
      '[]'::jsonb)
  )
  from brand_agg b;
$$;

-- competitor_aggregates over rollups. The distinct-prompt counts read the two
-- prompt-grain tables; everything additive reads the day-grain ones. Engine
-- keys join with IS NOT DISTINCT FROM because model_used can be null.
create or replace function public.competitor_aggregates_daily(
  p_brand_id uuid,
  p_platform text default null,
  p_models text[] default null,
  p_region text default null,
  p_day_from date default null,
  p_day_to date default null
) returns jsonb
language sql
stable
set search_path to 'public'
as $$
  with brand_days as (
    select * from public.insights_brand_daily d
    where d.brand_id = p_brand_id
      and (p_platform is null or d.platform = p_platform)
      and (p_models is null or d.model_used = any (p_models))
      and (p_region is null or d.region = p_region)
      and (p_day_from is null or d.day >= p_day_from)
      and (p_day_to is null or d.day <= p_day_to)
  ),
  prompt_days as (
    select * from public.insights_prompt_daily d
    where d.brand_id = p_brand_id
      and (p_platform is null or d.platform = p_platform)
      and (p_models is null or d.model_used = any (p_models))
      and (p_region is null or d.region = p_region)
      and (p_day_from is null or d.day >= p_day_from)
      and (p_day_to is null or d.day <= p_day_to)
  ),
  comp_days as (
    select cd.* from public.insights_competitor_daily cd
    join public.competitors c
      on c.id::text = cd.competitor_id and c.brand_id = p_brand_id
    where cd.brand_id = p_brand_id
      and (p_platform is null or cd.platform = p_platform)
      and (p_models is null or cd.model_used = any (p_models))
      and (p_region is null or cd.region = p_region)
      and (p_day_from is null or cd.day >= p_day_from)
      and (p_day_to is null or cd.day <= p_day_to)
  ),
  comp_prompt_days as (
    select cpd.* from public.insights_competitor_prompt_daily cpd
    join public.competitors c
      on c.id::text = cpd.competitor_id and c.brand_id = p_brand_id
    where cpd.brand_id = p_brand_id
      and (p_platform is null or cpd.platform = p_platform)
      and (p_models is null or cpd.model_used = any (p_models))
      and (p_region is null or cpd.region = p_region)
      and (p_day_from is null or cpd.day >= p_day_from)
      and (p_day_to is null or cpd.day <= p_day_to)
  ),
  brand_totals as (
    select
      coalesce((select sum(answer_count) from brand_days), 0)    as row_count,
      coalesce((select sum(sum_visibility) from brand_days), 0)  as sum_visibility,
      coalesce((select sum(total_mentions) from brand_days), 0)  as total_mentions,
      coalesce((select sum(total_citations) from brand_days), 0) as total_citations,
      (select count(distinct prompt_id) from prompt_days)        as prompt_count,
      (select count(distinct prompt_id) from prompt_days
        where has_mention or has_citation)                       as visible_prompts
  ),
  by_brand_provider as (
    select b.model_used, b.platform, b.sum_visibility, b.row_count,
           p.prompt_count, p.visible_prompts
    from (
      select model_used, platform,
             sum(sum_visibility) as sum_visibility,
             sum(answer_count)   as row_count
      from brand_days group by model_used, platform
    ) b
    join (
      select model_used, platform,
             count(distinct prompt_id) as prompt_count,
             count(distinct prompt_id)
               filter (where has_mention or has_citation) as visible_prompts
      from prompt_days group by model_used, platform
    ) p on p.model_used is not distinct from b.model_used
       and p.platform is not distinct from b.platform
  ),
  -- Grouped once each, then joined — a correlated subselect here rescans
  -- comp_prompt_days per output group (13 + ~119 of them), which measured
  -- 1.6s on the largest brand's all-time window against ~100ms this way.
  visible_by_comp as (
    select competitor_id, count(distinct prompt_id) as visible_prompts
    from comp_prompt_days group by competitor_id
  ),
  visible_by_comp_engine as (
    select competitor_id, model_used, platform,
           count(distinct prompt_id) as visible_prompts
    from comp_prompt_days group by competitor_id, model_used, platform
  ),
  by_competitor as (
    select
      cd.competitor_id,
      max(c.name)               as name,
      sum(cd.sum_visibility)    as sum_visibility,
      sum(cd.answer_count)      as row_count,
      coalesce(sum(cd.total_mentions), 0)::bigint  as total_mentions,
      coalesce(sum(cd.total_citations), 0)::bigint as total_citations,
      coalesce(max(v.visible_prompts), 0)          as visible_prompts
    from comp_days cd
    join public.competitors c
      on c.id::text = cd.competitor_id and c.brand_id = p_brand_id
    left join visible_by_comp v on v.competitor_id = cd.competitor_id
    group by cd.competitor_id
  ),
  by_competitor_provider as (
    select
      cd.model_used, cd.platform, cd.competitor_id,
      max(c.name)                         as competitor_name,
      sum(cd.sum_visibility)              as sum_visibility,
      sum(cd.answer_count)                as row_count,
      coalesce(max(v.visible_prompts), 0) as visible_prompts
    from comp_days cd
    join public.competitors c
      on c.id::text = cd.competitor_id and c.brand_id = p_brand_id
    left join visible_by_comp_engine v
      on v.competitor_id = cd.competitor_id
     and v.model_used is not distinct from cd.model_used
     and v.platform is not distinct from cd.platform
    group by cd.model_used, cd.platform, cd.competitor_id
  )
  select jsonb_build_object(
    'brand_row_count',       b.row_count,
    'brand_sum_visibility',  b.sum_visibility,
    'brand_total_mentions',  b.total_mentions,
    'brand_total_citations', b.total_citations,
    'brand_prompt_count',    b.prompt_count,
    'brand_visible_prompts', b.visible_prompts,
    'by_competitor', coalesce(
      (select jsonb_agg(jsonb_build_object(
                'competitor_id',   bc.competitor_id,
                'name',            bc.name,
                'sum_visibility',  bc.sum_visibility,
                'row_count',       bc.row_count,
                'total_mentions',  bc.total_mentions,
                'total_citations', bc.total_citations,
                'visible_prompts', bc.visible_prompts)
              order by bc.row_count desc, bc.competitor_id)
       from by_competitor bc),
      '[]'::jsonb),
    'by_brand_provider', coalesce(
      (select jsonb_agg(jsonb_build_object(
                'model_used',      bbp.model_used,
                'platform',        bbp.platform,
                'sum_visibility',  bbp.sum_visibility,
                'row_count',       bbp.row_count,
                'prompt_count',    bbp.prompt_count,
                'visible_prompts', bbp.visible_prompts)
              order by bbp.platform nulls last, bbp.model_used nulls last)
       from by_brand_provider bbp),
      '[]'::jsonb),
    'by_competitor_provider', coalesce(
      (select jsonb_agg(jsonb_build_object(
                'model_used',      bcp.model_used,
                'platform',        bcp.platform,
                'competitor_id',   bcp.competitor_id,
                'competitor_name', bcp.competitor_name,
                'sum_visibility',  bcp.sum_visibility,
                'row_count',       bcp.row_count,
                'visible_prompts', bcp.visible_prompts)
              order by bcp.platform nulls last, bcp.model_used nulls last, bcp.competitor_id)
       from by_competitor_provider bcp),
      '[]'::jsonb)
  )
  from brand_totals b;
$$;

-- share_of_voice_aggregates over rollups. No competitors join anywhere — the
-- raw RPC sums every jsonb element regardless of liveness, and SoV parity
-- means keeping that.
create or replace function public.share_of_voice_aggregates_daily(
  p_brand_id uuid,
  p_platform text default null,
  p_models text[] default null,
  p_region text default null,
  p_day_from date default null,
  p_day_to date default null
) returns jsonb
language sql
stable
set search_path to 'public'
as $$
  with brand_days as (
    select * from public.insights_brand_daily d
    where d.brand_id = p_brand_id
      and (p_platform is null or d.platform = p_platform)
      and (p_models is null or d.model_used = any (p_models))
      and (p_region is null or d.region = p_region)
      and (p_day_from is null or d.day >= p_day_from)
      and (p_day_to is null or d.day <= p_day_to)
  ),
  comp_days as (
    select * from public.insights_competitor_daily d
    where d.brand_id = p_brand_id
      and (p_platform is null or d.platform = p_platform)
      and (p_models is null or d.model_used = any (p_models))
      and (p_region is null or d.region = p_region)
      and (p_day_from is null or d.day >= p_day_from)
      and (p_day_to is null or d.day <= p_day_to)
  ),
  totals as (
    select
      coalesce((select sum(total_mentions) from brand_days), 0)::bigint as total_brand_mentions,
      coalesce((select sum(total_mentions) from comp_days), 0)::bigint  as total_competitor_mentions
  ),
  by_platform as (
    select b.model_used, b.platform,
           b.brand_mentions,
           coalesce(c.competitor_mentions, 0) as competitor_mentions
    from (
      select model_used, platform,
             coalesce(sum(total_mentions), 0)::bigint as brand_mentions
      from brand_days group by model_used, platform
    ) b
    left join (
      select model_used, platform,
             coalesce(sum(total_mentions), 0)::bigint as competitor_mentions
      from comp_days group by model_used, platform
    ) c on c.model_used is not distinct from b.model_used
       and c.platform is not distinct from b.platform
  ),
  by_day as (
    select b.day,
           b.brand_mentions,
           coalesce(c.competitor_mentions, 0) as competitor_mentions
    from (
      select to_char(day, 'YYYY-MM-DD') as day,
             coalesce(sum(total_mentions), 0)::bigint as brand_mentions
      from brand_days group by day
    ) b
    left join (
      select to_char(day, 'YYYY-MM-DD') as day,
             coalesce(sum(total_mentions), 0)::bigint as competitor_mentions
      from comp_days group by day
    ) c on c.day = b.day
  )
  select jsonb_build_object(
    'total_brand_mentions',      t.total_brand_mentions,
    'total_competitor_mentions', t.total_competitor_mentions,
    'by_platform', coalesce(
      (select jsonb_agg(jsonb_build_object(
                'model_used',          bp.model_used,
                'platform',            bp.platform,
                'brand_mentions',      bp.brand_mentions,
                'competitor_mentions', bp.competitor_mentions)
              order by bp.platform nulls last, bp.model_used nulls last)
       from by_platform bp),
      '[]'::jsonb),
    'by_day', coalesce(
      (select jsonb_agg(jsonb_build_object(
                'day',                 bd.day,
                'brand_mentions',      bd.brand_mentions,
                'competitor_mentions', bd.competitor_mentions)
              order by bd.day)
       from by_day bd),
      '[]'::jsonb)
  )
  from totals t;
$$;

-- visibility_rate_trend over rollups. Brand rows fold the day-grain and
-- prompt-grain tables; competitor rows are the dense per-day counts left-
-- joined with the visible-sighting distincts (liveness join preserved).
create or replace function public.visibility_rate_trend_daily(
  p_brand_id uuid,
  p_platform text default null,
  p_models text[] default null,
  p_region text default null,
  p_day_from date default null,
  p_day_to date default null
) returns jsonb
language sql
stable
set search_path to 'public'
as $$
  with brand_daily as (
    select d.day,
           sum(d.answer_count)     as answers,
           sum(d.mention_answers)  as mention_answers,
           sum(d.citation_answers) as citation_answers,
           sum(d.sum_inv_position) / nullif(sum(d.position_count), 0) as position_factor,
           sum(d.position_count)   as position_n
    from public.insights_brand_daily d
    where d.brand_id = p_brand_id
      and (p_platform is null or d.platform = p_platform)
      and (p_models is null or d.model_used = any (p_models))
      and (p_region is null or d.region = p_region)
      and (p_day_from is null or d.day >= p_day_from)
      and (p_day_to is null or d.day <= p_day_to)
    group by d.day
  ),
  prompt_daily as (
    select d.day,
           count(distinct d.prompt_id) as prompt_count,
           count(distinct d.prompt_id)
             filter (where d.has_mention or d.has_citation) as visible_prompts
    from public.insights_prompt_daily d
    where d.brand_id = p_brand_id
      and (p_platform is null or d.platform = p_platform)
      and (p_models is null or d.model_used = any (p_models))
      and (p_region is null or d.region = p_region)
      and (p_day_from is null or d.day >= p_day_from)
      and (p_day_to is null or d.day <= p_day_to)
    group by d.day
  ),
  comp_daily as (
    select cd.day, cd.competitor_id,
           sum(cd.mention_answers)  as mention_answers,
           sum(cd.citation_answers) as citation_answers,
           sum(cd.sum_inv_position) / nullif(sum(cd.position_count), 0) as position_factor,
           sum(cd.position_count)   as position_n
    from public.insights_competitor_daily cd
    join public.competitors c
      on c.id::text = cd.competitor_id and c.brand_id = p_brand_id
    where cd.brand_id = p_brand_id
      and (p_platform is null or cd.platform = p_platform)
      and (p_models is null or cd.model_used = any (p_models))
      and (p_region is null or cd.region = p_region)
      and (p_day_from is null or cd.day >= p_day_from)
      and (p_day_to is null or cd.day <= p_day_to)
    group by cd.day, cd.competitor_id
  ),
  comp_visible as (
    select cpd.day, cpd.competitor_id,
           count(distinct cpd.prompt_id) as visible_prompts
    from public.insights_competitor_prompt_daily cpd
    join public.competitors c
      on c.id::text = cpd.competitor_id and c.brand_id = p_brand_id
    where cpd.brand_id = p_brand_id
      and (p_platform is null or cpd.platform = p_platform)
      and (p_models is null or cpd.model_used = any (p_models))
      and (p_region is null or cpd.region = p_region)
      and (p_day_from is null or cpd.day >= p_day_from)
      and (p_day_to is null or cpd.day <= p_day_to)
    group by cpd.day, cpd.competitor_id
  )
  select coalesce(
    jsonb_agg(jsonb_build_object(
      'day',              bd.day,
      'prompt_count',     coalesce(pd.prompt_count, 0),
      'visible_prompts',  coalesce(pd.visible_prompts, 0),
      'answers',          bd.answers,
      'mention_answers',  bd.mention_answers,
      'citation_answers', bd.citation_answers,
      'position_factor',  bd.position_factor,
      'position_n',       bd.position_n,
      'competitors', coalesce(
        (select jsonb_agg(jsonb_build_object(
                  'competitor_id',    cd.competitor_id,
                  'visible_prompts',  coalesce(cv.visible_prompts, 0),
                  'mention_answers',  cd.mention_answers,
                  'citation_answers', cd.citation_answers,
                  'position_factor',  cd.position_factor,
                  'position_n',       cd.position_n)
                order by cd.competitor_id)
         from comp_daily cd
         left join comp_visible cv
           on cv.day = cd.day and cv.competitor_id = cd.competitor_id
         where cd.day = bd.day),
        '[]'::jsonb)
    ) order by bd.day),
    '[]'::jsonb)
  from brand_daily bd
  left join prompt_daily pd on pd.day = bd.day;
$$;
