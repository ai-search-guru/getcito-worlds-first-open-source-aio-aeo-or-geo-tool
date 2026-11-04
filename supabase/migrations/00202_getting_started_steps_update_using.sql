-- ============================================================================
-- 00202: only admins and managers change a step that isn't just opened
-- ============================================================================
-- Follow-up from #1234's review. 00196's update policy on
-- getting_started_steps checked the new row (`with check`: any member may
-- write `opened`, only an admin or a manager `skipped` or `done`), but not
-- the row being changed (`using`). So through PostgREST any member could
-- turn a skipped or done step back into opened. The app never does: the
-- page RPC inserts with `on conflict do nothing`, and skipping or saving the
-- KPIs is an admin's or a manager's.
--
-- `using` now also needs the row to be opened, or the user to be an admin or
-- a manager. The rest of the policy is 00196's.

drop policy if exists "getting_started_steps: member update" on public.getting_started_steps;

create policy "getting_started_steps: member update"
  on public.getting_started_steps
  for update
  using (
    brand_id in (
      select b.id
      from public.brands b
      join public.profiles p on p.organization_id = b.organization_id
      where p.id = auth.uid()
    )
    and (
      state = 'opened'
      or exists (
        select 1 from public.profiles p
        where p.id = auth.uid()
          and p.role = any (array['admin'::public.user_role, 'manager'::public.user_role])
      )
    )
  )
  with check (
    brand_id in (
      select b.id
      from public.brands b
      join public.profiles p on p.organization_id = b.organization_id
      where p.id = auth.uid()
    )
    and (
      state = 'opened'
      or exists (
        select 1 from public.profiles p
        where p.id = auth.uid()
          and p.role = any (array['admin'::public.user_role, 'manager'::public.user_role])
      )
    )
  );
