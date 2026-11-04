-- Tracked Prompts usage counters (PROMPT-012).
--
-- The usage cards above the Tracked Prompts table show a brand's active and
-- paused prompts, and the account's active prompts, brands and active prompt
-- locations. Counting those from `prompts` on every page view is what the
-- spec rules out, so they're kept here, one row per brand, and the account
-- figures are the sum of the org's few brand rows.
--
-- A row is rebuilt from `prompts` by statement-level triggers, in the same
-- transaction as the change: a prompt added, paused, resumed, edited, moved
-- or deleted, and a prompt set deleted or moved to another brand. Rebuilding
-- the brand rather than adding deltas means a missed case can't leave a row
-- wrong for good, and a per-brand advisory lock taken before the rebuild
-- makes the last of two concurrent writers count both changes.
--
-- Locations follow org_prompt_location_usage (00128): an active prompt counts
-- greatest(array_length(regions), 1), a paused one counts none.
--
-- prompt_usage_actual() is the one place the counts are computed from
-- `prompts`; the rebuild, the backfill and the nightly check all read it.
-- repair_prompt_usage_counters() compares every row with it, rebuilds the rows
-- that differ and returns them; the server runs it nightly and logs drift.

-- The rebuild looks prompts up by brand; neither join had an index.
create index if not exists idx_prompts_prompt_set_id on public.prompts (prompt_set_id);
create index if not exists idx_prompt_sets_brand_id on public.prompt_sets (brand_id);

