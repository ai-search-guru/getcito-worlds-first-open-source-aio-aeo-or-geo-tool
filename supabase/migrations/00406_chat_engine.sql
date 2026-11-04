-- ============================================================================
-- 00406: Chat's engine — the events each run streamed, the state a run
-- pauses with, and its concurrency slots
-- ============================================================================
-- The engine (web lib/chat/engine.ts) runs a Chat turn as live steps that
-- pause for the person's OK (CHAT-03, CHAT-20 §5–§6, §14). Behind
-- CHAT_AGENTIC: nothing writes these tables while the flag is off.
--
--   * chat_run_events: every event a run sent to the browser, in order
--     (CHAT-00 "Streaming events"), so a lost connection resumes after the
--     last one it got and a reload rebuilds the run as it was (CHAT-03 item
--     21). Each event was made safe before it was kept (chatEvent: no tool
--     name, id field or money). Server only: the API serves them to the
--     run's author.
--   * chat_run_state: what the engine needs to pick a run up again, in
--     another request, after an approval: who it runs for, its mode, the
--     model messages so far (they hold tools' inputs and outputs, so never a
--     member's), the calls still waiting, its counters (reads, data, writes:
--     CHAT-04 item 5, CHAT-20 §14), its working time and its last event.
--     waiting_since dates the card it waits on: one left 7 days stops the
--     run. heartbeat_at is the driver's last sign of life: a running run
--     with none for long was lost and ends as timed out. Server only.
--   * chat_run_limits(): a person's runs and messages under way, for the
--     limits of CHAT-20 §14, in one read.
--   * chat_claim_run_slot(): starts a queued run when its workspace and its
--     person have a free slot (concurrent runs per plan, per person), one
--     claim at a time per workspace, so two runs can't both take the last.

-- ─── Events ─────────────────────────────────────────────────────────────────

create table if not exists public.chat_run_events (
  run_id uuid not null references public.chat_runs(id) on delete cascade,
  -- From 1 within the run: a reconnect asks for the ones after the last it got.
  seq integer not null check (seq >= 1),
  type text not null check (type ~ '^[a-z][a-z_.]{0,39}$'),
  data jsonb not null check (
    jsonb_typeof(data) = 'object' and octet_length(data::text) <= 200000
  ),
  created_at timestamptz not null default now(),
  primary key (run_id, seq)
);

comment on table public.chat_run_events is
  'Chat (00406): the events a run streamed (CHAT-00), each already safe for the browser, kept so a reconnect resumes after the last one it got and a reload rebuilds the run. Server only.';

-- ─── A run's state ──────────────────────────────────────────────────────────

