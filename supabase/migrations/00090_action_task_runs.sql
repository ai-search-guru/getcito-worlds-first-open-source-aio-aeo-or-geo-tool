-- Action Engine, phase 7 (#818): what an automated task actually did.
--
-- Phase 5 marked every task with who could carry it out and whether carrying
-- it out reaches outside GetCito. Nothing acted on either. This is the layer
-- that does, and the first thing it needs is a record — because an automated
-- step nobody can audit is worse than a manual one nobody automated.
--
-- One row per attempt, successful or not. Attempts are kept rather than
-- overwritten: a task that failed twice and then worked is a different story
-- from one that worked first time, and the difference is the one an operator
-- needs.
--
-- What is deliberately NOT stored: the model's reasoning. Inputs, the tool
-- called, its arguments, its result and any error — those are the record.
-- Chain-of-thought is not evidence, it is not reliable as explanation, and
-- exposing it invites people to treat it as either. Anything a run wants to
-- claim it must claim in `output`, where the next task can read it.

create table if not exists public.action_task_runs (
  id uuid primary key default gen_random_uuid(),

  task_id uuid not null references public.action_tasks(id) on delete cascade,
  -- Denormalised so a brand's whole execution history is one query, and so a
  -- run survives in context when its task is read on its own.
  action_id uuid not null references public.actions(id) on delete cascade,
  brand_id uuid not null references public.brands(id) on delete cascade,

  -- The tool the task was carried out with, and the version of it. A tool
  -- whose behaviour changes gets a new version, so an old run stays readable
  -- against the rules it ran under — as actions and tasks already do.
  tool_id text,
  tool_version integer,

  -- 'succeeded' — the tool ran and its result was stored
  -- 'failed'    — it threw; the task fails, the action does not
  -- 'blocked'   — it was not allowed to run: awaiting approval, a source the
  --               brand does not have, a dependency not finished, or no tool
  --               for this task yet. `error` says which.
  status text not null check (status in ('succeeded', 'failed', 'blocked')),

  -- What the tool was given and what it returned. Both are structured and
  -- both are the audit trail; `output` is also what the task stores and what
  -- downstream tasks read.
  input jsonb not null default '{}'::jsonb,
  output jsonb,
  error text,

  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists action_task_runs_task_idx
  on public.action_task_runs (task_id, started_at desc);

create index if not exists action_task_runs_brand_idx
  on public.action_task_runs (brand_id, started_at desc);

-- Who authorised a task that reaches outside GetCito, and when.
--
-- Separate from the run so the authorisation survives the attempt: a run that
-- failed on a network error must not need a second human decision, and an
-- approval that was given must stay auditable even if every attempt failed.
alter table public.action_tasks
  add column if not exists approved_by uuid references public.profiles(id) on delete set null,
  add column if not exists approved_at timestamptz;

comment on column public.action_tasks.approved_by is
  'Who authorised this task to reach outside GetCito. Required before a task whose permission is ''approval'' may run; null means it has not been authorised.';

alter table public.action_task_runs enable row level security;

comment on table public.action_task_runs is
  'One row per attempt to carry out a task automatically. Inputs, tool, result and error — never the model''s reasoning.';
