-- ============================================================================
-- 00421: the impact ledger — what shipped, how it was measured, and the
-- prompts it was compared against
-- ============================================================================
-- The Impact ledger (CHAT-22 feature 2; CHAT-21 §I; CHAT-09 v2), behind
-- CHAT_AGENTIC: nothing writes here while the flag is off. One data source
-- for both places that show it (Addendum 2 H): Action Center › History (the
-- outcome per action) and Reports › "What GetCito did for you". Every
-- number is the server's, from scheduled tracking data only (Addendum 2 G):
-- no engine query and no model call measures anything here. The server
-- writes every row (service role); every member of the workspace reads them
-- (the ledger is for every role, CHAT-22 Permissions).
--
--   * ship_events: a change that went live (CHAT-22 §2 item 1): a CMS
--     publish the connection confirmed, a merged PR (feature 4, later), a
--     person's Mark as shipped (WRITE, with Undo: the server deletes the
--     row), or a third-party placement first seen in tracked answers. What
--     shipped (a Files deliverable, a Content draft, the live URL), the
--     action it belongs to (whose frozen targets are measured), where it
--     came from (Chat, Action Center, the Content Editor), its kind of
--     change, the run and agent behind it, who shipped it and how (History's
--     execution.mode: manual, assisted, automated). Drafts are not shipped.
--   * impact_measurements: one per ship event (§2 item 12): the targets
--     (History's AffectedEntity[]: prompts, URLs, topics, engines…), the
--     latest checkpoint's window and metrics (ActionResultMetric[]), the
--     outcome in the one vocabulary (Pending, Improved, No meaningful
--     change, Declined, Not measurable) with its confidence, the checkpoint
--     (d7 "early signal" with no verdict, d14 first verdict, d30 confirmed,
--     d90 lasting effect) and each checkpoint's own result, why it isn't
--     measurable, and the other changes in its window. next_check_at is
--     when the measuring job comes back; null after day 90.
--   * impact_control_sets: the control prompts a checkpoint compared the
--     targets with (§2 item 7): same brand and engines, never a target in
--     the window, matched by topic, pre-window band (±10 pts) and engine.
--     One per measurement and checkpoint, since a control that becomes a
--     target leaves the later checkpoints.
--
-- Action Center's own tables don't change: wiring History to read these
-- rows is the Action Center's change, after its owner signs off (CHAT-22 §2
-- item 12).

-- ─── What shipped ───────────────────────────────────────────────────────────

create table if not exists public.ship_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  brand_id uuid not null references public.brands(id) on delete cascade,
  kind text not null check (kind in ('cms_publish', 'pr_merged', 'manual', 'third_party_observed')),
  -- The change as the ledger names it ("FAQ block on /pricing").
  title text not null check (char_length(title) between 1 and 200),
  -- What shipped: a deliverable, a Content draft, the page as it is live.
  file_id uuid references public.chat_files(id) on delete set null,
  content_draft_id uuid references public.content_drafts(id) on delete set null,
  url text check (char_length(url) between 1 and 2000),
  -- The action it belongs to: its frozen targets are the measurement's.
  action_id uuid references public.actions(id) on delete set null,
  -- The ledger's filters: where it came from and what kind of change it was.
  source text not null check (source in ('chat', 'action_center', 'content_editor')),
  change_type text check (change_type in ('content', 'technical', 'outreach')),
  run_id uuid references public.chat_runs(id) on delete set null,
  agent_id uuid references public.chat_agents(id) on delete set null,
  -- The agent run that shipped it, for the run's Outcome (CHAT-21 §I item 43).
  agent_run_id uuid references public.chat_agent_runs(id) on delete set null,
  shipped_at timestamptz not null,
  -- The person who shipped it or marked it; null for an integration or an
  -- agent on its own.
  shipped_by uuid references auth.users(id) on delete set null,
  execution_mode text not null check (execution_mode in ('manual', 'assisted', 'automated')),
  created_at timestamptz not null default now()
);