create table if not exists public.chat_run_state (
  run_id uuid primary key references public.chat_runs(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- The person the run acts as (CHAT-20 §3b).
  user_id uuid not null references auth.users(id) on delete cascade,
  -- The composer's mode (CHAT-02): Ask me first, Auto, Full auto.
  mode text not null default 'auto' check (mode in ('ask_first', 'auto', 'full_auto')),
  -- The model messages of this run so far: the server's, with tools' inputs
  -- and outputs (CHAT-03 item 23 keeps them out of the answer). Up to 2 MB.
  messages jsonb not null default '[]'::jsonb check (
    jsonb_typeof(messages) = 'array' and octet_length(messages::text) <= 2000000
  ),
  -- The tool calls a waiting run left: the one on the card, and those after it.
  pending jsonb check (pending is null or jsonb_typeof(pending) = 'object'),
  -- Its phase, counters and what it read (the engine's RunProgress).
  progress jsonb not null default '{}'::jsonb check (jsonb_typeof(progress) = 'object'),
  -- Time spent working, without the waits on the person (CHAT-03 item 9).
  working_ms integer not null default 0 check (working_ms >= 0),
  last_seq integer not null default 0 check (last_seq >= 0),
  -- Since when it waits on a card or a click; null while it doesn't.
  waiting_since timestamptz,
  heartbeat_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists chat_run_state_organization_idx
  on public.chat_run_state (organization_id);
create index if not exists chat_run_state_user_idx
  on public.chat_run_state (user_id);
create index if not exists chat_run_state_waiting_idx
  on public.chat_run_state (waiting_since)
  where waiting_since is not null;

drop trigger if exists trg_chat_run_state_updated_at on public.chat_run_state;
create trigger trg_chat_run_state_updated_at
  before update on public.chat_run_state
  for each row execute function public.handle_updated_at();

comment on table public.chat_run_state is
  'Chat (00406): what the engine needs to pick a run up again after an approval: who, mode, model messages, waiting calls, counters, working time, last event. Server only.';

-- ─── Who reads and writes ───────────────────────────────────────────────────

alter table public.chat_run_events enable row level security;
alter table public.chat_run_state enable row level security;

revoke all on table public.chat_run_events from anon, authenticated;
revoke all on table public.chat_run_state from anon, authenticated;

grant all on table public.chat_run_events to service_role;
grant all on table public.chat_run_state to service_role;

-- ─── Limits (CHAT-20 §14) ───────────────────────────────────────────────────

-- A person's runs working now, their workspace's, and the messages they sent
-- in the last hour and day: what the limits are checked against. A running
-- run with no sign of life for 10 minutes was lost and isn't counted.
create or replace function public.chat_run_limits(
  p_organization_id uuid,
  p_user_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'workspaceRunning', (
      select count(*)
      from public.chat_runs r
      join public.chat_run_state s on s.run_id = r.id
      where s.organization_id = p_organization_id
        and r.status = 'running'
        and coalesce(s.heartbeat_at, s.updated_at) > now() - interval '10 minutes'
    ),
    'userRunning', (
      select count(*)
      from public.chat_runs r
      join public.chat_run_state s on s.run_id = r.id
      where s.organization_id = p_organization_id
        and s.user_id = p_user_id
        and r.status = 'running'
        and coalesce(s.heartbeat_at, s.updated_at) > now() - interval '10 minutes'
    ),
    'messagesHour', (
      select count(*)
      from public.chat_messages m
      join public.chat_conversations c on c.id = m.conversation_id
      where c.user_id = p_user_id
        and c.organization_id = p_organization_id
        and m.role = 'user'
        and m.created_at > now() - interval '1 hour'
    ),
    'messagesDay', (
      select count(*)
      from public.chat_messages m
      join public.chat_conversations c on c.id = m.conversation_id
      where c.user_id = p_user_id
        and c.organization_id = p_organization_id
        and m.role = 'user'
        and m.created_at > now() - interval '1 day'
    )
  );
$$;

-- Starts a queued run when its workspace and its person each have a free
-- slot. One claim at a time per workspace: the next waits and counts this
-- one. False when the run isn't queued or no slot is free.
create or replace function public.chat_claim_run_slot(
  p_run_id uuid,
  p_workspace_limit integer,
  p_user_limit integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_user uuid;
  v_workspace integer;
  v_person integer;
begin
  select organization_id, user_id into v_org, v_user
  from public.chat_run_state
  where run_id = p_run_id;
  if v_org is null then
    return false;
  end if;

  perform pg_advisory_xact_lock(hashtext('chat_run_slot:' || v_org::text));

  select count(*), count(*) filter (where s.user_id = v_user)
  into v_workspace, v_person
  from public.chat_runs r
  join public.chat_run_state s on s.run_id = r.id
  where s.organization_id = v_org
    and r.status = 'running'
    -- A run whose driver was lost (no sign of life for 10 minutes, the
    -- sweep's measure) frees its slot even before the sweep ends it.
    and coalesce(s.heartbeat_at, s.updated_at) > now() - interval '10 minutes';

  if v_workspace >= p_workspace_limit or v_person >= p_user_limit then
    return false;
  end if;

  update public.chat_runs
  set status = 'running', started_at = coalesce(started_at, now())
  where id = p_run_id and status = 'queued';
  return found;
end;
$$;

revoke all on function public.chat_run_limits(uuid, uuid) from public, anon, authenticated;
revoke all on function public.chat_claim_run_slot(uuid, integer, integer)
  from public, anon, authenticated;
grant execute on function public.chat_run_limits(uuid, uuid) to service_role;
grant execute on function public.chat_claim_run_slot(uuid, integer, integer) to service_role;

notify pgrst, 'reload schema';
