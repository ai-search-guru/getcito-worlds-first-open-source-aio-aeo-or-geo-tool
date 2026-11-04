-- Keeps the old task vocabulary valid until the code that writes the new one
-- is deployed.
--
-- 00093 moved `mode` and `permission` to the specification's terms and
-- constrained them to those. The server that was live when it was applied
-- still inserted `manual` / `none` / `approval`, and a rejected insert while
-- raising an action throws the whole nightly pass — the failure #829 and #834
-- were about. So both vocabularies are accepted for the transition.
--
-- A later migration drops the old values once the deploy that stops writing
-- them has run for a night; existing rows were already rewritten by 00093.

alter table public.action_tasks drop constraint if exists action_tasks_mode_check;
alter table public.action_tasks drop constraint if exists action_tasks_permission_check;

alter table public.action_tasks
  add constraint action_tasks_mode_check
  check (mode in ('system', 'agent', 'human', 'human_or_agent', 'manual'));

alter table public.action_tasks
  add constraint action_tasks_permission_check
  check (permission in ('read', 'write', 'execute', 'none', 'approval'));
