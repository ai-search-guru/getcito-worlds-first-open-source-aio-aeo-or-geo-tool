-- ============================================================================
-- 00466: an agent that runs another agent (CHAT-27 phase 2)
-- ============================================================================
-- Chat Wave 4 (CHAT-27 items 14–18, W4-26 and W4-27), behind CHAT_AGENTIC.
-- An agent's run may start one of the agents its Can call list names, with
-- run_agent; the called agent runs as its own agent run, and its summary
-- comes back to the caller as untrusted data. Nothing writes these yet.
--
--   * chat_agent_versions.can_call: the agents this version may run, at most
--     5, never itself, all of its own workspace (a trigger checks). Empty by
--     default; Admins and Managers set it, Growth and up (the server checks
--     roles and plan). A called agent deleted later stays in old versions'
--     lists: the server offers only agents that are still there.
--   * chat_agent_runs.trigger_kind gains agent: a run another agent's run
--     started. called_by_run_id names that run, and only such a run has
--     one. A run that was itself called can't call further (no chains, so no
--     cycle), an agent doesn't call itself, and a run calls at most 3 times
--     (Technical T3): a trigger is the database's backstop to run_agent's
--     own checks, as 00419's is for subtasks.

-- ─── Can call ───────────────────────────────────────────────────────────────

alter table public.chat_agent_versions
  add column if not exists can_call uuid[] not null default '{}';

alter table public.chat_agent_versions
  drop constraint if exists chat_agent_versions_can_call_check;
alter table public.chat_agent_versions
  add constraint chat_agent_versions_can_call_check
    check (
      cardinality(can_call) <= 5
      and array_position(can_call, null) is null
      and public.chat_text_array_distinct(can_call::text[])
      and not (agent_id = any (can_call))
    );

-- Every agent it names is of the same workspace.
create or replace function public.chat_agent_versions_can_call_rules()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if cardinality(new.can_call) = 0 then
    return new;
  end if;

  if exists (
    select 1
    from unnest(new.can_call) as wanted(id)
    where not exists (
      select 1
      from public.chat_agents callee
      join public.chat_agents caller on caller.organization_id = callee.organization_id
      where callee.id = wanted.id
        and caller.id = new.agent_id
    )
  ) then
    raise exception 'an agent calls only agents of its own workspace'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_chat_agent_versions_can_call_rules on public.chat_agent_versions;
create trigger trg_chat_agent_versions_can_call_rules
  before insert or update of can_call, agent_id on public.chat_agent_versions
  for each row execute function public.chat_agent_versions_can_call_rules();

comment on column public.chat_agent_versions.can_call is
  'The agents this version may run with run_agent (00466; CHAT-27 item 14): at most 5, never itself, of its own workspace. Empty by default.';

-- ─── A run another agent started ────────────────────────────────────────────

alter table public.chat_agent_runs
  drop constraint if exists chat_agent_runs_trigger_kind_check;
alter table public.chat_agent_runs
  add constraint chat_agent_runs_trigger_kind_check
    check (
      trigger_kind in ('schedule', 'signal', 'kpi', 'watch_rule', 'manual', 'action', 'agent')
    );

-- The caller's run. As 00419's subtasks, the called run goes with it.
alter table public.chat_agent_runs
  add column if not exists called_by_run_id uuid
    references public.chat_agent_runs(id) on delete cascade;

alter table public.chat_agent_runs
  drop constraint if exists chat_agent_runs_called_by_check;
alter table public.chat_agent_runs
  add constraint chat_agent_runs_called_by_check
    check ((trigger_kind = 'agent') = (called_by_run_id is not null));

-- A run's calls ("Ran {agent}" lines) and the called run's "Called by".
create index if not exists chat_agent_runs_called_by_idx
  on public.chat_agent_runs (called_by_run_id)
  where called_by_run_id is not null;

-- The caller is a run of the same workspace that wasn't called itself, of
-- another agent, with fewer than 3 calls so far. Checked when a run names
-- its caller, not when an agent's deletion clears agent_id later.
create or replace function public.chat_agent_runs_call_rules()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.called_by_run_id is null then
    return new;
  end if;

  if not exists (
    select 1
    from public.chat_agent_runs c
    where c.id = new.called_by_run_id
      and c.organization_id = new.organization_id
      and c.called_by_run_id is null
      and c.agent_id is distinct from new.agent_id
  ) then
    raise exception 'an agent run is called by a run of another agent of the workspace, which wasn''t called itself'
      using errcode = '23514';
  end if;

  -- Calls of one run at once queue here, so a fourth can't slip past the count.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('chat_agent_calls:' || new.called_by_run_id::text)
  );
  if (
    select count(*)
    from public.chat_agent_runs r
    where r.called_by_run_id = new.called_by_run_id
      and r.id <> new.id
  ) >= 3 then
    raise exception 'a run calls other agents at most 3 times' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_chat_agent_runs_call_rules on public.chat_agent_runs;
create trigger trg_chat_agent_runs_call_rules
  before insert or update of called_by_run_id on public.chat_agent_runs
  for each row execute function public.chat_agent_runs_call_rules();

comment on column public.chat_agent_runs.called_by_run_id is
  'The agent run whose run_agent call started this one (00466; trigger_kind agent; CHAT-27 phase 2). One level only, at most 3 a run. Null for every other run.';

notify pgrst, 'reload schema';
