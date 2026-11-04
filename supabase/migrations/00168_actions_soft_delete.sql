-- Deleting an Action Center action from its row menu.
--
-- A delete hides the action rather than removing the row: it is set to
-- 'dismissed' and stamped deleted_at. Kept as a dismissed row, it still
-- gives the nightly generator its rest window (generate.js reads completed
-- and dismissed actions to see when a definition last closed), so a
-- condition that is still firing doesn't come back as a fresh action the
-- next night. Removed outright, it would.
--
-- Everyone else stops seeing it:
--   * members read actions through "actions: member select", which now
--     leaves deleted rows out. The task, event and signal-link policies look
--     actions up through it, so a deleted action's tasks and trail go too.
--   * the server's admin reads (MCP, API, exports) filter deleted_at
--     themselves.
--   * sync_opportunity_status, a security-definer trigger, counts an
--     opportunity's actions to set its status; a deleted one no longer
--     counts, as if it had never been sent.

alter table public.actions add column if not exists deleted_at timestamptz;

drop policy if exists "actions: member select" on public.actions;

create policy "actions: member select" on public.actions
  for select using (
    deleted_at is null
    and brand_id in (
      select b.id from public.brands b
      join public.profiles p on p.organization_id = b.organization_id
      where p.id = auth.uid()
    )
  );

create or replace function public.sync_opportunity_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  opp uuid := nullif(new.payload->>'opportunityId', '')::uuid;
  since timestamptz;
  next_status text;
begin
  if opp is null then
    return new;
  end if;

  select nullif(source_data->'reopened'->>'at', '')::timestamptz
    into since
    from content_opportunities
   where id = opp;

  select case
           when count(*) = 0 then null
           when count(*) filter (where a.status <> 'dismissed') = 0 then 'reviewed'
           when count(*) filter (where a.status not in ('completed', 'dismissed')) = 0 then 'done'
           when count(*) filter (where a.status in ('in_progress', 'on_hold', 'completed')) > 0
             then 'in_progress'
           else 'sent'
         end
    into next_status
    from actions a
   where a.kind = 'content_opportunity'
     and a.brand_id = new.brand_id
     and a.payload->>'opportunityId' = opp::text
     and a.deleted_at is null
     and (since is null or a.created_at >= since);

  -- Only earlier work changed, or the only action was deleted: the
  -- opportunity stays as it is.
  if next_status is null then
    return new;
  end if;

  update content_opportunities
     set status = next_status, updated_at = now()
   where id = opp
     and brand_id = new.brand_id
     and status in ('new', 'reviewed', 'sent', 'in_progress', 'done')
     and status <> next_status;

  return new;
end;
$$;

revoke all on function public.sync_opportunity_status() from public, anon, authenticated;

notify pgrst, 'reload schema';
