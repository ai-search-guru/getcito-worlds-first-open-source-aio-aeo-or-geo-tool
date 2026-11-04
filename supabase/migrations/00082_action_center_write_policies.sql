-- Close the cross-organization write hole on the Action Center tables.
--
-- 00081 created five policies named "Service role can insert/delete ...", but
-- created them the way an unqualified `create policy` creates anything: `to
-- public`, with the predicate `true`. service_role bypasses RLS altogether and
-- never consulted them. The roles that did consult them are anon and
-- authenticated — both of which hold INSERT and DELETE grants on all three
-- tables — so the policies granted every signed-in user the right to insert
-- and delete rows belonging to any organization:
--
--   actions         insert, delete
--   action_tasks    insert, delete
--   action_events   delete
--
-- Reads were never affected; the select and update policies are scoped to the
-- caller's organization and stay as they are.
--
-- Nothing legitimate relied on these. Both writers of these tables — the
-- nightly signal-to-action generator and the backfill script — go through the
-- admin client, which bypasses RLS and is unaffected by what happens here. The
-- web tier only ever selects and updates. So the commands are closed outright
-- rather than scoped: the narrowest fix that keeps today's behaviour.
--
-- A later migration reopens action_tasks insert/delete to members, scoped to
-- their own organization, when the Tasks tab learns to add and remove tasks.

drop policy if exists "Service role can insert actions" on public.actions;
drop policy if exists "Service role can delete actions" on public.actions;
drop policy if exists "Service role can insert action tasks" on public.action_tasks;
drop policy if exists "Service role can delete action tasks" on public.action_tasks;
drop policy if exists "Service role can delete action events" on public.action_events;

-- Explicit deny-all policies rather than no policy at all. With RLS enabled a
-- missing policy already denies, but these say so out loud: the next reader
-- sees a decision where they would otherwise see an omission, and the tables
-- keep one policy per command.

create policy "actions: no client insert" on public.actions
  for insert with check (false);

create policy "actions: no client delete" on public.actions
  for delete using (false);

create policy "action_tasks: no client insert" on public.action_tasks
  for insert with check (false);

create policy "action_tasks: no client delete" on public.action_tasks
  for delete using (false);

-- The trail is append-only: members insert their own events through the
-- existing member-insert policy, and nobody may erase one.
create policy "action_events: no client delete" on public.action_events
  for delete using (false);
