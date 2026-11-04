-- Action Engine, phase 5 (#818): a task is planned, not copied.
--
-- Every action of a given kind was given the same task list, inline in its
-- definition, regardless of what the brand had. A brand with no analytics
-- connection was still told to check what a visibility drop cost in sessions.
-- The task registry (backend/src/lib/action-center/tasks) turns each task into
-- a primitive with an identity and a data contract, and the planner selects
-- from it per action. These columns are what the plan needs to survive the
-- trip through the database.
--
-- Every one is additive with a default that reproduces today's behaviour, so
-- the 111 tasks already out there stay exactly as they are: a manual task
-- needing no approval, depending on nothing, naming nothing.

alter table public.action_tasks
  -- Which version of the task primitive planned this row, for the same
  -- reason an action records its definition's (00086): a task that is
  -- reworded or re-scoped must not rewrite what someone was already asked.
  add column if not exists task_version integer not null default 1,

  -- Who can carry it out. 'agent' is work over data we already hold;
  -- 'manual' changes something we do not own.
  add column if not exists mode text not null default 'manual',

  -- Whether carrying it out reaches outside GetCito. Nothing executes yet
  -- (phase 7) — this is the declaration phase 7 reads before it does.
  add column if not exists permission text not null default 'none',

  -- Task keys that must finish first. Ordering used to be implied by
  -- `position` and enforced by nobody.
  add column if not exists depends_on text[] not null default '{}',

  -- Values the task's text names — the platform, the competitor, the count.
  -- Parameters rather than resolved text, so the plan stays translatable.
  add column if not exists title_params jsonb not null default '{}'::jsonb,

  -- What the task produced, so one task's finding can feed the next instead
  -- of living in someone's head. Null until something fills it.
  add column if not exists output jsonb;

alter table public.action_tasks
  drop constraint if exists action_tasks_mode_check;
alter table public.action_tasks
  add constraint action_tasks_mode_check check (mode in ('manual', 'agent'));

alter table public.action_tasks
  drop constraint if exists action_tasks_permission_check;
alter table public.action_tasks
  add constraint action_tasks_permission_check check (permission in ('none', 'approval'));

alter table public.action_tasks
  drop constraint if exists action_tasks_task_version_check;
alter table public.action_tasks
  add constraint action_tasks_task_version_check check (task_version >= 1);

comment on column public.action_tasks.mode is
  'Who carries the task out: manual (a person) or agent (work over data we hold).';
comment on column public.action_tasks.permission is
  'approval when carrying it out reaches outside GetCito; none otherwise.';
comment on column public.action_tasks.depends_on is
  'Task keys within the same action that must finish first. Only keys actually planned appear here.';
comment on column public.action_tasks.title_params is
  'Values the task text names, as i18n parameters. Empty when the task names nothing specific.';
