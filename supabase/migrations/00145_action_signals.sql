-- Which signals each action rests on, kept for good (AC-007).
--
-- signals.action_id holds one action per signal and was written once: a
-- signal that stayed open after its action closed kept pointing at the
-- closed action, so it could never start the next one, and no signal could be
-- shown as used by more than one action. This table keeps every link, both
-- ways: an action's supporting signals, and every action a signal has been
-- used by, including closed ones.
--
-- signals.action_id stays as the signal's current action (the latest one
-- that took it as evidence), which the signals list, its filters and the API
-- already read. The nightly generator (backend/src/lib/action-center/
-- generate.js) writes both.

create table if not exists public.action_signals (
  action_id uuid not null references public.actions(id) on delete cascade,
  signal_id uuid not null references public.signals(id) on delete cascade,
  linked_at timestamptz not null default now(),
  primary key (action_id, signal_id)
);

-- "Used by actions" reads a signal's links.
create index if not exists action_signals_signal_idx
  on public.action_signals (signal_id);

-- Every link made so far. When a signal joined its action isn't recorded;
-- the later of the two dates is the closest honest answer.
insert into public.action_signals (action_id, signal_id, linked_at)
select s.action_id, s.id, greatest(a.created_at, s.detected_at)
from public.signals s
join public.actions a on a.id = s.action_id
on conflict do nothing;

-- Members read their brands' links; only the server (service role, which
-- bypasses RLS) writes them.
alter table public.action_signals enable row level security;

create policy "action_signals: member select" on public.action_signals
  for select using (
    action_id in (
      select a.id from public.actions a
      join public.brands b on b.id = a.brand_id
      join public.profiles p on p.organization_id = b.organization_id
      where p.id = auth.uid()
    )
  );

comment on table public.action_signals is
  'Every signal an action has taken as evidence, kept after either closes (AC-007). signals.action_id is the signal''s current action.';
