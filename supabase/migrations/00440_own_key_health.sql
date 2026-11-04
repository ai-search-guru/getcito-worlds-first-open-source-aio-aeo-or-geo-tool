-- ============================================================================
-- 00440: an own AI key's health, and the own_key pause and stop reasons
-- ============================================================================
-- AGENT-OWN-KEY §6.1. When the workspace's own key fails (refused, out of
-- credit, a model it can't reach, or a saved key that can't be read), the
-- agents on it stop with that reason and pause, and the Admins are told.
-- The key's row keeps the failure:
--
--   * checked_at: the key's last test (Settings › AI Providers).
--   * failing_since: when this failure episode began; only its first failure
--     sets it, so runs that fail at once mark it once. Null while the key
--     works.
--   * failure_class: invalid, no_credit, model or unreadable (web
--     lib/agent/keyErrors.ts); set exactly while failing_since is.
--   * failure_status: the provider's HTTP status, when it answered.
--   * notified_at: when the Admins were told of this episode.
--
-- A new key string clears all five (the trigger below), so a key replaced in
-- Settings starts out unchecked whatever its route sends.
--
-- chat_agents.paused_reason gains own_key (the key failed), and
-- chat_agent_runs.stop_reason gains own_key (Stopped · AI key not working).
-- Constraint swaps on small tables: no rewrite, existing rows already pass.
--
-- Service role only, as the rest of organization_ai_keys (00188).

alter table public.organization_ai_keys
  add column if not exists checked_at timestamptz,
  add column if not exists failing_since timestamptz,
  add column if not exists failure_class text
    check (failure_class in ('invalid', 'no_credit', 'model', 'unreadable')),
  add column if not exists failure_status smallint,
  add column if not exists notified_at timestamptz;

alter table public.organization_ai_keys
  drop constraint if exists organization_ai_keys_failure_check;

alter table public.organization_ai_keys
  add constraint organization_ai_keys_failure_check
  check ((failing_since is null) = (failure_class is null));

comment on column public.organization_ai_keys.checked_at is
  'When the key was last tested in Settings › AI Providers; null until then.';
comment on column public.organization_ai_keys.failing_since is
  'When this failure episode began (the first failure only); null while the key works.';
comment on column public.organization_ai_keys.failure_class is
  'Why the key fails: invalid, no_credit, model or unreadable; set exactly while failing_since is.';
comment on column public.organization_ai_keys.failure_status is
  'The provider''s HTTP status for the failure, when it answered.';
comment on column public.organization_ai_keys.notified_at is
  'When the Admins were told of this failure episode.';

-- A new key string starts unchecked: its health was the old key's.
create or replace function public.organization_ai_keys_reset_health()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.key_encrypted is distinct from old.key_encrypted then
    new.checked_at := null;
    new.failing_since := null;
    new.failure_class := null;
    new.failure_status := null;
    new.notified_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists organization_ai_keys_reset_health on public.organization_ai_keys;

create trigger organization_ai_keys_reset_health
  before update of key_encrypted on public.organization_ai_keys
  for each row execute function public.organization_ai_keys_reset_health();

alter table public.chat_agents
  drop constraint if exists chat_agents_paused_reason_check;

alter table public.chat_agents
  add constraint chat_agents_paused_reason_check check (
    paused_reason in (
      'cap',
      'connection',
      'skill_off',
      'failures',
      'owner_role',
      'plan',
      'brand_gone',
      'manual',
      'own_key'
    )
  );

alter table public.chat_agent_runs
  drop constraint if exists chat_agent_runs_stop_reason_check;

alter table public.chat_agent_runs
  add constraint chat_agent_runs_stop_reason_check check (
    stop_reason in ('user', 'no_answer', 'run_cap', 'action_closed', 'brand_gone', 'own_key')
  );

notify pgrst, 'reload schema';
