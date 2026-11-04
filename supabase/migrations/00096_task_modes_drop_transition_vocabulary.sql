-- Closes the transition window 00094 opened.
--
-- 00094 kept `manual` / `none` / `approval` valid while the server that
-- still wrote them was live. The deploy that writes only the specification's
-- vocabulary has run a full night and every row in action_tasks uses it, so
-- the constraints go back to the new values alone.

alter table public.action_tasks drop constraint if exists action_tasks_mode_check;
alter table public.action_tasks drop constraint if exists action_tasks_permission_check;

alter table public.action_tasks
  add constraint action_tasks_mode_check
  check (mode in ('system', 'agent', 'human', 'human_or_agent'));

alter table public.action_tasks
  add constraint action_tasks_permission_check
  check (permission in ('read', 'write', 'execute'));
