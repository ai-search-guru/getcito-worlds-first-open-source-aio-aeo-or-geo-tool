-- ============================================================================
-- 00370: real demand for a tracked prompt (PROMPT-014)
-- ============================================================================
-- A prompt's AI search volume is an estimate (PROMPT-013). Its Demand card
-- shows the signs that people really ask it, each with its source and date:
--
--   * Search Console: impressions and clicks over 28 days for the brand's
--     queries that match the prompt (gsc_query_stats, read every night).
--   * Google Trends: the 12 months of its keyword, rising, steady or falling.
--   * People Also Ask: the questions Google lists for its keyword.
--   * YouTube: the videos for its keyword, and their views.
--
-- The last three are DataForSEO's queued (Standard) tasks, read about once a
-- week: the keyword is the prompt's volume analysis's own (prompt_volumes),
-- where it is measured, so a prompt never analysed has none of them. A task
-- is set one night and read when it's done, that night or the next (`tasks`).
-- A sweep claims a prompt before it sets its tasks (prompt_demand_claim), so
-- two sweeps at once never pay for the same prompt twice.
--
-- The level (high, medium, low) weighs the signals there are; `signals` is
-- how many of the four were read. The Action Center's priority reads it.
--
--   * Members read their brands' rows; the server's nightly sweep writes
--     them (service role). The app reads them through the server
--     (GET /api/prompts/:id/demand).
--   * prompt_demand_gsc_queries: a brand's Search Console queries over a
--     window, with their clicks and impressions, for the sweep to match to
--     its prompts. Service role only.
--   * prompt_demand_claim: claims the prompts a sweep is about to set tasks
--     for. Service role only.
--   * prompt_demand_brand_updates: when each brand's rows were last written,
--     so a night starts with the brands waiting longest. Service role only.

create table if not exists public.prompt_demand (
  prompt_id     uuid primary key references public.prompts(id) on delete cascade,
  brand_id      uuid not null references public.brands(id) on delete cascade,
  -- What the paid signals were read for: the volume analysis's top keyword,
  -- its DataForSEO location and language.
  keyword       text,
  location_code integer,
  language_code text,
  -- Each { ..., at }: what was read and when. Null: never read, or the
  -- source isn't there (no Search Console property, no keyword).
  gsc           jsonb,
  trends        jsonb,
  paa           jsonb,
  youtube       jsonb,
  -- The DataForSEO tasks set and not read yet: { posted_at, trends, paa, youtube } (task ids).
  tasks         jsonb,
  -- When the paid signals were last set to be read: about once a week.
  posted_at     timestamptz,
  -- When a sweep last claimed the prompt to set its tasks
  -- (prompt_demand_claim). A claim older than the sweep's window is one
  -- that died, and may be taken again.
  claimed_at    timestamptz,
  level         text
    constraint prompt_demand_level_check check (level in ('high', 'medium', 'low')),
  signals       smallint not null default 0
    constraint prompt_demand_signals_check check (signals between 0 and 4),
  updated_at    timestamptz not null default now()
);

create index if not exists prompt_demand_brand_idx on public.prompt_demand (brand_id);
-- The tasks waiting to be read: few at a time, looked up every night.
create index if not exists prompt_demand_tasks_idx
  on public.prompt_demand (prompt_id) where tasks is not null;

-- Read by the brand's members (the policy below); written by the server.
alter table public.prompt_demand enable row level security;
revoke all on table public.prompt_demand from anon, authenticated;
grant select on table public.prompt_demand to authenticated;
grant all on table public.prompt_demand to service_role;

drop policy if exists "prompt_demand: member select" on public.prompt_demand;
create policy "prompt_demand: member select"
  on public.prompt_demand
  for select
  using (
    brand_id in (
      select b.id from public.brands b
      join public.profiles p on p.organization_id = b.organization_id
      where p.id = auth.uid()
    )
  );

comment on table public.prompt_demand is
  'Real demand for a tracked prompt (PROMPT-014): Search Console impressions and clicks (nightly), Google Trends, People Also Ask and YouTube (DataForSEO, about weekly), and the level they come to. Written by the server''s nightly sweep; members read.';

