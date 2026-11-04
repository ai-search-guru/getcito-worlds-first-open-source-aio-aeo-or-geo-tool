-- ============================================================================
-- 00402: Chat's activity log with Undo, and its idempotency keys
-- ============================================================================
-- Every change Chat makes is visible and, where possible, undoable (CHAT-20
-- §2 principle 6, §10), and a double click never makes it twice (§11c).
-- Behind CHAT_AGENTIC: nothing writes these tables while the flag is off.
--
--   * chat_activity_log: one row per WRITE or EXECUTE Chat ran (§10a layer 2,
--     mockup #g-activity): who, from which surface, in which chat, run and
--     step; the tool by its label key (never its name, CHAT-03 item 22), its
--     class, the run's mode and how it was approved; the target (type and
--     id), and the summary in the person's words (a messages/en.json key
--     under chatActivity.summary, with its values). kind says which row:
--       - change: a WRITE or EXECUTE that ran;
--       - undo: an Undo (approval 'run', undoes_id pointing at the change it
--         undid, which turns 'undone');
--       - access.denied: a call the precedence refused (§4c, §10a "Denied
--         requests appear as access.denied rows"), with its reason
--         (denial_code, denial_json: what the denial.ts answer is built
--         from) and no approval, target or Undo. A read's denial too.
--     A person reads their own rows; an Admin reads the workspace's (§10a
--     "Members see their own rows; Admins see all"). Only the server writes.
--     Rows stay when the chat, the run or the member goes (§16c: Activity
--     log rows stay).
--       - undo_json: what Undo restores and what it checks first (the before
--         state, and the after state a conflict is measured against). Server
--         only: members are granted every column but this one.
--       - undo_until: the end of the tool's Undo window (CHAT-20 §9: 7 or 30
--         days), null when there is no Undo (an EXECUTE, §10b).
--       - status: done; undone; undo_conflict when an Undo found the target
--         changed since ("This changed since. Open it to undo by hand.").
--         An Undo may be tried again from undo_conflict.
--   * chat_idempotency_keys: a WRITE's or EXECUTE's key (§9's column) for 24
--     hours per workspace, with the first call's result: a double-clicked
--     approval, a reconnect or a retry gets that result back and makes
--     nothing new. A key is claimed (pending) before the change runs and
--     holds its result once it ran; a call that failed gives its key back.
--     request_hash is what the key was claimed for (the tool and its input):
--     the same key with another request is an approval mismatch. Server
--     only: no member reads or writes it.

-- ─── The activity log ───────────────────────────────────────────────────────

create table if not exists public.chat_activity_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- The person Chat acted as (§2 principle 1). Null once their account is
  -- deleted: the row stays, for the workspace's Admins.
  user_id uuid references auth.users(id) on delete set null,
  brand_id uuid references public.brands(id) on delete set null,
  -- Where it ran. A deleted chat, run or step leaves its rows.
  conversation_id uuid references public.chat_conversations(id) on delete set null,
  run_id uuid references public.chat_runs(id) on delete set null,
  step_id uuid references public.chat_run_steps(id) on delete set null,
  -- §10a's sources: Chat, an agent (CHAT-21), MCP, a schedule (CHAT-12), a watch rule (CHAT-22).
  surface text not null check (surface in ('chat', 'agent', 'mcp', 'schedule', 'watch_rule')),
  -- change, undo or access.denied (above).
  kind text not null default 'change' check (kind in ('change', 'undo', 'access.denied')),
  -- The tool's label key (chat_settings.tool_policies' keys), never its name.
  tool_key text not null check (tool_key ~ '^[a-z][A-Za-z0-9]{1,63}$'),
  -- A read only in an access.denied row.
  class text not null check (class in ('read', 'write', 'execute')),
  -- The run's mode (CHAT-02); null for the person's own action (an Undo) and a denial.
  mode text check (mode in ('ask_first', 'auto', 'full_auto')),
  -- ask: approved on its card; click: an EXECUTE the person clicked; auto:
  -- ran without a card (auto_via says why); run: the person's own action,
  -- which needs no card (Undo, §10b). Null for a denial: nothing ran.
  approval_kind text check (approval_kind in ('run', 'ask', 'click', 'auto')),
  auto_via text check (auto_via in ('always', 'full_auto', 'dont_ask_again')),
  -- What it changed: 'content_draft', 'content_opportunity', 'prompt_suggestion'…
  -- Null for a denial.
  target_type text check (target_type ~ '^[a-z][a-z_]{1,39}$'),
  target_id text check (char_length(target_id) between 1 and 200),
  -- A denial's reason, the precedence's code (no_access, brand_scope,
  -- forbidden_role, plan_locked…), and the rest of it ({role, roles},
  -- {needs}, {group}): what the out-of-permission answer is built from.
  denial_code text check (denial_code ~ '^[a-z_]{1,40}$'),
  denial_json jsonb check (denial_json is null or jsonb_typeof(denial_json) = 'object'),
  -- chatActivity.summary.{summary_key} in messages/en.json, and its values.
  summary_key text not null check (summary_key ~ '^[a-z][A-Za-z0-9]{1,63}$'),
  summary_params jsonb not null default '{}'::jsonb check (jsonb_typeof(summary_params) = 'object'),
  -- Server only (not granted to members): what Undo restores and checks.
  undo_json jsonb check (undo_json is null or jsonb_typeof(undo_json) = 'object'),
  undo_until timestamptz,
  -- This row is the Undo of that one.
  undoes_id uuid references public.chat_activity_log(id) on delete set null,
  status text not null default 'done' check (status in ('done', 'undone', 'undo_conflict')),
  undone_at timestamptz,
  undone_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  -- What each kind holds: a change and an Undo were approved and have a
  -- target; a denial has a reason, and neither.
  check ((kind = 'access.denied') = (approval_kind is null)),
  check ((kind = 'access.denied') = (denial_code is not null)),
  check (kind = 'access.denied' or (target_type is not null and class <> 'read')),
  -- Only an Undo points at the change it undid.
  check (kind = 'undo' or undoes_id is null),
  -- auto_via only, and always, on a change that ran without a card.
  check ((auto_via is not null) = (approval_kind is not distinct from 'auto')),
  -- Undo only on a WRITE that ran (§10b: an EXECUTE has none); with what it restores.
  check (undo_until is null or (kind = 'change' and class = 'write')),
  check (undo_until is null or undo_json is not null),
  check ((status = 'undone') = (undone_at is not null)),
  check (status = 'done' or kind = 'change')
);

