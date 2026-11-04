-- ============================================================================
-- 00249: the Content Agent's runs, step by step
-- ============================================================================
-- Content Editor v1.1, CE-027 and CE-035: while the agent works, the editor
-- shows its real steps, short names for the work the server does ("Reading 4
-- rules → Gathering 52 sources → Writing 3 changes → Checking sources"), and
-- Stop. The server writes each run here as it goes; the
-- editor reads the draft's latest. Stop marks it stopped: the server drops
-- whatever the run had and changes nothing.
--
-- A table of its own, not columns on content_drafts: a step written there
-- would move the draft's updated_at, which the editor's saves check against.
--
-- steps: [{ "key", "count" }], key one of read_rules, gather_sources,
-- write_changes, rewrite_page, write_page, write_outline, match_fanouts,
-- check_sources; count null where there is none.
-- step: the one under way (steps' index); all done once finished.
-- outcome is what happened: a Stop that lands after the run's last check
-- may leave stopped_at set on a run that ended 'done'. A run a stopped server
-- left unfinished is closed 'failed' when the next starts on the draft.
-- claimed_at: a Start or Rewrite run's claim on the draft (the
-- content_drafts.agent_state_at it wrote); null for Fix and the brief, which
-- hold no draft. A Stop lets go only of the claim the stopped run holds, so a
-- Stop on a Fix leaves a Start on the same draft its claim.
create table if not exists public.content_agent_runs (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references public.content_drafts (id) on delete cascade,
  kind text not null check (kind in ('fix', 'rewrite', 'write', 'brief')),
  steps jsonb not null check (
    jsonb_typeof(steps) = 'array' and jsonb_array_length(steps) between 1 and 6
  ),
  step smallint not null default 0 check (step between 0 and 6),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  stopped_at timestamptz,
  outcome text check (outcome in ('done', 'stopped', 'failed')),
  claimed_at timestamptz
);

-- For a database that ran this file before claimed_at was added to it.
alter table public.content_agent_runs add column if not exists claimed_at timestamptz;

create index if not exists content_agent_runs_draft_started
  on public.content_agent_runs (draft_id, started_at desc);

alter table public.content_agent_runs enable row level security;

-- A draft the member can read is one in their organization (content_drafts'
-- own member policies), so its runs follow it, as its suggestions do (00217).
create policy "content_agent_runs: member select"
  on public.content_agent_runs
  for select
  using (draft_id in (select d.id from public.content_drafts d));

grant select on public.content_agent_runs to authenticated;

comment on table public.content_agent_runs is
  'Content Editor v1.1 (CE-027/035): the Content Agent''s runs on a draft, step by step, and whether one was stopped (00249). Written by the server; read by the editor.';
