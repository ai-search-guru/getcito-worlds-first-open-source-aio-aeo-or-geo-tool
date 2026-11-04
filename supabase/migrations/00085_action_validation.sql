-- Action Engine, phase 2 (#818): measure whether a closed action helped.
--
-- 00084 split `outcome` from `status` and left every row reading
-- `pending_measurement`, because nothing re-read an action's metrics after it
-- closed. `baseline` recorded the "before" — the triggering signals' values at
-- the moment the action was raised — but there was no "after" to compare it
-- to, so History's Result column could only say that nothing had been
-- measured.
--
-- This is where the "after" goes. A nightly sweep waits out a settling period
-- after a cycle closes, measures the action's own success metrics over a
-- window before it was raised and a window after it closed, and writes both
-- halves here. Outcome is then derived from the comparison rather than from
-- whether the tasks got ticked — completing the work and the work helping are
-- different claims, and only the second one needs evidence.
--
-- The measurement reads the same daily rollups the KPI page reads, so an
-- action's result and the dashboard it summarises cannot disagree.

alter table public.actions
  add column if not exists validation jsonb;

comment on column public.actions.validation is
  $$Measured effect of a closed action. Null until the sweep runs. Shape:
{ "measuredAt": iso,
  "beforeWindow": { "from": date, "to": date },
  "afterWindow":  { "from": date, "to": date },
  "metrics": [ { "metric": kpi_key, "unit": text, "before": num|null, "after": num|null } ] }
Deltas are derived at read time rather than stored, so a stored delta can
never contradict the two values it came from.$$;

alter table public.actions
  add column if not exists validated_at timestamptz;

comment on column public.actions.validated_at is
  'When the effect was measured. Null while outcome is pending_measurement.';

-- The sweep looks for closed actions still awaiting measurement. Without this
-- it scans every action a brand has ever had, every night, forever.
create index if not exists actions_pending_validation_idx
  on public.actions (completed_at)
  where outcome = 'pending_measurement' and status = 'completed';