-- Admins: the workspace's log, newest first. Members: their own.
create index if not exists chat_activity_log_organization_created_idx
  on public.chat_activity_log (organization_id, created_at desc);
create index if not exists chat_activity_log_user_created_idx
  on public.chat_activity_log (user_id, created_at desc);
create index if not exists chat_activity_log_undoes_idx
  on public.chat_activity_log (undoes_id) where undoes_id is not null;

comment on table public.chat_activity_log is
  'Chat (00402): one row per WRITE or EXECUTE Chat ran, per Undo and per access.denied (CHAT-20 §10a): actor, surface, tool label key, class, mode, approval, target, summary (en.json key + values), Undo window and status, or a denial''s reason. A person reads their own rows, an Admin the workspace''s; the server writes.';
comment on column public.chat_activity_log.undo_json is
  'What Undo restores and the state it checks first (CHAT-20 §10b). Server only: never granted to members.';
comment on column public.chat_activity_log.summary_key is
  'The key under chatActivity.summary in web messages/en.json; summary_params holds its values.';

-- ─── Idempotency keys ───────────────────────────────────────────────────────

create table if not exists public.chat_idempotency_keys (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  key text not null check (key ~ '^[a-z][A-Za-z0-9]{1,63}:[0-9a-f]{64}$'),
  -- The tool and input the key was claimed for (sha-256, hex).
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  -- pending: the change is running; done: result_json is its result.
  status text not null default 'pending' check (status in ('pending', 'done')),
  result_json jsonb,
  -- The log row the change wrote, for a repeat to point at the same one.
  activity_id uuid references public.chat_activity_log(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  primary key (organization_id, key),
  check (status = 'pending' or result_json is not null)
);

-- The sweep of expired keys.
create index if not exists chat_idempotency_keys_expires_idx
  on public.chat_idempotency_keys (expires_at);

comment on table public.chat_idempotency_keys is
  'Chat (00402): a WRITE''s or EXECUTE''s idempotency key for 24 hours per workspace (CHAT-20 §11c), with the first call''s result. Server only.';

-- ─── Who reads and writes ───────────────────────────────────────────────────

alter table public.chat_activity_log enable row level security;
alter table public.chat_idempotency_keys enable row level security;

revoke all on table public.chat_activity_log from anon, authenticated;
revoke all on table public.chat_idempotency_keys from anon, authenticated;

-- Every column but undo_json.
grant select (
  id, organization_id, user_id, brand_id, conversation_id, run_id, step_id, surface, kind,
  tool_key, class, mode, approval_kind, auto_via, target_type, target_id, denial_code,
  denial_json, summary_key, summary_params, undo_until, undoes_id, status, undone_at,
  undone_by, created_at
) on table public.chat_activity_log to authenticated;

grant all on table public.chat_activity_log to service_role;
grant all on table public.chat_idempotency_keys to service_role;

-- A person's own rows, and every row of the workspace for its Admins, while
-- they belong to it: one who left, or moved to another, reads none.
drop policy if exists "chat_activity_log: own or admin select" on public.chat_activity_log;
create policy "chat_activity_log: own or admin select"
  on public.chat_activity_log
  for select
  using (
    organization_id in (
      select p.organization_id
      from public.profiles p
      where p.id = auth.uid()
        and (p.role = 'admin' or chat_activity_log.user_id = auth.uid())
    )
  );

notify pgrst, 'reload schema';
