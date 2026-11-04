-- Task execution modes and permission levels, in the specification's terms.
--
-- Phase 5 (00088) stored a simplification: `mode` as manual/agent and
-- `permission` as none/approval. The V1 Task Library specification defines
-- four execution modes and three permission levels, and the difference is not
-- cosmetic — SYSTEM work (a deterministic comparison) and HUMAN_OR_AGENT work
-- (either may do it, depending on the tools connected) are both things the
-- planner and the runner have to be able to say, and manual/agent cannot.
--
--   mode        system | agent | human | human_or_agent
--   permission  read   | write | execute
--
-- WRITE and EXECUTE require approval unless a workspace explicitly authorises
-- autonomy; READ does not. That is the specification's default and what the
-- runner enforces.
--
-- The constraints are dropped before the rows are rewritten: 00083 rewrote
-- rows first and the old constraint rejected them, rolling the migration back.

alter table public.action_tasks drop constraint if exists action_tasks_mode_check;
alter table public.action_tasks drop constraint if exists action_tasks_permission_check;

update public.action_tasks
set mode = case mode when 'manual' then 'human' else mode end,
    permission = case permission when 'none' then 'read' when 'approval' then 'execute' else permission end;

alter table public.action_tasks alter column mode set default 'human';
alter table public.action_tasks alter column permission set default 'read';

alter table public.action_tasks
  add constraint action_tasks_mode_check
  check (mode in ('system', 'agent', 'human', 'human_or_agent'));

alter table public.action_tasks
  add constraint action_tasks_permission_check
  check (permission in ('read', 'write', 'execute'));

comment on column public.action_tasks.mode is
  'Who carries the task out: system (deterministic, by GetCito), agent, human, or human_or_agent.';
comment on column public.action_tasks.permission is
  'read, write (modifies owned content) or execute (acts externally). write and execute require approval unless autonomy is authorised.';
