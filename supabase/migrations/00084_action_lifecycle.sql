-- Action Engine, phase 1 (#818): an action becomes a cycle rather than a row.
--
-- 00081 gave every action `dedup_key = kind` under `unique (brand_id,
-- dedup_key)`, so a brand held at most one action per kind for its entire
-- lifetime. Three consequences, all wrong:
--
--   * the nightly pass overwrote an open action's payload, so a new problem
--     silently became the old one's description — including for an action
--     someone was already working on;
--   * a completed action was resurrected by setting status back to 'new' and
--     clearing completed_at, which erased the historical record rather than
--     adding to it;
--   * a definition could therefore never produce a second execution cycle,
--     so History had nothing to accumulate.
--
-- The rule the engine actually wants is one *active* action per kind, not one
-- ever. A partial unique index says exactly that: open actions still collide,
-- closed ones are free to pile up behind them.
--
-- Separately, `no_improvement` has been sitting in the status column since
-- 00081. It is not an execution status — an action reaches it by being
-- completed and then measured. Execution status answers "was the work done";
-- outcome answers "did the work help". Conflating them makes the second
-- question unanswerable for an action that was completed but never measured,
-- which today is all of them.

-- ─── One active action per kind, unlimited closed ones ──────────────────────

alter table public.actions
  drop constraint if exists actions_brand_id_dedup_key_key;

-- 'dismissed' joins 'completed' as terminal: both mean the cycle is over and
-- the slot is free. A dismissed action is not reopened — the user said no.
create unique index if not exists actions_active_dedup_idx
  on public.actions (brand_id, dedup_key)
  where status not in ('completed', 'dismissed');

-- ─── Outcome, separate from execution status ────────────────────────────────

alter table public.actions
  add column if not exists outcome text not null default 'pending_measurement';

alter table public.actions
  drop constraint if exists actions_outcome_check;

alter table public.actions
  add constraint actions_outcome_check
  check (outcome in (
    'pending_measurement',
    'improved',
    'no_meaningful_change',
    'declined',
    'not_measurable'
  ));

comment on column public.actions.outcome is
  'Did the work help? Measured after completion, independent of status. Phase 2 (#818) fills this; until then every row reads pending_measurement.';

comment on column public.actions.status is
  'Was the work done? Execution only — never an outcome.';

-- Rows that reached 'no_improvement' were completed and then judged. Split
-- that into the two facts it always was.
alter table public.actions
  drop constraint if exists actions_status_check;

update public.actions
set status = 'completed',
    outcome = 'no_meaningful_change',
    completed_at = coalesce(completed_at, updated_at)
where status = 'no_improvement';

-- A dismissed action was never executed, so there is nothing to measure.
update public.actions
set outcome = 'not_measurable'
where status = 'dismissed';

alter table public.actions
  add constraint actions_status_check
  check (status in ('new', 'in_progress', 'on_hold', 'completed', 'dismissed'));

-- ─── Task statuses: skipped, failed, waiting approval ───────────────────────
--
-- 00083 renamed 'blocked' to 'canceled'. The execution vocabulary the task
-- specification settles on is Skipped — with a stored reason, because "we
-- decided not to" is only useful if it says why — alongside Failed for a run
-- that was attempted and did not work, and Waiting Approval for an external
-- write that needs a person.

alter table public.action_tasks
  add column if not exists skip_reason text;

comment on column public.action_tasks.skip_reason is
  'Why this task was skipped. Required in the UI when moving to skipped; a skip without a reason is indistinguishable from an abandoned task.';

alter table public.action_tasks
  drop constraint if exists action_tasks_status_check;

update public.action_tasks set status = 'skipped' where status = 'canceled';

alter table public.action_tasks
  add constraint action_tasks_status_check
  check (status in (
    'todo',
    'in_progress',
    'waiting_approval',
    'completed',
    'skipped',
    'failed'
  ));
