-- Action Engine, phase 4 (#818): an action remembers the rule that raised it.
--
-- Definitions move out of the generator into their own registry, where each
-- one carries a version its author bumps when what it means changes — a
-- different threshold, a different task list, a different scope. Without the
-- version stored on the action, an action raised in March can only ever be
-- read against today's rules, and the History tab quietly rewrites its own
-- past every time a definition is tuned. The same reasoning as resolving a
-- task's text at creation (00083): the record says what happened, not what
-- would happen now.
--
-- Existing rows get 1, which is what every definition is on today.

alter table public.actions
  add column if not exists definition_version integer not null default 1;

alter table public.actions
  drop constraint if exists actions_definition_version_check;

alter table public.actions
  add constraint actions_definition_version_check
  check (definition_version >= 1);

comment on column public.actions.definition_version is
  'Version of the action definition (backend/src/lib/action-center/definitions) that raised this action. Historical rows keep the rules they were raised under.';
