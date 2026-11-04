-- ============================================================================
-- 00419: Chat's agents — definitions, versions, triggers and runs; subtasks
-- and each agent's share of the AI budget
-- ============================================================================
-- Agents (CHAT-21) and sub-agents with agent AI budgets (CHAT-27, Phase 1
-- and section E), behind CHAT_AGENTIC: nothing reads or writes these while
-- the flag is off. An agent is one saved object that starts Chat runs (owner
-- decision 4): no second runtime, no key of its own, no tool list of its own.
-- These are Chat's tables only: no Content Editor or Action Center table is
-- changed (CHAT-21 boundary). The server writes every row (service role),
-- after its role, plan and activation checks.
--
--   * chat_agents: the definition (CHAT-21 data model `agent`): name (1–60,
--     unique in the workspace), status draft → active ⇄ paused → archived
--     (deleted for good from archived only), why it is paused, the owner
--     (the Admin or Manager who activated it: its triggered runs act as
--     them, Addendum 2 H), who sees it (private: its owner and Admins;
--     workspace: every member, read-only for Analysts and Agency partners),
--     the version runs start with, failed runs in a row (3 pause it), and
--     its AI caps as shares of the monthly AI limit (CHAT-27 items 19, 23):
--     max_run_share per run (10% by default, 1–50%) and max_month_share a
--     month (none by default).
--   * chat_agent_versions: what the agent does, one immutable row per save
--     (§C item 14): skills in order (1 primary + up to 2 follow-on),
--     instructions (≤ 2,000), mode, connections ({key, required}), model and
--     effort, scope (brands or all, topics, tags, engines, URLs), who is
--     notified when it needs someone, and the follow-up check's day (14).
--     A run keeps the version it started with.
--   * chat_agent_triggers: what starts it (§E): a schedule (its CHAT-12
--     schedule row, Wave 3), a Signal, a KPI change or a watch rule, 1–5 an
--     agent; config_json holds each kind's settings. Run now and Run agent
--     on an action are always on and have no row. last_fired_at and
--     cooldown_until are the noise control's (§E item 24).
--   * chat_agent_runs: one row per run an agent started or was asked to
--     start (§H): queued, running, needs_you, done, failed, stopped,
--     skipped (coalesced, cooldown, daily limit or nothing to do) or
--     paused_cap; its trigger and what fired it (trigger_ref, evidence_json
--     as scope), the person it acts as (the clicking person for Run now and
--     Run agent, the owner for a trigger), its brand (one run per brand),
--     the action a Run agent click scoped it to, its outcome from the impact
--     ledger, and its cap and use as shares (CHAT-27 items 21–26): never
--     dollars. Its chat is the conversation with its agent_run_id (below).
--     One run at a time per agent and brand: a running or waiting one holds
--     the place (§M item 58, the unique index); the rest wait queued.
--     chat_start_next_agent_run() starts the next queued one when the
--     workspace has room (§M item 59: Run now and Run agent first, then in
--     fire order). The agent's runs stay when it is deleted (§B item 7).
--   * chat_conversations.agent_run_id and origin 'agent': every agent run is
--     a Chat run in a conversation of its own (§H item 36). It is readable
--     by whoever reads its agent run (the policy below): the agent's runs
--     are seen with the agent (§K item 51), not only by the person it acted
--     as.
--   * chat_activity_log.agent_id and agent_run_id: the changes an agent's
--     run made, for the Activity log's agent filter (CHAT-27 item 29).
--   * chat_settings: the per-run cap new agents start with (CHAT-27 item 19,
--     Settings › Chat › Agents), whether agents may use Full auto, and
--     whether only Admins may make workspace agents (CHAT-21 §K).
--
-- CHAT-27's data (section C items 11–12, section E items 21, 30–31):
--
--   * chat_runs.parent_run_id and subtask_title: a subtask is a child run of
--     the run that called run_subtasks, in the same chat, with no message of
--     its own (its events go to the parent's stream). One level only, at
--     most 10 a run (5 a call, 2 calls): the trigger below backs the
--     registry's check. A parent's Stop or deletion takes its subtasks.
--   * prompt_improve_usage.agent_id, agent_run_id and parent_run_id: the
--     agent, the agent run and the parent run a spend row was for, so one
--     grouped read gives each agent's share and a parent's total includes
--     its subtasks.
--   * reserve_chat_ai_usage (00405's), taking the agent run: it names the
--     row with the run's agent and parent, and with p_run_cap (dollars: the
--     run's share times the budget, worked out on the server) holds the
--     step only while the agent run's spend, own-key steps included
--     (CHAT-27 item 33), plus the step's worst case stays within it, under
--     the same lock, so subtasks at once can't pass it.
--   * chat_agent_usage_shares(): each agent's share of the AI limit in a
--     period, its own-key share and its runs, for the Agents list, Billing's
--     By agent and the meter (items 24–28). Server only: the budget is an
--     argument, and a member who could pass one could turn shares back into
--     dollars, so the API serves the shares (item 30: no cost leaves the
--     server).

-- ─── Agents ─────────────────────────────────────────────────────────────────

create table if not exists public.chat_agents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  status text not null default 'draft'
    check (status in ('draft', 'active', 'paused', 'archived')),
  -- Why it is paused (CHAT-21 §G item 34); manual: a person paused it. Only
  -- cap resumes on its own, after the monthly reset or a credit pack.
  paused_reason text check (
    paused_reason in (
      'cap', 'connection', 'skill_off', 'failures', 'owner_role', 'plan', 'brand_gone', 'manual'
    )
  ),
  -- The Admin or Manager who activated it (a draft's: who made it). Null once
  -- their account is deleted: the agent pauses (owner_role) until an Admin
  -- takes it over.
  owner_id uuid references auth.users(id) on delete set null,
  visibility text not null default 'private' check (visibility in ('private', 'workspace')),
  -- The version new runs start with (chat_agent_versions).
  version integer not null default 1 check (version >= 1),
  -- Failed runs in a row: 3 pause it (failures).
  fail_count smallint not null default 0 check (fail_count >= 0),
  -- Shares of the monthly AI limit (CHAT-27 items 19, 23): per run, and a
  -- month (null: no monthly cap).
  max_run_share numeric(3, 2) not null default 0.10 check (max_run_share between 0.01 and 0.50),
  max_month_share numeric(3, 2) check (max_month_share between 0.01 and 1),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  activated_at timestamptz,
  archived_at timestamptz,
  check ((status = 'paused') = (paused_reason is not null))
);

-- One name per workspace, whatever its case (CHAT-21 §O).
create unique index if not exists chat_agents_name_uidx
  on public.chat_agents (organization_id, lower(name));
-- Agents: the workspace's, by status (Mine, Workspace, Paused, Archived).
create index if not exists chat_agents_organization_status_idx
  on public.chat_agents (organization_id, status);
create index if not exists chat_agents_owner_idx
  on public.chat_agents (owner_id) where owner_id is not null;

drop trigger if exists trg_chat_agents_updated_at on public.chat_agents;
create trigger trg_chat_agents_updated_at
  before update on public.chat_agents
  for each row execute function public.handle_updated_at();

comment on table public.chat_agents is
  'Chat (00419): an agent, one saved object that starts Chat runs (CHAT-21): name, status, pause reason, owner, visibility, current version, failed runs in a row, and its AI caps as shares of the monthly limit (CHAT-27). Private agents: owner and Admins; workspace agents: every member. The server writes.';
comment on column public.chat_agents.max_run_share is
  'The most one run may spend, as a share of the monthly AI limit (CHAT-27 item 19): 0.10 by default, 0.01–0.50.';
comment on column public.chat_agents.max_month_share is
  'The most the agent may spend a month, as a share of the monthly AI limit (CHAT-27 item 23); null: no monthly cap.';

-- ─── Versions ───────────────────────────────────────────────────────────────

create table if not exists public.chat_agent_versions (
  agent_id uuid not null references public.chat_agents(id) on delete cascade,
  version integer not null check (version >= 1),
  -- The primary skill, then up to 2 follow-on skills, in order (CHAT-13 ids).
  skill_ids text[] not null check (
    cardinality(skill_ids) between 1 and 3
    and public.chat_text_array_distinct(skill_ids)
    and public.chat_text_array_words(skill_ids)
      ~ '^[a-z0-9][a-z0-9-]{0,63}( [a-z0-9][a-z0-9-]{0,63}){0,2}$'
  ),
  -- Read like a skill's body, below the system rules: it grants nothing.
  instructions text check (char_length(instructions) between 1 and 2000),
  -- The composer's modes (CHAT-02): Ask me first, Auto, Full auto (Growth+).
  mode text not null default 'auto' check (mode in ('ask_first', 'auto', 'full_auto')),
  -- [{key, required}]: the workspace's connections it may use.
  connections jsonb not null default '[]'::jsonb check (
    jsonb_typeof(connections) = 'array' and jsonb_array_length(connections) <= 30
  ),
  -- 'auto' or a model from the catalog (CHAT-16); never a key.
  model text not null default 'auto' check (char_length(model) between 1 and 200),
  effort text not null default 'normal' check (effort in ('normal', 'high', 'max')),
  -- {brand_ids: [...] or all_brands: true, topic_ids, tags, engines, urls}.
  scope jsonb not null default '{}'::jsonb check (
    jsonb_typeof(scope) = 'object' and octet_length(scope::text) <= 32000
  ),
  -- Who is told when it needs someone, besides its owner.
  notify_user_ids uuid[] not null default '{}' check (cardinality(notify_user_ids) <= 20),
  -- The follow-up check after a ship, in days (CHAT-21 §I item 45).
  followup_days smallint not null default 14 check (followup_days between 1 and 90),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (agent_id, version)
);

comment on table public.chat_agent_versions is
  'Chat (00419): what an agent does, one row per save, never changed (CHAT-21 §C item 14): skills in order, instructions, mode, connections, model and effort, scope, who is notified, follow-up day. A run keeps the version it started with. Readable where the agent is; the server writes.';

-- ─── Triggers ───────────────────────────────────────────────────────────────

create table if not exists public.chat_agent_triggers (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.chat_agents(id) on delete cascade,
  -- Run now and Run agent on an action are always on and have no row.
  kind text not null check (kind in ('schedule', 'signal', 'kpi', 'watch_rule')),
  -- schedule: {schedule_id}; signal: {category, definition_ids, entity_filter};
  -- kpi: {kpi, direction, threshold, unit, period}; watch_rule: {watch_rule_id}.
  config_json jsonb not null default '{}'::jsonb check (
    jsonb_typeof(config_json) = 'object' and octet_length(config_json::text) <= 8000
  ),
  enabled boolean not null default true,
  last_fired_at timestamptz,
  -- Fires before it are kept for the next run (CHAT-21 §E item 24).
  cooldown_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists chat_agent_triggers_agent_idx
  on public.chat_agent_triggers (agent_id);
-- What the evaluator reads after each data batch: the enabled triggers of a kind.
create index if not exists chat_agent_triggers_kind_idx
  on public.chat_agent_triggers (kind) where enabled;

drop trigger if exists trg_chat_agent_triggers_updated_at on public.chat_agent_triggers;
create trigger trg_chat_agent_triggers_updated_at
  before update on public.chat_agent_triggers
  for each row execute function public.handle_updated_at();

comment on table public.chat_agent_triggers is
  'Chat (00419): what starts an agent (CHAT-21 §E): a schedule, a Signal, a KPI change or a watch rule, 1–5 an agent, with each kind''s settings, the last fire and the cooldown. Readable where the agent is; the server writes.';

-- At most 5 triggers an agent (CHAT-21 §D): the database's backstop to the
-- server's check.
create or replace function public.chat_agent_triggers_per_agent()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (
    select count(*) from public.chat_agent_triggers t
    where t.agent_id = new.agent_id and t.id <> new.id
  ) >= 5 then
    raise exception 'an agent has at most 5 triggers' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_chat_agent_triggers_per_agent on public.chat_agent_triggers;
create trigger trg_chat_agent_triggers_per_agent
  before insert or update of agent_id on public.chat_agent_triggers
  for each row execute function public.chat_agent_triggers_per_agent();

-- ─── Runs ───────────────────────────────────────────────────────────────────

create table if not exists public.chat_agent_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- Null once the agent is deleted: its runs stay (CHAT-21 §B item 7).
  agent_id uuid references public.chat_agents(id) on delete set null,
  -- The version it runs with (chat_agent_versions), kept when edits make a new one.
  agent_version integer not null check (agent_version >= 1),
  -- One run per brand (§H item 41). Null once the brand is deleted.
  brand_id uuid references public.brands(id) on delete set null,
  trigger_kind text not null
    check (trigger_kind in ('schedule', 'signal', 'kpi', 'watch_rule', 'manual', 'action')),
  -- The trigger that fired; null for Run now and Run agent.
  trigger_id uuid references public.chat_agent_triggers(id) on delete set null,
  -- What fired it: a signal, a schedule run, an action or a watch rule fire.
  trigger_ref text check (char_length(trigger_ref) between 1 and 200),
  -- The person it acts as (§H item 38).
  acting_user_id uuid references auth.users(id) on delete set null,
  status text not null default 'queued' check (
    status in (
      'queued', 'running', 'needs_you', 'done', 'failed', 'stopped', 'skipped', 'paused_cap'
    )
  ),
  skipped_reason text
    check (skipped_reason in ('coalesced', 'cooldown', 'daily_limit', 'nothing_to_do')),
  -- user: a person stopped it; no_answer: 7 days on a card (§H item 40);
  -- run_cap: Stopped at its limit (CHAT-27 item 22); action_closed and
  -- brand_gone: CHAT-21 edge cases 7 and 9.
  stop_reason text
    check (stop_reason in ('user', 'no_answer', 'run_cap', 'action_closed', 'brand_gone')),
  -- The trigger's evidence, passed to the run as scope (§E item 23), and
  -- the fires coalesced into it.
  evidence_json jsonb not null default '{}'::jsonb check (
    jsonb_typeof(evidence_json) = 'object' and octet_length(evidence_json::text) <= 64000
  ),
  -- The action a Run agent click scoped it to (§F item 28).
  action_id uuid references public.actions(id) on delete set null,
  -- Shares of the monthly AI limit, never dollars (CHAT-27 items 21–26):
  -- the run's cap (the agent's max_run_share when it started, plus each
  -- "Continue with +5%"), and what it has used, its subtasks' included.
  max_share numeric(3, 2) not null default 0.10 check (max_share between 0.01 and 1),
  usage_share numeric(7, 4) not null default 0 check (usage_share >= 0),
  -- From the impact ledger (00421) once what it shipped is measured (§I).
  outcome text check (
    outcome in ('pending', 'improved', 'no_meaningful_change', 'declined', 'not_measurable')
  ),
  outcome_confidence text check (outcome_confidence in ('low', 'medium', 'high')),
  queued_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  check ((status = 'skipped') = (skipped_reason is not null)),
  check (stop_reason is null or status = 'stopped'),
  check (outcome_confidence is null or outcome is not null)
);

-- An agent's Runs tab, newest first, and its runs today (§E item 24).
create index if not exists chat_agent_runs_agent_queued_idx
  on public.chat_agent_runs (agent_id, queued_at desc);
-- The workspace's queue, in fire order (§M item 59).
create index if not exists chat_agent_runs_queue_idx
  on public.chat_agent_runs (organization_id, queued_at)
  where status = 'queued';
-- The workspace's runs working now, for its concurrency limit (§M item 57).
create index if not exists chat_agent_runs_running_idx
  on public.chat_agent_runs (organization_id)
  where status = 'running';
-- One run at a time per agent and brand (§M item 58). A run paused at its
-- AI cap keeps its place: an Admin may continue it (CHAT-27 item 22).
create unique index if not exists chat_agent_runs_active_uidx
  on public.chat_agent_runs (agent_id, brand_id)
  where status in ('running', 'needs_you', 'paused_cap');
create index if not exists chat_agent_runs_brand_idx
  on public.chat_agent_runs (brand_id) where brand_id is not null;
create index if not exists chat_agent_runs_trigger_idx
  on public.chat_agent_runs (trigger_id) where trigger_id is not null;
create index if not exists chat_agent_runs_acting_user_idx
  on public.chat_agent_runs (acting_user_id) where acting_user_id is not null;
create index if not exists chat_agent_runs_action_idx
  on public.chat_agent_runs (action_id) where action_id is not null;

comment on table public.chat_agent_runs is
  'Chat (00419): one row per run an agent started or was asked to start (CHAT-21 §H): status, skip and stop reasons, trigger and evidence, the person it acts as, brand, the action it was scoped to, outcome, and its cap and use as shares of the monthly AI limit (CHAT-27). Its chat is the conversation with this agent_run_id. Readable with its agent; the server writes.';
comment on column public.chat_agent_runs.usage_share is
  'What the run, its subtasks included, has used, as a share of the monthly AI limit (CHAT-27 item 25). Kept by the server; never dollars.';

-- Starts the workspace's next queued agent run, when fewer than
-- p_workspace_limit of its agent runs are running (the plan's, CHAT-21 §M):
-- Run now and Run agent first, then in fire order; never one whose agent and
-- brand already have a run running or waiting on a person. One start at a
-- time per workspace: the next waits and counts this one. Returns the run
-- started, or null. A run whose agent was deleted or archived, or whose
-- brand was deleted, never starts; a triggered run starts only while its
-- agent is active (Run now and Run agent also on a paused or draft one,
-- CHAT-21 §G). A running run whose Chat run was lost is ended by the
-- server's sweep, which frees its place. A run that goes back to running
-- from needs_you or paused_cap doesn't pass through here: the server checks
-- the workspace's limit for it.
create or replace function public.chat_start_next_agent_run(
  p_organization_id uuid,
  p_workspace_limit integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_running integer;
  v_id uuid;
begin
  if p_workspace_limit is null or p_workspace_limit < 1 then
    raise exception 'a workspace limit is needed' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('chat_agent_run_slot:' || p_organization_id::text));

  select count(*) into v_running
  from public.chat_agent_runs
  where organization_id = p_organization_id
    and status = 'running';
  if v_running >= p_workspace_limit then
    return null;
  end if;

  select q.id into v_id
  from public.chat_agent_runs q
  join public.chat_agents g on g.id = q.agent_id
  where q.organization_id = p_organization_id
    and q.status = 'queued'
    and q.brand_id is not null
    and g.status <> 'archived'
    and (g.status = 'active' or q.trigger_kind in ('manual', 'action'))
    and not exists (
      select 1 from public.chat_agent_runs a
      where a.agent_id = q.agent_id
        and a.brand_id = q.brand_id
        and a.status in ('running', 'needs_you', 'paused_cap')
    )
  order by (q.trigger_kind in ('manual', 'action')) desc, q.queued_at, q.id
  limit 1;
  if v_id is null then
    return null;
  end if;

  update public.chat_agent_runs
  set status = 'running', started_at = coalesce(started_at, now())
  where id = v_id;
  return v_id;
end;
$$;

revoke all on function public.chat_start_next_agent_run(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.chat_start_next_agent_run(uuid, integer) to service_role;

-- ─── An agent run's chat ────────────────────────────────────────────────────

alter table public.chat_conversations
  add column if not exists agent_run_id uuid
    references public.chat_agent_runs(id) on delete set null;

-- A chat an agent's run started (CHAT-21 §H item 36).
alter table public.chat_conversations
  drop constraint if exists chat_conversations_origin_check;
alter table public.chat_conversations
  add constraint chat_conversations_origin_check
    check (origin in ('page', 'panel', 'agent'));

-- One chat per agent run.
create unique index if not exists chat_conversations_agent_run_uidx
  on public.chat_conversations (agent_run_id) where agent_run_id is not null;

comment on column public.chat_conversations.agent_run_id is
  'The agent run this chat is (CHAT-21 §H item 36; origin agent). Readable by whoever reads the agent run. Null for a person''s own chat, and once the run is gone.';

-- ─── An agent's changes in the Activity log ─────────────────────────────────

alter table public.chat_activity_log
  add column if not exists agent_id uuid references public.chat_agents(id) on delete set null,
  add column if not exists agent_run_id uuid
    references public.chat_agent_runs(id) on delete set null;

-- The Activity log's "Agent: {name}" filter (CHAT-27 item 29).
create index if not exists chat_activity_log_agent_created_idx
  on public.chat_activity_log (agent_id, created_at desc) where agent_id is not null;
create index if not exists chat_activity_log_agent_run_idx
  on public.chat_activity_log (agent_run_id) where agent_run_id is not null;

comment on column public.chat_activity_log.agent_id is
  'The agent whose run made the change (CHAT-21, CHAT-27 item 29); null for a person''s own chat, and once the agent is deleted.';

-- ─── Agents in Settings › Chat ──────────────────────────────────────────────

alter table public.chat_settings
  add column if not exists agent_run_share_default numeric(3, 2) not null default 0.10
    check (agent_run_share_default between 0.01 and 0.50),
  add column if not exists agents_full_auto boolean not null default true,
  add column if not exists workspace_agents_admins_only boolean not null default false;

comment on column public.chat_settings.agent_run_share_default is
  'The per-run cap a new agent starts with, as a share of the monthly AI limit (CHAT-27 item 19): 0.10 by default, 0.01–0.50.';
comment on column public.chat_settings.agents_full_auto is
  'Agents may run in Full auto (CHAT-21 §K). Off: Full auto agents pause (plan) and new ones can''t pick it. The plan decides first: Full auto is Growth+.';
comment on column public.chat_settings.workspace_agents_admins_only is
  'Only Admins may make an agent visible to the workspace (CHAT-21 §D item 20).';

-- ─── Subtasks (CHAT-27 §C) ──────────────────────────────────────────────────

alter table public.chat_runs
  add column if not exists parent_run_id uuid references public.chat_runs(id) on delete cascade,
  add column if not exists subtask_title text check (char_length(subtask_title) between 1 and 120);

-- A subtask has no message of its own: its answer is its parent's.
alter table public.chat_runs
  alter column message_id drop not null;

alter table public.chat_runs
  drop constraint if exists chat_runs_subtask_check;
alter table public.chat_runs
  add constraint chat_runs_subtask_check
    check (
      (parent_run_id is null) = (message_id is not null)
      and (parent_run_id is null) = (subtask_title is null)
    );

create index if not exists chat_runs_parent_idx
  on public.chat_runs (parent_run_id) where parent_run_id is not null;

comment on column public.chat_runs.parent_run_id is
  'The run whose run_subtasks call started this one (CHAT-27 §C): in the same chat, one level only, at most 10 a run. Null for a run that answers a message.';
comment on column public.chat_runs.subtask_title is
  'A subtask''s short title ("Competitor C"), shown in its parent''s steps and Activity log rows.';

-- A subtask's parent is a run of the same chat that is no subtask itself,
-- and a run has at most 10 subtasks: the database's backstop to the
-- registry's check (CHAT-27 item 3).
create or replace function public.chat_runs_subtask_rules()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.parent_run_id is null then
    return new;
  end if;

  if not exists (
    select 1 from public.chat_runs p
    where p.id = new.parent_run_id
      and p.parent_run_id is null
      and p.conversation_id = new.conversation_id
  ) then
    raise exception 'a subtask''s parent is a run of the same chat that is no subtask'
      using errcode = '23514';
  end if;

  if (
    select count(*) from public.chat_runs c
    where c.parent_run_id = new.parent_run_id and c.id <> new.id
  ) >= 10 then
    raise exception 'a run has at most 10 subtasks' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_chat_runs_subtask_rules on public.chat_runs;
create trigger trg_chat_runs_subtask_rules
  before insert or update of parent_run_id, conversation_id on public.chat_runs
  for each row execute function public.chat_runs_subtask_rules();

-- ─── Who spent it (CHAT-27 item 30) ─────────────────────────────────────────

alter table public.prompt_improve_usage
  add column if not exists agent_id uuid references public.chat_agents(id) on delete set null,
  add column if not exists agent_run_id uuid
    references public.chat_agent_runs(id) on delete set null,
  add column if not exists parent_run_id uuid references public.chat_runs(id) on delete set null;

comment on column public.prompt_improve_usage.agent_id is
  'The agent whose run this row was for (00419); null for other features and plain chats, and once the agent is deleted (its agent_run_id stays).';
comment on column public.prompt_improve_usage.agent_run_id is
  'The agent run this row was for (00419): its run cap and its share are summed by it.';
comment on column public.prompt_improve_usage.parent_run_id is
  'The parent run when this row was a subtask''s (CHAT-27 §C), so a parent''s total includes its subtasks.';

create index if not exists prompt_improve_usage_agent_idx
  on public.prompt_improve_usage (agent_id) where agent_id is not null;
create index if not exists prompt_improve_usage_agent_run_idx
  on public.prompt_improve_usage (agent_run_id) where agent_run_id is not null;
create index if not exists prompt_improve_usage_parent_run_idx
  on public.prompt_improve_usage (parent_run_id) where parent_run_id is not null;

-- 00405's hold, taking the agent run and its cap. The two new arguments
-- have defaults, so a call with the old ones still matches; the old
-- signature goes first, or the two would both match it.
drop function if exists public.reserve_chat_ai_usage(
  uuid, uuid, uuid, text, text, numeric, boolean, timestamptz, numeric
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
-- The row is named by the run's parent and the agent run's agent.
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
  p_run_cap          numeric default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parent_id uuid;
  v_agent_run uuid;
  v_agent_id  uuid;
  v_spent     numeric;
  v_run_spent numeric;
  v_id        uuid;
begin
  if p_feature is null or p_feature not in ('chat', 'agent', 'schedule', 'image') then
    raise exception 'not a Chat feature: %', p_feature using errcode = '22023';
  end if;
  select r.parent_run_id, c.agent_run_id into v_parent_id, v_agent_run
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
    agent_id, agent_run_id, parent_run_id)
  values (
    p_organization_id, p_feature, p_model, greatest(p_cost, 0), coalesce(p_own_key, false),
    p_chat_run_id, p_chat_run_step_id, v_agent_id, v_agent_run, v_parent_id)
  returning id into v_id;
  return v_id;
end;
$$;

comment on function public.reserve_chat_ai_usage(uuid, uuid, uuid, text, text, numeric, boolean, timestamptz, numeric, uuid, numeric) is
  'Holds a Chat step''s worst-case cost (p_cost) under the per-organization lock, only while the period''s spend since p_since (own-key rows left out, holds in flight in) plus p_cost stays within p_budget and, given p_run_cap, the agent run''s spend (own-key rows in) plus p_cost stays within it; returns the row to settle, or null. Own-key steps and an unlimited budget (null) skip the budget check. The row is named by its run''s parent and its agent run''s agent (00419).';

revoke all on function public.reserve_chat_ai_usage(uuid, uuid, uuid, text, text, numeric, boolean, timestamptz, numeric, uuid, numeric)
  from public, anon, authenticated;
grant execute on function public.reserve_chat_ai_usage(uuid, uuid, uuid, text, text, numeric, boolean, timestamptz, numeric, uuid, numeric)
  to service_role;

-- Each agent's share of the AI limit since p_since: what its runs spent on
-- the budget over p_budget, what they spent on the workspace's own key over
-- the same, and how many runs spent anything. Rounded to 0.01%. A deleted
-- agent's runs come back together, with a null agent_id. No rows without a
-- budget (p_budget null or 0: self-hosted has no limit to share).
create or replace function public.chat_agent_usage_shares(
  p_organization_id uuid,
  p_since timestamptz,
  p_budget numeric
)
returns table (agent_id uuid, share numeric, own_key_share numeric, runs integer)
language sql
stable
security definer
set search_path = ''
as $$
  select
    u.agent_id,
    round(coalesce(sum(u.cost_usd) filter (where not u.own_key), 0) / p_budget, 4),
    round(coalesce(sum(u.cost_usd) filter (where u.own_key), 0) / p_budget, 4),
    count(distinct u.agent_run_id)::integer
  from public.prompt_improve_usage u
  where u.organization_id = p_organization_id
    and u.used_at >= p_since
    and u.agent_run_id is not null
    and p_budget > 0
  group by u.agent_id;
$$;

comment on function public.chat_agent_usage_shares(uuid, timestamptz, numeric) is
  'Each agent''s share of the monthly AI limit since p_since (CHAT-27 item 30): budget share, own-key share and runs, rounded to 0.01%. Server only: the budget is its argument, so no member may call it; the API serves the shares, never the costs.';

revoke all on function public.chat_agent_usage_shares(uuid, timestamptz, numeric)
  from public, anon, authenticated;
grant execute on function public.chat_agent_usage_shares(uuid, timestamptz, numeric)
  to service_role;

-- ─── Who reads and writes ───────────────────────────────────────────────────

alter table public.chat_agents enable row level security;
alter table public.chat_agent_versions enable row level security;
alter table public.chat_agent_triggers enable row level security;
alter table public.chat_agent_runs enable row level security;

revoke all on table public.chat_agents from anon, authenticated;
revoke all on table public.chat_agent_versions from anon, authenticated;
revoke all on table public.chat_agent_triggers from anon, authenticated;
revoke all on table public.chat_agent_runs from anon, authenticated;

grant select on table public.chat_agents to authenticated;
grant select on table public.chat_agent_versions to authenticated;
grant select on table public.chat_agent_triggers to authenticated;
grant select on table public.chat_agent_runs to authenticated;
-- 00402 grants members its columns one by one: the new two join them.
grant select (agent_id, agent_run_id) on table public.chat_activity_log to authenticated;

grant all on table public.chat_agents to service_role;
grant all on table public.chat_agent_versions to service_role;
grant all on table public.chat_agent_triggers to service_role;
grant all on table public.chat_agent_runs to service_role;

-- A workspace agent: every member of its workspace, while they belong to
-- it. A private one: its owner and the workspace's Admins (CHAT-21
-- Definition). Brands are the workspace's membership today: when Agency
-- partners get brands one by one, this narrows with them.
drop policy if exists "chat_agents: member select" on public.chat_agents;
create policy "chat_agents: member select"
  on public.chat_agents
  for select
  using (
    organization_id in (
      select p.organization_id
      from public.profiles p
      where p.id = auth.uid()
        and (
          p.role = 'admin'
          or chat_agents.visibility = 'workspace'
          or chat_agents.owner_id = auth.uid()
        )
    )
  );

-- Versions and triggers follow their agent.
drop policy if exists "chat_agent_versions: agent select" on public.chat_agent_versions;
create policy "chat_agent_versions: agent select"
  on public.chat_agent_versions
  for select
  using (agent_id in (select a.id from public.chat_agents a));

drop policy if exists "chat_agent_triggers: agent select" on public.chat_agent_triggers;
create policy "chat_agent_triggers: agent select"
  on public.chat_agent_triggers
  for select
  using (agent_id in (select a.id from public.chat_agents a));

-- A run follows its agent; the person it acted as and the workspace's
-- Admins also read it once the agent is deleted. Members of the workspace
-- only, while they belong to it.
drop policy if exists "chat_agent_runs: agent select" on public.chat_agent_runs;
create policy "chat_agent_runs: agent select"
  on public.chat_agent_runs
  for select
  using (
    agent_id in (select a.id from public.chat_agents a)
    or organization_id in (
      select p.organization_id
      from public.profiles p
      where p.id = auth.uid()
        and (p.role = 'admin' or chat_agent_runs.acting_user_id = auth.uid())
    )
  );

-- An agent run's chat: whoever reads the run (CHAT-21 §K item 51), while
-- they belong to its workspace; never once deleted. Its messages, runs and
-- steps follow (00400).
drop policy if exists "chat_conversations: agent run select" on public.chat_conversations;
create policy "chat_conversations: agent run select"
  on public.chat_conversations
  for select
  using (
    agent_run_id in (select r.id from public.chat_agent_runs r)
    and deleted_at is null
    and organization_id in (
      select p.organization_id from public.profiles p where p.id = auth.uid()
    )
  );

notify pgrst, 'reload schema';
