-- ============================================================================
-- 00380: a demo brand per organization (demo-core)
-- ============================================================================
-- People who sign up without a card, and workspaces whose trial ended or whose
-- plan was cancelled, can explore a demo brand: Brewline Coffee, a fictional
-- brand on a `.example` domain, filled with sample data in the real tables.
-- It is an ordinary brand row in the person's own organization, so every page
-- reads it through the same queries and policies as any brand. The server
-- writes its data (backend/src/lib/demo/) and rebuilds it when DEMO_VERSION
-- moves on or the data grows old, keeping the brand's id so links to it hold.
--
-- What it must never do is cost anything or count against the plan:
--   * the nightly sweeps and the jobs skip `is_demo` brands (server code);
--   * the plan's prompt-location quota and the brand count leave them out
--     (org_prompt_location_usage, prompt_usage_summary below; the web's
--     maxBrands check);
--   * the health report's fan-out share leaves out their answers, which share
--     their searches every run by construction and would hide a real drop.
--
-- Policies: members read the demo brand like any other. Only the server
-- (service role) writes it: people can't insert a demo brand, mark a brand as
-- one, change it or delete it. Hiding it (demo_hidden_at) goes through the
-- server too (PATCH /api/demo), for admins and managers.

alter table public.brands
  add column if not exists is_demo boolean not null default false,
  add column if not exists demo_version integer,
  add column if not exists demo_built_at timestamptz,
  add column if not exists demo_hidden_at timestamptz;

-- The demo columns mean nothing on a real brand.
alter table public.brands
  drop constraint if exists brands_demo_columns_check;
alter table public.brands
  add constraint brands_demo_columns_check
  check (is_demo or (demo_version is null and demo_built_at is null and demo_hidden_at is null));

-- One demo brand per organization. Two first visits at once both try to
-- create it; the second insert fails here and reads the first one's row.
create unique index if not exists brands_one_demo_per_org
  on public.brands (organization_id)
  where is_demo;

comment on column public.brands.is_demo is
  'Demo brand (00380): sample data written by the server (lib/demo), one per organization. Never tracked, audited or synced, never counted against the plan; people read it and can''t change it.';
comment on column public.brands.demo_version is
  'Demo brand (00380): the DEMO_VERSION its data was built with; null while a build is under way or after one failed. A lower version is rebuilt on the next visit.';
comment on column public.brands.demo_built_at is
  'Demo brand (00380): when its data was last built, its dates counted back from then; with a null demo_version, when the build under way started. Data older than a few days is rebuilt on the next visit.';
comment on column public.brands.demo_hidden_at is
  'Demo brand (00380): when the organization hid it (after a purchase, or from the brand switcher); null = shown. Hidden, never deleted: it can be shown again.';

-- ─── Policies ──────────────────────────────────────────────────────────────
-- Same as before, plus `not is_demo`: a person can't insert a demo brand, turn
-- a brand into one or back, change one or delete one. The server's writes use
-- the service role and aren't bound by these.

drop policy if exists "brands: admin/manager insert" on public.brands;
create policy "brands: admin/manager insert" on public.brands
  for insert
  with check (
    not is_demo
    and organization_id in (
      select profiles.organization_id
      from public.profiles
      where profiles.id = auth.uid()
        and profiles.role = any (array['admin'::public.user_role, 'manager'::public.user_role])
    )
  );

drop policy if exists "brands: admin/manager update" on public.brands;
create policy "brands: admin/manager update" on public.brands
  for update
  using (
    not is_demo
    and organization_id in (
      select profiles.organization_id
      from public.profiles
      where profiles.id = auth.uid()
        and profiles.role = any (array['admin'::public.user_role, 'manager'::public.user_role])
    )
  )
  with check (
    not is_demo
    and organization_id in (
      select profiles.organization_id
      from public.profiles
      where profiles.id = auth.uid()
        and profiles.role = any (array['admin'::public.user_role, 'manager'::public.user_role])
    )
  );

