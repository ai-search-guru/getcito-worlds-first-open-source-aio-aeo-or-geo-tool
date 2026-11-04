-- AC-004: an action's tasks written by a model from the action's evidence.
--
-- The writing is metered like the Improve tab's suggestions, from the same
-- monthly budget: each attempt is a prompt_improve_usage row, which now says
-- which action it wrote tasks for. And an action records when its tasks were
-- written, so the nightly sweep writes each one once.

alter table public.prompt_improve_usage
  add column if not exists action_id uuid references public.actions(id) on delete set null;

comment on column public.prompt_improve_usage.action_id is
  'The action whose tasks this generation wrote (AC-004). Null for an Improve tab generation, which names its prompt.';

alter table public.actions
  add column if not exists tasks_generated_at timestamptz;

comment on column public.actions.tasks_generated_at is
  'When a model last wrote this action''s tasks from its evidence (AC-004), or found nothing it could write. Null until then; the nightly sweep writes the ones still null.';

-- Held while a writer works on an action, so the nightly sweep and a
-- person's "Regenerate tasks" never write the same action at once. A claim
-- older than a few minutes is a writer that died and may be taken over.
alter table public.actions
  add column if not exists tasks_writing_since timestamptz;

comment on column public.actions.tasks_writing_since is
  'When a task writer (AC-004) started on this action; null when none is. Claimed and released by the writer.';

-- The sweep's read: recent actions still waiting for their tasks.
create index if not exists actions_tasks_pending_idx
  on public.actions (created_at)
  where tasks_generated_at is null;

comment on column public.action_tasks.details is
  'What a task carries beyond its title: where, why, how, doneWhen, type, effort and role (AC-004), and for a task sent from the Improve tab its body, platform, platformLabel and sources (PROMPT-004). A written task also records source = ''ai'' and the evidence refs it rests on.';
