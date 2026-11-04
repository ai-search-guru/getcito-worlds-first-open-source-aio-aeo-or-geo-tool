-- ============================================================================
-- 00457: Chat's scheduled work — schedules and their runs, the job's chat,
-- and the spend a job draws
-- ============================================================================
-- Scheduling (CHAT-12, Wave 3), behind CHAT_AGENTIC: nothing reads or writes
-- these while the flag is off. A job is a Chat run started by the clock, in
-- a chat of its own, acting as the person who created it. The server writes
-- every row (service role), after its role, plan and brand checks; a person
-- creates a job only by clicking the confirm card (CHAT-12 item 7), and a
-- Full auto run may set one follow-up check by itself (CHAT-20 §13).
--
--   * chat_schedules: one job (CHAT-12 Data notes):
--       - when: kind once / recurring / followup_check; run_mode run_at
--         (start at due_at) or ready_by (start now, ready by due_at; once
--         jobs only); due_at, next_run_at (what the worker picks, each
--         minute), rrule (the RRULE subset agentSchedule.ts reads; recurring
--         jobs only) and the IANA time zone it is read in.
--       - what: title, the prompt or a skill's /name, the brand fixed at
--         creation (null: a chat about the whole workspace, where each tool
--         call picks its brand with the creator's access), the creator (runs
--         act as them) and the job's own chat.
--       - delivery: chat and/or email; recipient_ids are people of the
--         workspace, never addresses (a trigger checks), so no job emails
--         outside it by itself; change_only ("Notify only if the answer
--         changed", recurring only) with the last delivered fingerprint.
--       - how: mode, model and effort (Wave 3 runs on Auto · Normal).
--       - state: enabled, why it is off (cap, failed, skill_off,
--         missing_source, owner_role, manual), failed runs in a row (3 turn
--         it off) and the one retry 10 minutes after a failure.
--       - follow-up checks: what to check (target_json, metric), how it was
--         made (card: someone clicked; full_auto: a Full auto run set it),
--         and the run, agent and agent run that set it.
--     A job whose brand is deleted, or whose creator's account is, turns
--     off (missing_source, owner_role) instead of running on without them.
--   * chat_schedule_runs: one row per run of a job: the slot it ran for
--     (attempt 2 is the retry; a slot never runs twice), Run now, its Chat
--     run and answer, status (running, done, unchanged, failed, paused_cap,
--     skipped, needs_you), parts done of parts (the "1 of 3 ready" bar), the
--     fingerprint of what it read, its use as a share of the monthly AI
--     limit (never dollars), and the email's outcome.
--   * chat_conversations.schedule_id and origin 'schedule': a job's chat,
--     one live chat per job. It stays its creator's (00400, 00424): Admins
--     see the job, not the chat.
--   * prompt_improve_usage.schedule_id: the job a spend row was for
--     (CHAT-12 item 14), so a job's share is one grouped read.
--   * reserve_chat_ai_usage (00419's), taking the job: the row is named with
--     the chat's job, and a p_schedule_id that isn't the chat's is refused,
--     as p_agent_run_id is. Old calls still match.
--
-- An agent's Schedule trigger keeps its own settings in
-- chat_agent_triggers.config_json (Wave 3 decision 15): it doesn't point at
-- chat_schedules, whatever 00419's comment on config_json says.

-- ─── Jobs ───────────────────────────────────────────────────────────────────

create table if not exists public.chat_schedules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null check (kind in ('once', 'recurring', 'followup_check')),
  -- run_at: the run starts at due_at; ready_by: it starts now and must be
  -- ready by due_at (CHAT-12 item 1).
  run_mode text not null default 'run_at' check (run_mode in ('run_at', 'ready_by')),
  due_at timestamptz,
  -- What the worker picks (next_run_at <= now); null once nothing is due.
  next_run_at timestamptz,
  -- The RRULE subset web lib/chat/agentSchedule.ts reads (FREQ DAILY,
  -- WEEKLY, MONTHLY; at most once a day).
  rrule text check (char_length(rrule) between 1 and 200),
  -- IANA: the creator's, else the workspace's (CHAT-12 item 2).
  timezone text not null check (char_length(timezone) between 1 and 64),
  title text not null check (char_length(title) between 1 and 120),
  -- What it asks Chat, as a message would (engine.ts takes 20,000 at most),
  -- or the skill it runs by its /name, or both.
  prompt text check (char_length(prompt) between 1 and 20000),
  skill_name text check (char_length(skill_name) <= 64 and skill_name ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  -- Fixed at creation (CHAT-12 item 11). Null: about the whole workspace.
  brand_id uuid references public.brands(id) on delete set null,
  -- Runs act as them. Null once their account is deleted: the job is off.
  created_by uuid references auth.users(id) on delete set null,
  -- The job's own chat, where every run posts.
  conversation_id uuid references public.chat_conversations(id) on delete set null,
  deliver_to text[] not null default '{chat}' check (
    cardinality(deliver_to) between 1 and 2
    and deliver_to <@ array['chat', 'email']::text[]
    and public.chat_text_array_distinct(deliver_to)
  ),
  -- People of the workspace (the trigger below), never addresses.
  recipient_ids uuid[] not null default '{}' check (cardinality(recipient_ids) <= 20),
  -- "Notify only if the answer changed" (CHAT-12 item 20), recurring only.
  change_only boolean not null default false,
  -- sha256 of what the last delivered run read.
  last_fingerprint text check (last_fingerprint ~ '^[0-9a-f]{64}$'),
  -- The composer's modes (CHAT-02); model 'auto' or a catalog model, never a key.
  mode text not null default 'auto' check (mode in ('ask_first', 'auto', 'full_auto')),
  model text not null default 'auto' check (char_length(model) between 1 and 200),
  effort text not null default 'normal' check (effort in ('normal', 'high', 'max')),
  enabled boolean not null default true,
  -- Why it is off. Only cap resumes on its own, at the next slot after the
  -- monthly reset (CHAT-12 item 17); manual: a person turned it off.
  paused_reason text check (
    paused_reason in ('cap', 'failed', 'skill_off', 'missing_source', 'owner_role', 'manual')
  ),
  -- Failed runs in a row: 3 turn it off (failed).
  fail_count smallint not null default 0 check (fail_count >= 0),
  -- The one retry after a failure (CHAT-12 item 26).
  retry_at timestamptz,
  last_run_at timestamptz,
  -- A follow-up check's target ({url, action_id, ship_event_id, …}) and
  -- what it measures (CHAT-20 §13).
  target_json jsonb check (
    jsonb_typeof(target_json) = 'object' and octet_length(target_json::text) <= 8000
  ),
  metric text check (char_length(metric) between 1 and 64),
  -- card: a person clicked Create schedule or Set check; full_auto: a Full
  -- auto run set a follow-up check by itself (logged, with Undo).
  created_via text not null default 'card' check (created_via in ('card', 'full_auto')),
  set_by_run_id uuid references public.chat_runs(id) on delete set null,
  agent_id uuid references public.chat_agents(id) on delete set null,
  agent_run_id uuid references public.chat_agent_runs(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((kind = 'recurring') = (rrule is not null)),
  check (kind = 'recurring' or due_at is not null),
  check (run_mode = 'run_at' or kind = 'once'),
  check (prompt is not null or skill_name is not null),
  check (not change_only or kind = 'recurring'),
  check (created_via = 'card' or kind = 'followup_check'),
  check (enabled = (paused_reason is null))
);

-- What the worker reads each minute: the jobs that are on and due.
create index if not exists chat_schedules_due_idx
  on public.chat_schedules (next_run_at) where enabled and next_run_at is not null;
create index if not exists chat_schedules_retry_idx
  on public.chat_schedules (retry_at) where retry_at is not null;
-- Scheduled: the person's jobs, and an Admin's view of the workspace's.
create index if not exists chat_schedules_organization_idx
  on public.chat_schedules (organization_id, created_at desc);
create index if not exists chat_schedules_created_by_idx
  on public.chat_schedules (created_by) where created_by is not null;
create index if not exists chat_schedules_brand_idx
  on public.chat_schedules (brand_id) where brand_id is not null;
create index if not exists chat_schedules_conversation_idx
  on public.chat_schedules (conversation_id) where conversation_id is not null;
create index if not exists chat_schedules_set_by_run_idx
  on public.chat_schedules (set_by_run_id) where set_by_run_id is not null;
create index if not exists chat_schedules_agent_idx
  on public.chat_schedules (agent_id) where agent_id is not null;
create index if not exists chat_schedules_agent_run_idx
  on public.chat_schedules (agent_run_id) where agent_run_id is not null;

drop trigger if exists trg_chat_schedules_updated_at on public.chat_schedules;
create trigger trg_chat_schedules_updated_at
  before update on public.chat_schedules
  for each row execute function public.handle_updated_at();

comment on table public.chat_schedules is
  'Chat (00457): a scheduled job (CHAT-12): once, recurring or a follow-up check; when, what (prompt or skill), the brand fixed at creation, the creator it acts as, its chat, delivery (chat, email to workspace members), change-only, mode, model and effort, on/off with the reason, failures and retry. The creator and the workspace''s Admins read it; the server writes.';
comment on column public.chat_schedules.recipient_ids is
  'Who the job emails besides its creator: people of its workspace when set (a trigger checks), never addresses. Sending rechecks that each still belongs to it.';
comment on column public.chat_schedules.created_via is
  'card: a person clicked Create schedule or Set check; full_auto: a Full auto run set this follow-up check by itself (CHAT-20 §13), logged with Undo.';
comment on column public.chat_schedules.paused_reason is
  'Why the job is off: cap (resumes at the next slot after the reset), failed (3 in a row), skill_off, missing_source (its brand or task is gone), owner_role (its creator can''t run it), manual.';

-- A job emails people of its workspace only (Wave 3 decision 2): the
-- database's backstop to the server's check, when the list is set.
create or replace function public.chat_schedules_check_recipients()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1
    from unnest(new.recipient_ids) as r(id)
    where not exists (
      select 1 from public.profiles p
      where p.id = r.id and p.organization_id = new.organization_id
    )
  ) then
    raise exception 'a schedule emails people of its workspace only' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_chat_schedules_check_recipients on public.chat_schedules;
create trigger trg_chat_schedules_check_recipients
  before insert or update of recipient_ids, organization_id on public.chat_schedules
  for each row execute function public.chat_schedules_check_recipients();

-- A job whose brand or creator is gone turns off (CHAT-12 item 27): with no
-- brand it would otherwise run about the whole workspace, and with no
-- creator as nobody. Fires on the foreign keys' set null too.
create or replace function public.chat_schedules_source_gone()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.brand_id is not null and new.brand_id is null then
    new.enabled := false;
    new.paused_reason := 'missing_source';
  elsif old.created_by is not null and new.created_by is null then
    new.enabled := false;
    new.paused_reason := 'owner_role';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_chat_schedules_source_gone on public.chat_schedules;
create trigger trg_chat_schedules_source_gone
  before update of brand_id, created_by on public.chat_schedules
  for each row execute function public.chat_schedules_source_gone();

-- ─── Runs ───────────────────────────────────────────────────────────────────

create table if not exists public.chat_schedule_runs (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references public.chat_schedules(id) on delete cascade,
  -- The slot it ran for (Run now: the click's time) and the attempt: 2 is
  -- the one retry. A slot never runs twice (the unique index).
  slot_at timestamptz not null,
  attempt smallint not null default 1 check (attempt between 1 and 2),
  run_now boolean not null default false,
  -- Its Chat run and the answer it posted (the result link).
  run_id uuid references public.chat_runs(id) on delete set null,
  message_id uuid references public.chat_messages(id) on delete set null,
  status text not null default 'running' check (
    status in ('running', 'done', 'unchanged', 'failed', 'paused_cap', 'skipped', 'needs_you')
  ),
  -- Why it failed or was skipped, in plain words: never a raw error.
  reason text check (char_length(reason) between 1 and 200),
  -- The "1 of 3 ready" bar (CHAT-12 item 13); 0 of 0: one part.
  parts_done smallint not null default 0,
  parts_total smallint not null default 0 check (parts_total between 0 and 50),
  -- sha256 of the scoped results it read (CHAT-12 item 20).
  fingerprint text check (fingerprint ~ '^[0-9a-f]{64}$'),
  -- Its use as a share of the monthly AI limit ("0.6%"), never dollars.
  usage_share numeric(7, 4) not null default 0 check (usage_share >= 0),
  -- Null: no email this run.
  email_status text check (email_status in ('sent', 'failed')),
  resend_message_id text check (char_length(resend_message_id) between 1 and 200),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  check (parts_done between 0 and parts_total),
  check (ended_at is null or status <> 'running')
);

-- One run per slot and attempt: the backstop to the worker's lock.
create unique index if not exists chat_schedule_runs_slot_uidx
  on public.chat_schedule_runs (schedule_id, slot_at, attempt);
-- Run history: a job's last 20 runs (CHAT-12 item 24).
create index if not exists chat_schedule_runs_schedule_started_idx
  on public.chat_schedule_runs (schedule_id, started_at desc);
create index if not exists chat_schedule_runs_run_idx
  on public.chat_schedule_runs (run_id) where run_id is not null;
create index if not exists chat_schedule_runs_message_idx
  on public.chat_schedule_runs (message_id) where message_id is not null;

comment on table public.chat_schedule_runs is
  'Chat (00457): one run of a scheduled job (CHAT-12): its slot and attempt, Run now, its Chat run and answer, status, parts done, the fingerprint of what it read, its use as a share of the monthly AI limit, and the email''s outcome. Readable with its job; the server writes.';
comment on column public.chat_schedule_runs.usage_share is
  'What the run used, as a share of the monthly AI limit (CHAT-12 item 24). Kept by the server; never dollars.';

-- ─── A job's chat ───────────────────────────────────────────────────────────

alter table public.chat_conversations
  add column if not exists schedule_id uuid
    references public.chat_schedules(id) on delete set null;

-- A chat a scheduled job runs in (CHAT-12 item 11).
alter table public.chat_conversations
  drop constraint if exists chat_conversations_origin_check;
alter table public.chat_conversations
  add constraint chat_conversations_origin_check
    check (origin in ('page', 'panel', 'agent', 'schedule'));

-- One live chat per job: a deleted one makes room for the next.
create unique index if not exists chat_conversations_schedule_uidx
  on public.chat_conversations (schedule_id)
  where schedule_id is not null and deleted_at is null;

comment on column public.chat_conversations.schedule_id is
  'The scheduled job this chat runs (CHAT-12; origin schedule). The chat stays its creator''s. Null for a person''s own chat, and once the job is deleted.';

-- ─── Who spent it (CHAT-12 item 14) ─────────────────────────────────────────

alter table public.prompt_improve_usage
  add column if not exists schedule_id uuid
    references public.chat_schedules(id) on delete set null;

create index if not exists prompt_improve_usage_schedule_idx
  on public.prompt_improve_usage (schedule_id) where schedule_id is not null;

comment on column public.prompt_improve_usage.schedule_id is
  'The scheduled job this row was for (00457): its chat''s job. Null for other features and plain chats, and once the job is deleted.';

-- 00419's hold, taking the job. The new argument has a default, so a call
-- with the old ones still matches; the old signature goes first, or the two
-- would both match it.
drop function if exists public.reserve_chat_ai_usage(
  uuid, uuid, uuid, text, text, numeric, boolean, timestamptz, numeric, uuid, numeric
);

-- Writes the step's row and returns its id; the server turns it into the
-- step's real cost once the model answers, or deletes it when nothing was
-- billed. Null when the budget can't cover the step's worst case (p_cost),
-- or, given p_run_cap (dollars), when the agent run's spend so far, own-key
-- steps included, plus p_cost would pass it; the server tells the two apart
-- from the run's spend. On the workspace's own key (p_own_key), or with no
-- budget to hold against (p_budget null: self-hosted), the budget isn't
-- checked. The run must be the organization's, and the step, when named,
-- the run's. The agent run is the chat's (chat_conversations.agent_run_id),
-- so a subtask's step counts toward its parent's: p_agent_run_id, when
-- given, must be that one. p_run_cap is always the whole agent run's cap,
-- subtasks included, never one subtask's slice (the server checks slices).
-- The job is the chat's too (chat_conversations.schedule_id): p_schedule_id,
-- when given, must be that one. The row is named by the run's parent, the
-- agent run's agent and the chat's job.
create or replace function public.reserve_chat_ai_usage(
  p_organization_id  uuid,
  p_chat_run_id      uuid,
  p_chat_run_step_id uuid,
  p_feature          text,
  p_model            text,
  p_cost             numeric,
  p_own_key          boolean,
  p_since            timestamptz,
  p_budget           numeric,
  p_agent_run_id     uuid default null,
  p_run_cap          numeric default null,
  p_schedule_id      uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parent_id uuid;
  v_agent_run uuid;
  v_schedule  uuid;
  v_agent_id  uuid;
  v_spent     numeric;
  v_run_spent numeric;
  v_id        uuid;
begin
  if p_feature is null or p_feature not in ('chat', 'agent', 'schedule', 'image') then
    raise exception 'not a Chat feature: %', p_feature using errcode = '22023';
  end if;
  select r.parent_run_id, c.agent_run_id, c.schedule_id
    into v_parent_id, v_agent_run, v_schedule
  from public.chat_runs r
  join public.chat_conversations c on c.id = r.conversation_id
  where r.id = p_chat_run_id
    and c.organization_id = p_organization_id;
  if not found or (
    p_chat_run_step_id is not null
    and not exists (
      select 1 from public.chat_run_steps s
      where s.id = p_chat_run_step_id and s.run_id = p_chat_run_id
    )
  ) then
    raise exception 'chat run not found' using errcode = 'P0002';
  end if;
  if p_agent_run_id is not null and p_agent_run_id is distinct from v_agent_run then
    raise exception 'agent run is not the chat''s' using errcode = '22023';
  end if;
  if p_schedule_id is not null and p_schedule_id is distinct from v_schedule then
    raise exception 'schedule is not the chat''s' using errcode = '22023';
  end if;
  if p_run_cap is not null and v_agent_run is null then
    raise exception 'a run cap needs an agent run' using errcode = '22023';
  end if;

  if v_agent_run is not null then
    select a.agent_id into v_agent_id
    from public.chat_agent_runs a
    where a.id = v_agent_run
      and a.organization_id = p_organization_id;
    if not found then
      raise exception 'agent run not found' using errcode = 'P0002';
    end if;
  end if;

  if (not coalesce(p_own_key, false) and p_budget is not null) or p_run_cap is not null then
    -- The lock reserve_ai_usage takes: one hold at a time per organization.
    perform pg_advisory_xact_lock(hashtext('ai_usage:' || p_organization_id::text));
  end if;

  if not coalesce(p_own_key, false) and p_budget is not null then
    select coalesce(sum(cost_usd), 0) into v_spent
    from public.prompt_improve_usage
    where organization_id = p_organization_id
      and used_at >= p_since
      and not own_key;

    if v_spent >= p_budget or v_spent + greatest(p_cost, 0) > p_budget then
      return null;
    end if;
  end if;

  if p_run_cap is not null then
    -- Own-key steps count too: the cap stops a runaway run on any key.
    select coalesce(sum(cost_usd), 0) into v_run_spent
    from public.prompt_improve_usage
    where agent_run_id = v_agent_run;

    if v_run_spent + greatest(p_cost, 0) > p_run_cap then
      return null;
    end if;
  end if;

  insert into public.prompt_improve_usage (
    organization_id, feature, model, cost_usd, own_key, chat_run_id, chat_run_step_id,
    agent_id, agent_run_id, parent_run_id, schedule_id)
  values (
    p_organization_id, p_feature, p_model, greatest(p_cost, 0), coalesce(p_own_key, false),
    p_chat_run_id, p_chat_run_step_id, v_agent_id, v_agent_run, v_parent_id, v_schedule)
  returning id into v_id;
  return v_id;
end;
$$;

comment on function public.reserve_chat_ai_usage(uuid, uuid, uuid, text, text, numeric, boolean, timestamptz, numeric, uuid, numeric, uuid) is
  'Holds a Chat step''s worst-case cost (p_cost) under the per-organization lock, only while the period''s spend since p_since (own-key rows left out, holds in flight in) plus p_cost stays within p_budget and, given p_run_cap, the agent run''s spend (own-key rows in) plus p_cost stays within it; returns the row to settle, or null. Own-key steps and an unlimited budget (null) skip the budget check. The row is named by its run''s parent, its agent run''s agent (00419) and its chat''s scheduled job (00457).';

revoke all on function public.reserve_chat_ai_usage(uuid, uuid, uuid, text, text, numeric, boolean, timestamptz, numeric, uuid, numeric, uuid)
  from public, anon, authenticated;
grant execute on function public.reserve_chat_ai_usage(uuid, uuid, uuid, text, text, numeric, boolean, timestamptz, numeric, uuid, numeric, uuid)
  to service_role;

-- ─── Who reads and writes ───────────────────────────────────────────────────

alter table public.chat_schedules enable row level security;
alter table public.chat_schedule_runs enable row level security;

revoke all on table public.chat_schedules from anon, authenticated;
revoke all on table public.chat_schedule_runs from anon, authenticated;

grant select on table public.chat_schedules to authenticated;
grant select on table public.chat_schedule_runs to authenticated;

grant all on table public.chat_schedules to service_role;
grant all on table public.chat_schedule_runs to service_role;

-- A job: its creator, and the workspace's Admins, who may pause or delete
-- any (CHAT-12 item 25), while they belong to it. A job about a brand
-- follows the brand's access (00424's rule); one about the whole workspace
-- stays its creator's, as their own chat with no brand does.
drop policy if exists "chat_schedules: own or admin select" on public.chat_schedules;
create policy "chat_schedules: own or admin select"
  on public.chat_schedules
  for select
  to authenticated
  using (
    organization_id in (
      select p.organization_id
      from public.profiles p
      where p.id = auth.uid()
        and (p.role = 'admin' or chat_schedules.created_by = auth.uid())
    )
    and (brand_id is null or brand_id in (select public.user_brand_ids()))
  );

-- A job's runs follow it.
drop policy if exists "chat_schedule_runs: schedule select" on public.chat_schedule_runs;
create policy "chat_schedule_runs: schedule select"
  on public.chat_schedule_runs
  for select
  to authenticated
  using (schedule_id in (select s.id from public.chat_schedules s));

notify pgrst, 'reload schema';
