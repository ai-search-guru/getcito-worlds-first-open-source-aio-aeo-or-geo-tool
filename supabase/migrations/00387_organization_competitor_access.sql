-- ============================================================================
-- 00387: organizations and competitors access rules
-- ============================================================================
-- organizations: a signed-in person reads the organization their profile
-- belongs to. Onboarding creates the organization with the person's own
-- session, choosing its id, and doesn't read it back until the profile has
-- joined it. The server reads and writes organizations with the service
-- role, which these rules don't apply to. The anon role has no use for the
-- table.
--
-- competitors: every member of the brand's organization reads them; an
-- admin or a manager of that organization adds, changes and deletes them,
-- as brand settings and Chat already allow (the same rules topics have,
-- 00382). Setting up a brand keeps working: a new
-- organization's first person is its admin, and only admins and managers
-- add brands.

-- ── organizations ───────────────────────────────────────────────────────────

drop policy if exists "organizations: member or creator select" on public.organizations;

drop policy if exists "organizations: member select" on public.organizations;
create policy "organizations: member select" on public.organizations
  for select
  to authenticated
  using (
    id in (
      select p.organization_id
      from public.profiles p
      where p.id = auth.uid()
    )
  );

drop policy if exists "organizations: authenticated insert" on public.organizations;
create policy "organizations: authenticated insert" on public.organizations
  for insert
  to authenticated
  with check (auth.uid() is not null);

drop policy if exists "organizations: admin update" on public.organizations;
create policy "organizations: admin update" on public.organizations
  for update
  to authenticated
  using (
    id in (
      select p.organization_id
      from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  )
  with check (
    id in (
      select p.organization_id
      from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

revoke all on table public.organizations from anon;

-- ── competitors ─────────────────────────────────────────────────────────────

drop policy if exists "competitors: member insert" on public.competitors;
drop policy if exists "competitors: member update" on public.competitors;
drop policy if exists "competitors: member delete" on public.competitors;

drop policy if exists "competitors: admin/manager insert" on public.competitors;
create policy "competitors: admin/manager insert" on public.competitors
  for insert
  with check (
    brand_id in (
      select b.id
      from public.brands b
      join public.profiles p on p.organization_id = b.organization_id
      where p.id = auth.uid() and p.role in ('admin', 'manager')
    )
  );

drop policy if exists "competitors: admin/manager update" on public.competitors;
create policy "competitors: admin/manager update" on public.competitors
  for update
  using (
    brand_id in (
      select b.id
      from public.brands b
      join public.profiles p on p.organization_id = b.organization_id
      where p.id = auth.uid() and p.role in ('admin', 'manager')
    )
  )
  with check (
    brand_id in (
      select b.id
      from public.brands b
      join public.profiles p on p.organization_id = b.organization_id
      where p.id = auth.uid() and p.role in ('admin', 'manager')
    )
  );

drop policy if exists "competitors: admin/manager delete" on public.competitors;
create policy "competitors: admin/manager delete" on public.competitors
  for delete
  using (
    brand_id in (
      select b.id
      from public.brands b
      join public.profiles p on p.organization_id = b.organization_id
      where p.id = auth.uid() and p.role in ('admin', 'manager')
    )
  );