-- A brand's Search Console queries over a window, the most seen first, with
-- their clicks and impressions: the sweep matches each one to a prompt.
-- jsonb, so PostgREST's row cap doesn't cut the list at 1,000.
create or replace function public.prompt_demand_gsc_queries(
  p_brand_id uuid, p_from date, p_to date, p_limit integer default 5000
) returns jsonb
language sql
stable
set search_path = public
as $$
  select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) from (
    select g.query,
           sum(g.clicks)::bigint as clicks,
           sum(g.impressions)::bigint as impressions
    from public.gsc_query_stats g
    where g.brand_id = p_brand_id and g.date between p_from and p_to
    group by g.query
    order by sum(g.impressions) desc, g.query
    limit greatest(least(coalesce(p_limit, 5000), 20000), 1)
  ) x
$$;

revoke all on function public.prompt_demand_gsc_queries(uuid, date, date, integer) from public, anon, authenticated;
grant execute on function public.prompt_demand_gsc_queries(uuid, date, date, integer) to service_role;

comment on function public.prompt_demand_gsc_queries(uuid, date, date, integer) is
  'PROMPT-014 (00370): a brand''s Search Console queries between two days with their clicks and impressions, the most seen first, at most p_limit (default 5,000). The demand sweep matches them to prompts. Service role only.';

-- Claims the prompts a sweep is about to set DataForSEO tasks for, before
-- it sets them: a prompt is claimed when no task of its is waiting and no
-- other sweep claimed it in the last p_stale_minutes. Makes the row of a
-- prompt that has none yet; a prompt deleted since is left out. Returns
-- the prompt ids claimed (jsonb, past PostgREST's row cap): only those are
-- set. Two sweeps at once: the row's lock makes the second wait, and then
-- find the claim.
create or replace function public.prompt_demand_claim(
  p_rows jsonb, p_stale_minutes integer default 120
) returns jsonb
language sql
volatile
set search_path = public
as $$
  with asked as (
    select distinct on (r.prompt_id) r.prompt_id, r.brand_id
    from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(prompt_id uuid, brand_id uuid)
    join public.prompts p on p.id = r.prompt_id
    where r.brand_id is not null
    order by r.prompt_id
  ), claimed as (
    insert into public.prompt_demand as d (prompt_id, brand_id, claimed_at)
    select a.prompt_id, a.brand_id, now() from asked a
    on conflict (prompt_id) do update
      set claimed_at = excluded.claimed_at
      where d.tasks is null
        and (
          d.claimed_at is null
          or d.claimed_at < now() - make_interval(mins => greatest(coalesce(p_stale_minutes, 120), 1))
        )
    returning d.prompt_id
  )
  select coalesce(jsonb_agg(c.prompt_id), '[]'::jsonb) from claimed c
$$;

revoke all on function public.prompt_demand_claim(jsonb, integer) from public, anon, authenticated;
grant execute on function public.prompt_demand_claim(jsonb, integer) to service_role;

comment on function public.prompt_demand_claim(jsonb, integer) is
  'PROMPT-014 (00370): claims [{prompt_id, brand_id}] for a sweep about to set their DataForSEO tasks: those with no task waiting and no claim in the last p_stale_minutes (default 120). Returns the prompt ids claimed. Service role only.';

-- When each brand's demand rows were last written, { brand_id: timestamptz }:
-- a night takes the brands never written first, then the ones waiting
-- longest, so a sweep that runs out of time leaves different brands each
-- night.
create or replace function public.prompt_demand_brand_updates()
returns jsonb
language sql
stable
set search_path = public
as $$
  select coalesce(jsonb_object_agg(x.brand_id, x.updated_at), '{}'::jsonb) from (
    select d.brand_id, max(d.updated_at) as updated_at
    from public.prompt_demand d
    group by d.brand_id
  ) x
$$;

revoke all on function public.prompt_demand_brand_updates() from public, anon, authenticated;
grant execute on function public.prompt_demand_brand_updates() to service_role;

comment on function public.prompt_demand_brand_updates() is
  'PROMPT-014 (00370): when each brand''s prompt_demand rows were last written, as { brand_id: updated_at }, for the nightly sweep''s brand order. Service role only.';

notify pgrst, 'reload schema';