drop policy if exists "brands: admin delete" on public.brands;
create policy "brands: admin delete" on public.brands
  for delete
  using (
    not is_demo
    and organization_id in (
      select profiles.organization_id
      from public.profiles
      where profiles.id = auth.uid()
        and profiles.role = 'admin'::public.user_role
    )
  );

-- ─── The plan's prompt-location quota (00128) without the demo brand ───────
-- savePromptSet, the prompt dialogs and import_prompts all count through this.
create or replace function public.org_prompt_location_usage(p_organization_id uuid)
returns table (brand_id uuid, locations bigint)
language sql
stable
set search_path to 'public'
as $$
  select b.id, sum(greatest(coalesce(array_length(p.regions, 1), 0), 1))::bigint
  from public.prompts p
  join public.prompt_sets ps on ps.id = p.prompt_set_id
  join public.brands b on b.id = ps.brand_id
  where b.organization_id = p_organization_id
    and not b.is_demo
    and p.is_active
  group by b.id;
$$;

revoke all on function public.org_prompt_location_usage(uuid) from public;
grant execute on function public.org_prompt_location_usage(uuid) to authenticated, service_role;

comment on function public.org_prompt_location_usage(uuid) is
  'Active prompt locations per brand for one org (#691, 00128) — the plan-quota unit, one per region entry per active prompt, minimum one; paused prompts and the demo brand (00380) don''t count. Security invoker: RLS scopes it to the caller''s org.';

-- ─── The usage cards' account totals (00139) without the demo brand ────────
-- The demo brand's own counts stay (its Prompts page shows them); the
-- account's prompts, brands and locations, which the plan limits, leave it out.
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
    (
      select count(*)
      from public.brands b2
      where b2.organization_id = b.organization_id
        and not b2.is_demo
    )::integer,
    coalesce(acct.active_locations, 0)::integer
  from public.brands b
  left join public.prompt_usage_counters bc on bc.brand_id = b.id
  left join lateral (
    select sum(c.active_prompts) as active_prompts, sum(c.active_locations) as active_locations
    from public.prompt_usage_counters c
    join public.brands cb on cb.id = c.brand_id
    where c.organization_id = b.organization_id
      and not cb.is_demo
  ) acct on true
  where b.id = p_brand_id;
$$;

revoke all on function public.prompt_usage_summary(uuid) from public, anon;
grant execute on function public.prompt_usage_summary(uuid) to authenticated, service_role;

comment on function public.prompt_usage_summary(uuid) is
  'One brand''s active/paused prompts and its account''s active prompts, brands and active prompt locations, from prompt_usage_counters only (PROMPT-012); the account totals leave out the demo brand (00380). Security invoker.';

-- ─── The health report's fan-out share (00140) without demo answers ────────
create or replace function public.fanout_coverage_by_platform(
  p_since timestamptz,
  p_until timestamptz
)
returns table (platform text, answers bigint, answers_with_fanout bigint)
language sql
stable
security definer
set search_path = public
as $$
  select
    r.platform,
    count(*)::bigint,
    count(*) filter (
      where case
        when jsonb_typeof(r.search_queries) = 'array' then jsonb_array_length(r.search_queries)
        else 0
      end > 0
    )::bigint
  from public.prompt_results r
  join public.brands b on b.id = r.brand_id
  where r.created_at >= p_since
    and r.created_at < p_until
    and not b.is_demo
  group by r.platform;
$$;

revoke all on function public.fanout_coverage_by_platform(timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.fanout_coverage_by_platform(timestamptz, timestamptz)
  to service_role;

comment on function public.fanout_coverage_by_platform(timestamptz, timestamptz) is
  'Answers and answers with observed query fan-out per platform in [p_since, p_until), across all brands but demo ones (00140, 00380). Read by the daily health report.';