-- What GetCito did for you: the workspace's month, and a brand's.
create index if not exists ship_events_organization_shipped_idx
  on public.ship_events (organization_id, shipped_at desc);
create index if not exists ship_events_brand_shipped_idx
  on public.ship_events (brand_id, shipped_at desc);
-- Action Center › History: an action's.
create index if not exists ship_events_action_idx
  on public.ship_events (action_id) where action_id is not null;
create index if not exists ship_events_file_idx
  on public.ship_events (file_id) where file_id is not null;
create index if not exists ship_events_content_draft_idx
  on public.ship_events (content_draft_id) where content_draft_id is not null;
create index if not exists ship_events_run_idx
  on public.ship_events (run_id) where run_id is not null;
create index if not exists ship_events_agent_idx
  on public.ship_events (agent_id) where agent_id is not null;
create index if not exists ship_events_agent_run_idx
  on public.ship_events (agent_run_id) where agent_run_id is not null;

comment on table public.ship_events is
  'Impact ledger (00421): a change that went live (CHAT-22 §2 item 1): CMS publish, merged PR, Mark as shipped or a third-party placement; what shipped, its action, source, change type, run, agent, when, by whom and how. Every member reads; the server writes.';
comment on column public.ship_events.execution_mode is
  'Action Center History''s execution.mode: manual (a person did it), assisted (Chat drafted, a person shipped), automated (an agent or integration shipped it).';

-- ─── How it was measured ────────────────────────────────────────────────────

create table if not exists public.impact_measurements (
  id uuid primary key default gen_random_uuid(),
  ship_event_id uuid not null unique references public.ship_events(id) on delete cascade,
  -- AffectedEntity[]: {type: prompt | url | keyword | topic | citation |
  -- competitor | platform, id, label}; at most 50 prompts.
  targets jsonb not null default '[]'::jsonb check (
    jsonb_typeof(targets) = 'array' and octet_length(targets::text) <= 200000
  ),
  -- The latest checkpoint's {pre_start, pre_end, post_start, post_end}.
  window_json jsonb not null default '{}'::jsonb check (jsonb_typeof(window_json) = 'object'),
  -- The latest checkpoint's ActionResultMetric[]: {metric, before, after,
  -- delta, control_before, control_after, effect, p_value, interval_low,
  -- interval_high…}.
  metrics jsonb not null default '[]'::jsonb check (
    jsonb_typeof(metrics) = 'array' and octet_length(metrics::text) <= 100000
  ),
  outcome text not null default 'pending' check (
    outcome in ('pending', 'improved', 'no_meaningful_change', 'declined', 'not_measurable')
  ),
  confidence text check (confidence in ('low', 'medium', 'high')),
  -- The latest checkpoint measured; null before day 7.
  checkpoint text check (checkpoint in ('d7', 'd14', 'd30', 'd90')),
  -- One result per checkpoint, oldest first (the row shows a changed verdict).
  checkpoints_json jsonb not null default '[]'::jsonb check (
    jsonb_typeof(checkpoints_json) = 'array' and octet_length(checkpoints_json::text) <= 100000
  ),
  -- A code the page words: too_few_runs, too_few_controls, targets_removed,
  -- engine_not_on_plan, overlapping_change…
  not_measurable_reason text check (not_measurable_reason ~ '^[a-z_]{1,40}$'),
  -- Other changes in the window: engine weather, prompt-set edits,
  -- competitor moves, other ship events on the same targets.
  concurrent_changes jsonb not null default '[]'::jsonb check (
    jsonb_typeof(concurrent_changes) = 'array' and octet_length(concurrent_changes::text) <= 100000
  ),
  next_check_at timestamptz,
  measured_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A verdict has a confidence; Pending and Not measurable have none.
  check ((confidence is not null) = (outcome in ('improved', 'no_meaningful_change', 'declined'))),
  check ((not_measurable_reason is not null) = (outcome = 'not_measurable')),
  check (outcome = 'pending' or checkpoint is not null)
);

