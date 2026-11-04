-- Action Center: KPI definitions (issue: Action Center KPIs page).
--
-- One row per activated KPI per brand. Only the user's choices live here —
-- the target, the timeframe, and whether the KPI is active. Everything a
-- reader sees next to those (value, change, trend, status) is computed at
-- read time from the tracking/GA aggregates, so a definition can never
-- disagree with the surfaces it summarizes. Static product knowledge
-- (name, unit, direction, category) lives in the code registry keyed by
-- kpi_key; storing it here as well would let the two drift.

create table public.kpi_definitions (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  -- Key into the code-side KPI registry (frontend/src/lib/kpis/registry.ts).
  -- Not an enum: adding a KPI must not take a migration.
  kpi_key text not null,
  target numeric not null check (target > 0),
  timeframe text not null default 'monthly'
    check (timeframe in ('weekly', 'monthly', 'quarterly')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (brand_id, kpi_key)
);

create index kpi_definitions_brand_idx
  on public.kpi_definitions (brand_id) where is_active;

-- ─── Row level security ──────────────────────────────────────────────────────
-- Same shape as brand_domains: every org member reads, admins and managers
-- write. Targets steer what the Action Center will prioritize, so changing
-- them is a management decision, not a per-member preference.

alter table public.kpi_definitions enable row level security;

create policy "kpi_definitions: member select"
  on public.kpi_definitions
  for select
  using (
    brand_id in (
      select b.id
      from public.brands b
      join public.profiles p on p.organization_id = b.organization_id
      where p.id = auth.uid()
    )
  );

create policy "kpi_definitions: admin/manager insert"
  on public.kpi_definitions
  for insert
  with check (
    brand_id in (
      select b.id
      from public.brands b
      join public.profiles p on p.organization_id = b.organization_id
      where p.id = auth.uid()
        and p.role = any (array['admin'::public.user_role, 'manager'::public.user_role])
    )
  );

create policy "kpi_definitions: admin/manager update"
  on public.kpi_definitions
  for update
  using (
    brand_id in (
      select b.id
      from public.brands b
      join public.profiles p on p.organization_id = b.organization_id
      where p.id = auth.uid()
        and p.role = any (array['admin'::public.user_role, 'manager'::public.user_role])
    )
  );

create policy "kpi_definitions: admin/manager delete"
  on public.kpi_definitions
  for delete
  using (
    brand_id in (
      select b.id
      from public.brands b
      join public.profiles p on p.organization_id = b.organization_id
      where p.id = auth.uid()
        and p.role = any (array['admin'::public.user_role, 'manager'::public.user_role])
    )
  );
