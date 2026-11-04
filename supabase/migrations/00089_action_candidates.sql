-- Action Engine, phase 6 (#818): what the engine found but could not act on.
--
-- One active action per definition is the right rule — a brand should not be
-- handed the same piece of work twice — but it left nowhere for a second
-- finding to go. Phase 1 stopped it corrupting the open action's scope, which
-- fixed the damage without fixing the loss: a condition detected while the
-- slot was busy was linked as evidence and then forgotten, because the next
-- cycle is built from whatever happens to be open on the night the slot frees
-- up. Anything that resolved in between was simply never worked on.
--
-- A candidate is the waiting room. Every definition that matches signals
-- accumulates one; promotion is what turns it into an action, subject to the
-- slot being free, the rest window having passed, and the day's budget. The
-- generator therefore no longer decides what becomes an action while it is
-- still deciding what was found — those are two questions and they now have
-- two answers.

create table if not exists public.action_candidates (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,

  -- The definition this is waiting to become. Matches actions.kind and
  -- actions.dedup_key; a candidate is a pending action of that definition.
  definition_id text not null,

  -- 'waiting'  — has live signals behind it, has not been promoted
  -- 'promoted' — became the action named in promoted_action_id
  -- 'stale'    — the signals behind it are gone; it no longer describes
  --              anything true. Re-detection moves it back to waiting, the
  --              same lifecycle signals themselves have.
  status text not null default 'waiting'
    check (status in ('waiting', 'promoted', 'stale')),

  -- The signals this candidate would cover. Not a foreign key array by
  -- design: a signal that is deleted takes nothing with it, and the payload
  -- below is what the action would be built from either way.
  signal_ids uuid[] not null default '{}',

  impact text not null check (impact in ('high', 'medium', 'low')),

  -- What the action's payload would be, shaped by the definition at the time
  -- the candidate was last refreshed.
  payload jsonb not null default '{}'::jsonb,

  -- Score at the last scoring pass, kept so an ordering can be explained
  -- after the fact rather than recomputed and hoped to match.
  priority numeric not null default 0,

  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  promoted_at timestamptz,
  promoted_action_id uuid references public.actions(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One waiting candidate per definition per brand. Promoted and stale rows
-- pile up behind it as the record of what the queue held — the same partial
-- unique shape actions use for their active cycle (00084).
create unique index if not exists action_candidates_waiting_idx
  on public.action_candidates (brand_id, definition_id)
  where status = 'waiting';

create index if not exists action_candidates_brand_status_idx
  on public.action_candidates (brand_id, status);

-- Service-role only. No policy rather than a policy named for the service
-- role: such a policy applies to anon and authenticated, which is the
-- opposite of its name (the lesson of 00082). Nothing in the web reads this
-- table yet.
alter table public.action_candidates enable row level security;

comment on table public.action_candidates is
  'The queue of findings waiting to become actions. One waiting row per (brand, definition); promotion turns the highest-priority into an action when the slot, the rest window and the daily cap allow.';
comment on column public.action_candidates.priority is
  'Score at the last pass. Impact, weight of evidence, and how long it has waited — see config/actionEngine.js.';
