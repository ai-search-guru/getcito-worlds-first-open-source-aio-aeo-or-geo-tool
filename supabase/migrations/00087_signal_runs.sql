-- A ledger for the nightly signal pass (#818).
--
-- The pass — record signals, then consolidate them into actions — has been
-- fire-and-forget since it was written: a failure logs and the night is gone.
-- Nothing recorded that it had run, so nothing could tell a brand with no
-- conditions firing from a brand whose pass threw, and nothing could pick a
-- lost night back up. On the largest brand it threw every night for six days
-- (its aggregate queries crossed the statement timeout) and the first anyone
-- knew was the Action Center looking stale.
--
-- One row per (brand, tracking run) once the pass has finished for that run.
-- That makes two things possible: the catch-up sweep can ask "which stamped
-- runs have no pass?", and anyone can answer "did it run last night?" without
-- reading server logs.
--
-- The pulse has had exactly this since #702, in `sent_pulses`. This is its
-- counterpart for the half of the trigger that never got one.

create table if not exists public.signal_runs (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,

  -- The tracking run this pass covered, by its completion stamp. The pair is
  -- unique so a retry is idempotent and a catch-up cannot double-run.
  tracking_run_at timestamptz not null,

  ran_at timestamptz not null default now(),

  -- 'recorded'  — the pass ran and wrote what it found
  -- 'skipped'   — it ran and deliberately did nothing (no fresh results)
  outcome text not null check (outcome in ('recorded', 'skipped')),

  -- Counts from the pass, for answering "what did last night do" cheaply.
  detail jsonb not null default '{}'::jsonb,

  unique (brand_id, tracking_run_at)
);

create index if not exists signal_runs_brand_ran_idx
  on public.signal_runs (brand_id, ran_at desc);

-- Service-role only, and deliberately with no policies rather than a policy
-- named for the service role: such a policy applies to anon and authenticated
-- (service_role bypasses RLS entirely), which is the opposite of its name.
-- No policy means the web cannot read this table; nothing in the web does.
alter table public.signal_runs enable row level security;

comment on table public.signal_runs is
  'One row per completed nightly signal pass. Drives the catch-up sweep and answers whether the pass ran for a given tracking run.';