-- The measuring job: what is due.
create index if not exists impact_measurements_next_check_idx
  on public.impact_measurements (next_check_at) where next_check_at is not null;

drop trigger if exists trg_impact_measurements_updated_at on public.impact_measurements;
create trigger trg_impact_measurements_updated_at
  before update on public.impact_measurements
  for each row execute function public.handle_updated_at();

comment on table public.impact_measurements is
  'Impact ledger (00421): one measurement per ship event (CHAT-22 §2 item 12), read by Action Center › History and Reports › What GetCito did for you alike: targets, window, metrics, outcome and confidence, checkpoint d7/d14/d30/d90 with each one''s result, why not measurable, concurrent changes. Every member reads; the server writes.';
comment on column public.impact_measurements.outcome is
  'Pending (before day 14; day 7 shows direction only), Improved, No meaningful change, Declined or Not measurable (CHAT-22 §2 item 10). Never set from task completion alone.';

-- ─── What it was compared against ───────────────────────────────────────────

create table if not exists public.impact_control_sets (
  id uuid primary key default gen_random_uuid(),
  impact_measurement_id uuid not null
    references public.impact_measurements(id) on delete cascade,
  checkpoint text not null check (checkpoint in ('d7', 'd14', 'd30', 'd90')),
  -- The control prompts × engines, as AffectedEntity[].
  entities jsonb not null default '[]'::jsonb check (
    jsonb_typeof(entities) = 'array' and octet_length(entities::text) <= 200000
  ),
  -- How they were matched: {topic, band_pts, engines}.
  match_rules_json jsonb not null default '{}'::jsonb check (jsonb_typeof(match_rules_json) = 'object'),
  -- Prompt × engine cells: fewer than 10 make the checkpoint Not measurable.
  cell_count integer not null default 0 check (cell_count >= 0),
  created_at timestamptz not null default now(),
  unique (impact_measurement_id, checkpoint)
);

comment on table public.impact_control_sets is
  'Impact ledger (00421): the control prompts one checkpoint of a measurement compared its targets with (CHAT-22 §2 item 7), and how they were matched. Every member reads; the server writes.';

-- ─── Who reads and writes ───────────────────────────────────────────────────

alter table public.ship_events enable row level security;
alter table public.impact_measurements enable row level security;
alter table public.impact_control_sets enable row level security;

revoke all on table public.ship_events from anon, authenticated;
revoke all on table public.impact_measurements from anon, authenticated;
revoke all on table public.impact_control_sets from anon, authenticated;

grant select on table public.ship_events to authenticated;
grant select on table public.impact_measurements to authenticated;
grant select on table public.impact_control_sets to authenticated;

grant all on table public.ship_events to service_role;
grant all on table public.impact_measurements to service_role;
grant all on table public.impact_control_sets to service_role;

-- The workspace's members, while they belong to it. Brands are its
-- membership today (Agency partners' shared brands come later).
drop policy if exists "ship_events: member select" on public.ship_events;
create policy "ship_events: member select"
  on public.ship_events
  for select
  using (
    organization_id in (
      select p.organization_id from public.profiles p where p.id = auth.uid()
    )
  );

-- Measurements follow their ship event, control sets their measurement.
drop policy if exists "impact_measurements: ship event select" on public.impact_measurements;
create policy "impact_measurements: ship event select"
  on public.impact_measurements
  for select
  using (ship_event_id in (select s.id from public.ship_events s));

drop policy if exists "impact_control_sets: measurement select" on public.impact_control_sets;
create policy "impact_control_sets: measurement select"
  on public.impact_control_sets
  for select
  using (impact_measurement_id in (select m.id from public.impact_measurements m));

notify pgrst, 'reload schema';
