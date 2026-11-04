-- Action tasks become editable: custom text, add, delete, and a status that
-- says "we decided not to" rather than "we are stuck".
--
-- 1. `title`. A task's text lived only in code: `task_key` indexes the
--    per-kind templates the generator writes, and the drawer renders
--    t(actionCenter.actionTasks.<task_key>). There was nowhere to put a
--    sentence a person typed. A generated task keeps its key and no title; a
--    task someone adds or renames carries a title, and the reader prefers the
--    title when it is there. `task_key` becomes nullable, with a check that a
--    row always has one of the two to render from.
--
--    `unique (action_id, task_key)` stays as it is. Postgres treats nulls as
--    distinct in a unique constraint, so an action can hold any number of
--    user-added tasks while still refusing a duplicate template.
--
-- 2. `blocked` becomes `canceled`. Blocked means "still to do, held up";
--    canceled means "not going to happen". Progress reads completed/total, so
--    a blocked task holds an action below 100% forever while it waits for
--    something that may never arrive. Canceled leaves the denominator instead
--    — that part is in the read path, not here. One row carries the old value
--    today, which is the cheapest this rename will ever be.
--
-- 3. action_tasks reopens to members for insert and delete, scoped to their
--    own organization — the same predicate the select and update policies
--    already use. 00082 closed these outright after finding them open to
--    every signed-in user; this is the narrow, intentional version of that
--    permission, and it exists because the Tasks tab now adds and removes
--    tasks. actions and action_events stay closed.

alter table public.action_tasks
  add column if not exists title text;

comment on column public.action_tasks.title is
  'User-supplied task text. Null for generated tasks, which render from task_key.';

alter table public.action_tasks
  alter column task_key drop not null;

comment on column public.action_tasks.task_key is
  'Key into the code-side task templates. Null for user-added tasks, which carry a title.';

alter table public.action_tasks
  drop constraint if exists action_tasks_renderable_check;

alter table public.action_tasks
  add constraint action_tasks_renderable_check
  check (task_key is not null or btrim(coalesce(title, '')) <> '');

-- Drop before the update, not after: the old constraint still forbids
-- 'canceled' while it stands, so rewriting the rows under it fails.
alter table public.action_tasks
  drop constraint if exists action_tasks_status_check;

update public.action_tasks set status = 'canceled' where status = 'blocked';

alter table public.action_tasks
  add constraint action_tasks_status_check
  check (status in ('todo', 'in_progress', 'completed', 'canceled'));

drop policy if exists "action_tasks: no client insert" on public.action_tasks;
drop policy if exists "action_tasks: no client delete" on public.action_tasks;

create policy "action_tasks: member insert" on public.action_tasks
  for insert with check (
    action_id in (
      select a.id from public.actions a
      join public.brands b on b.id = a.brand_id
      join public.profiles p on p.organization_id = b.organization_id
      where p.id = auth.uid()
    )
  );

create policy "action_tasks: member delete" on public.action_tasks
  for delete using (
    action_id in (
      select a.id from public.actions a
      join public.brands b on b.id = a.brand_id
      join public.profiles p on p.organization_id = b.organization_id
      where p.id = auth.uid()
    )
  );
