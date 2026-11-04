-- Action Center: actions, their tasks, and their event trail.
--
-- An action is a measurable outcome to achieve, produced by consolidating
-- open signals (many signals → one action); a task is one execution step
-- under it. The three concepts stay separate tables on purpose — the brief's
-- rule that Signal, Action and Task are never interchangeable is enforced by
-- the schema, not by convention.
--
-- Like signals, nothing display-shaped is stored: `kind` keys into i18n
-- templates code-side, `payload` carries the interpolation values, and the
-- category/impact/status columns exist because the page filters on them.
--
-- `baseline` snapshots the linked signals' measured values at creation time.
-- Nothing reads it yet — it is the "before" half that the future validation
-- layer (before → execution → after) will compare against, stored now
-- because it cannot be reconstructed later.

create table public.actions (
  id uuid primary key default gen_random_uuid(),
  -- Human-readable identity ("AC-1258") — a global counter, shown in the
  -- drawer so people can refer to an action in conversation.
  action_no bigint generated always as identity,
  brand_id uuid not null references public.brands(id) on delete cascade,

  category text not null
    check (category in ('growth', 'protect', 'recover', 'fix', 'compete')),
  kind text not null,
  impact text not null check (impact in ('high', 'medium', 'low')),

  -- Outcome-oriented lifecycle, not to-do/done: an executed action can fail
  -- validation (no_improvement), and that result must stay visible.
  status text not null default 'new'
    check (status in ('new', 'in_progress', 'completed', 'on_hold', 'no_improvement', 'dismissed')),

  payload jsonb not null default '{}'::jsonb,
  kpi_keys text[] not null default '{}',
  baseline jsonb not null default '{}'::jsonb,

  assignee_id uuid references public.profiles(id) on delete set null,
  due_date date,

  dedup_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,

  unique (brand_id, dedup_key)
);

create index actions_brand_status_idx on public.actions (brand_id, status);

create table public.action_tasks (
  id uuid primary key default gen_random_uuid(),
  action_id uuid not null references public.actions(id) on delete cascade,
  position integer not null,
  -- Key into the code-side task templates for this action's kind.
  task_key text not null,
  status text not null default 'todo'
    check (status in ('todo', 'in_progress', 'completed', 'blocked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (action_id, task_key)
);

create index action_tasks_action_idx on public.action_tasks (action_id);

-- Append-only lifecycle trail: created, status changes, assignments, task
-- completions. The drawer's History tab reads it verbatim; completed
-- actions carry their whole story into the History page later.
create table public.action_events (
  id uuid primary key default gen_random_uuid(),
  action_id uuid not null references public.actions(id) on delete cascade,
  event text not null,
  data jsonb not null default '{}'::jsonb,
  -- Null for system events (the nightly generator); a profile id when a
  -- person did it.
  actor_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index action_events_action_idx on public.action_events (action_id, created_at);

-- The signals column that waited for this table.
alter table public.signals
  add constraint signals_action_id_fkey
  foreign key (action_id) references public.actions(id) on delete set null;

-- ─── Row level security ──────────────────────────────────────────────────────
-- Members read everything and do the work: change status, assign, set due
-- dates, move tasks. The service role (nightly generator) inserts and
-- deletes. Events are also member-insertable so user actions can log
-- themselves through RLS rather than needing the admin client.

alter table public.actions enable row level security;
alter table public.action_tasks enable row level security;
alter table public.action_events enable row level security;

create policy "actions: member select" on public.actions
  for select using (
    brand_id in (
      select b.id from public.brands b
      join public.profiles p on p.organization_id = b.organization_id
      where p.id = auth.uid()
    )
  );

create policy "actions: member update" on public.actions
  for update using (
    brand_id in (
      select b.id from public.brands b
      join public.profiles p on p.organization_id = b.organization_id
      where p.id = auth.uid()
    )
  );

create policy "Service role can insert actions" on public.actions
  for insert with check (true);
create policy "Service role can delete actions" on public.actions
  for delete using (true);

create policy "action_tasks: member select" on public.action_tasks
  for select using (
    action_id in (
      select a.id from public.actions a
      join public.brands b on b.id = a.brand_id
      join public.profiles p on p.organization_id = b.organization_id
      where p.id = auth.uid()
    )
  );

create policy "action_tasks: member update" on public.action_tasks
  for update using (
    action_id in (
      select a.id from public.actions a
      join public.brands b on b.id = a.brand_id
      join public.profiles p on p.organization_id = b.organization_id
      where p.id = auth.uid()
    )
  );

create policy "Service role can insert action tasks" on public.action_tasks
  for insert with check (true);
create policy "Service role can delete action tasks" on public.action_tasks
  for delete using (true);

create policy "action_events: member select" on public.action_events
  for select using (
    action_id in (
      select a.id from public.actions a
      join public.brands b on b.id = a.brand_id
      join public.profiles p on p.organization_id = b.organization_id
      where p.id = auth.uid()
    )
  );

create policy "action_events: member insert" on public.action_events
  for insert with check (
    action_id in (
      select a.id from public.actions a
      join public.brands b on b.id = a.brand_id
      join public.profiles p on p.organization_id = b.organization_id
      where p.id = auth.uid()
    )
  );

create policy "Service role can delete action events" on public.action_events
  for delete using (true);
