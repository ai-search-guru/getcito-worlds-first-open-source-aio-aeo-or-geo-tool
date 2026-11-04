-- ============================================================================
-- 00382: topic changes are an admin's or a manager's
-- ============================================================================
-- The app already keeps adding, renaming and deleting topics, and accepting
-- or dismissing topic suggestions, to admins and managers (the Topics page,
-- the API and the MCP check the role). The rows' rules now say the same:
--
--   * topics: every member of the brand's organization reads them; an admin
--     or a manager of that organization adds, changes and deletes them.
--   * topic_suggestions: every member reads them; an admin or a manager
--     updates them (accept, dismiss). Nothing else changes: the server
--     writes new suggestions with the service role, which these rules don't
--     apply to.
--
-- Setting up a brand keeps working: a new organization's first person is
-- its admin, and only admins and managers add brands.

-- ── topics ──────────────────────────────────────────────────────────────────

drop policy if exists "topics: member insert" on public.topics;
drop policy if exists "topics: member update" on public.topics;
drop policy if exists "topics: member delete" on public.topics;

drop policy if exists "topics: admin/manager insert" on public.topics;
create policy "topics: admin/manager insert" on public.topics
  for insert
  with check (
    brand_id in (
      select b.id
      from public.brands b
      join public.profiles p on p.organization_id = b.organization_id
      where p.id = auth.uid() and p.role in ('admin', 'manager')
    )
  );

drop policy if exists "topics: admin/manager update" on public.topics;
create policy "topics: admin/manager update" on public.topics
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

drop policy if exists "topics: admin/manager delete" on public.topics;
create policy "topics: admin/manager delete" on public.topics
  for delete
  using (
    brand_id in (
      select b.id
      from public.brands b
      join public.profiles p on p.organization_id = b.organization_id
      where p.id = auth.uid() and p.role in ('admin', 'manager')
    )
  );

-- ── topic_suggestions ───────────────────────────────────────────────────────

drop policy if exists "topic_suggestions: admin/manager/analyst update" on public.topic_suggestions;

drop policy if exists "topic_suggestions: admin/manager update" on public.topic_suggestions;
create policy "topic_suggestions: admin/manager update" on public.topic_suggestions
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