create table if not exists public.prompt_usage_counters (
  brand_id uuid primary key references public.brands(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  active_prompts integer not null default 0,
  paused_prompts integer not null default 0,
  active_locations integer not null default 0,
  updated_at timestamptz not null default now()
);

create index if not exists idx_prompt_usage_counters_org
  on public.prompt_usage_counters (organization_id);

alter table public.prompt_usage_counters enable row level security;

drop policy if exists "prompt_usage_counters: member select" on public.prompt_usage_counters;
create policy "prompt_usage_counters: member select" on public.prompt_usage_counters
  for select using (
    organization_id in (
      select p.organization_id from public.profiles p where p.id = auth.uid()
    )
  );

grant select on table public.prompt_usage_counters to authenticated;
grant all on table public.prompt_usage_counters to service_role;

-- Each brand's counts as they are in `prompts` right now: all brands, or the
-- given ones. Brands without prompts come back with zeros.
create or replace function public.prompt_usage_actual(p_brand_ids uuid[] default null)
returns table (
  brand_id uuid,
  organization_id uuid,
  active_prompts integer,
  paused_prompts integer,
  active_locations integer
)
language sql
stable
set search_path = public
as $$
  select
    b.id,
    b.organization_id,
    count(p.id) filter (where p.is_active)::integer,
    count(p.id) filter (where not p.is_active)::integer,
    coalesce(
      sum(greatest(coalesce(array_length(p.regions, 1), 0), 1)) filter (where p.is_active),
      0
    )::integer
  from public.brands b
  left join public.prompt_sets ps on ps.brand_id = b.id
  left join public.prompts p on p.prompt_set_id = ps.id
  where p_brand_ids is null or b.id = any(p_brand_ids)
  group by b.id, b.organization_id;
$$;

revoke all on function public.prompt_usage_actual(uuid[]) from public, anon, authenticated;
grant execute on function public.prompt_usage_actual(uuid[]) to service_role;

-- Rebuilds the counter rows of the given brands. Brands that no longer exist
-- (a brand deleted, its sets and prompts cascading) are skipped; their rows go
-- with them.
create or replace function public.refresh_prompt_usage_counters(p_brand_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_brand uuid;
begin
  -- Sorted, so two writers locking the same brands can't deadlock.
  for v_brand in
    select distinct id from unnest(p_brand_ids) as t(id) where id is not null order by id
  loop
    perform pg_advisory_xact_lock(hashtext('prompt_usage_counters:' || v_brand::text));

    -- A new statement after the lock, so it counts what a writer we waited
    -- for has committed.
    insert into public.prompt_usage_counters as c (
      brand_id, organization_id, active_prompts, paused_prompts, active_locations, updated_at
    )
    select a.brand_id, a.organization_id, a.active_prompts, a.paused_prompts, a.active_locations, now()
    from public.prompt_usage_actual(array[v_brand]) a
    on conflict (brand_id) do update set
      organization_id = excluded.organization_id,
      active_prompts = excluded.active_prompts,
      paused_prompts = excluded.paused_prompts,
      active_locations = excluded.active_locations,
      updated_at = excluded.updated_at;
  end loop;
end;
$$;

revoke all on function public.refresh_prompt_usage_counters(uuid[]) from public, anon, authenticated;
grant execute on function public.refresh_prompt_usage_counters(uuid[]) to service_role;

-- Statement-level, so a bulk import or a plan alignment that writes hundreds
-- of prompts in one statement rebuilds each brand once. Prompts whose set is
-- already gone (a set deleted, its prompts cascading) resolve to no brand; the
-- prompt_sets trigger below rebuilds that brand instead.
create or replace function public.prompts_refresh_usage_counters()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_brands uuid[];
begin
  if tg_op = 'INSERT' then
    select array_agg(distinct ps.brand_id) into v_brands
    from new_rows r join public.prompt_sets ps on ps.id = r.prompt_set_id;
  elsif tg_op = 'DELETE' then
    select array_agg(distinct ps.brand_id) into v_brands
    from old_rows r join public.prompt_sets ps on ps.id = r.prompt_set_id;
  else
    select array_agg(distinct ps.brand_id) into v_brands
    from (
      select prompt_set_id from new_rows
      union
      select prompt_set_id from old_rows
    ) r
    join public.prompt_sets ps on ps.id = r.prompt_set_id;
  end if;

  if v_brands is not null then
    perform public.refresh_prompt_usage_counters(v_brands);
  end if;
  return null;
end;
$$;

drop trigger if exists trg_prompts_usage_counters_insert on public.prompts;
create trigger trg_prompts_usage_counters_insert
  after insert on public.prompts
  referencing new table as new_rows
  for each statement execute function public.prompts_refresh_usage_counters();

drop trigger if exists trg_prompts_usage_counters_update on public.prompts;
create trigger trg_prompts_usage_counters_update
  after update on public.prompts
  referencing old table as old_rows new table as new_rows
  for each statement execute function public.prompts_refresh_usage_counters();

drop trigger if exists trg_prompts_usage_counters_delete on public.prompts;
create trigger trg_prompts_usage_counters_delete
  after delete on public.prompts
  referencing old table as old_rows
  for each statement execute function public.prompts_refresh_usage_counters();

-- A prompt set deleted (its prompts cascading first) or moved to another
-- brand: rebuild the brands it left and joined.
create or replace function public.prompt_sets_refresh_usage_counters()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_brands uuid[];
begin
  if tg_op = 'DELETE' then
    select array_agg(distinct brand_id) into v_brands from old_rows;
  else
    select array_agg(distinct brand_id) into v_brands
    from (
      select brand_id from new_rows
      union
      select brand_id from old_rows
    ) r;
  end if;

  if v_brands is not null then
    perform public.refresh_prompt_usage_counters(v_brands);
  end if;
  return null;
end;
$$;

drop trigger if exists trg_prompt_sets_usage_counters_update on public.prompt_sets;
create trigger trg_prompt_sets_usage_counters_update
  after update on public.prompt_sets
  referencing old table as old_rows new table as new_rows
  for each statement execute function public.prompt_sets_refresh_usage_counters();

drop trigger if exists trg_prompt_sets_usage_counters_delete on public.prompt_sets;
create trigger trg_prompt_sets_usage_counters_delete
  after delete on public.prompt_sets
  referencing old table as old_rows
  for each statement execute function public.prompt_sets_refresh_usage_counters();

-- What the usage cards read: one brand's counts plus its account's totals,
-- from the counter rows alone. Security invoker, so RLS returns no row for a
-- brand outside the caller's org.
create or replace function public.prompt_usage_summary(p_brand_id uuid)
returns table (
  brand_active integer,
  brand_paused integer,
  account_active integer,
  account_brands integer,
  account_locations integer
)
language sql
stable
set search_path = public
as $$
  select
    coalesce(bc.active_prompts, 0),
    coalesce(bc.paused_prompts, 0),
    coalesce(acct.active_prompts, 0)::integer,
    (select count(*) from public.brands b2 where b2.organization_id = b.organization_id)::integer,
    coalesce(acct.active_locations, 0)::integer
  from public.brands b
  left join public.prompt_usage_counters bc on bc.brand_id = b.id
  left join lateral (
    select sum(c.active_prompts) as active_prompts, sum(c.active_locations) as active_locations
    from public.prompt_usage_counters c
    where c.organization_id = b.organization_id
  ) acct on true
  where b.id = p_brand_id;
$$;

revoke all on function public.prompt_usage_summary(uuid) from public, anon;
grant execute on function public.prompt_usage_summary(uuid) to authenticated, service_role;

-- The nightly consistency check: compare every row with prompt_usage_actual(),
-- return the ones that differ (stored and actual counts) for the log, and
-- rebuild them. A brand moved to another organization counts as drift too. A
-- brand with no prompts and no row yet isn't drift.
create or replace function public.repair_prompt_usage_counters()
returns table (
  brand_id uuid,
  stored_active integer,
  stored_paused integer,
  stored_locations integer,
  actual_active integer,
  actual_paused integer,
  actual_locations integer
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_ids uuid[] := '{}';
  r record;
begin
  for r in
    select
      a.brand_id as id,
      coalesce(c.active_prompts, 0) as s_active,
      coalesce(c.paused_prompts, 0) as s_paused,
      coalesce(c.active_locations, 0) as s_locations,
      a.active_prompts as a_active,
      a.paused_prompts as a_paused,
      a.active_locations as a_locations
    from public.prompt_usage_actual() a
    left join public.prompt_usage_counters c on c.brand_id = a.brand_id
    where coalesce(c.active_prompts, 0) <> a.active_prompts
       or coalesce(c.paused_prompts, 0) <> a.paused_prompts
       or coalesce(c.active_locations, 0) <> a.active_locations
       or (c.brand_id is not null and c.organization_id <> a.organization_id)
  loop
    brand_id := r.id;
    stored_active := r.s_active;
    stored_paused := r.s_paused;
    stored_locations := r.s_locations;
    actual_active := r.a_active;
    actual_paused := r.a_paused;
    actual_locations := r.a_locations;
    v_ids := v_ids || r.id;
    return next;
  end loop;

  if cardinality(v_ids) > 0 then
    perform public.refresh_prompt_usage_counters(v_ids);
  end if;
end;
$$;

revoke all on function public.repair_prompt_usage_counters() from public, anon, authenticated;
grant execute on function public.repair_prompt_usage_counters() to service_role;

-- Every existing brand starts with its current counts. One statement and no
-- advisory locks (one per brand could exhaust the lock table on a large
-- database): the CREATE TRIGGERs above already hold off writes to prompts and
-- prompt_sets until this migration commits.
insert into public.prompt_usage_counters (
  brand_id, organization_id, active_prompts, paused_prompts, active_locations
)
select brand_id, organization_id, active_prompts, paused_prompts, active_locations
from public.prompt_usage_actual()
on conflict (brand_id) do nothing;

comment on table public.prompt_usage_counters is
  'Per-brand prompt counts for the Tracked Prompts usage cards (PROMPT-012, 00139): active, paused and active prompt locations. Rebuilt by triggers on prompts and prompt_sets; repair_prompt_usage_counters() checks them nightly.';
comment on function public.prompt_usage_summary(uuid) is
  'One brand''s active/paused prompts and its account''s active prompts, brands and active prompt locations, from prompt_usage_counters only (PROMPT-012). Security invoker.';
