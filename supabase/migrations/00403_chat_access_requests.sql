-- ============================================================================
-- 00403: Chat's access requests — "Ask your Admin"
-- ============================================================================
-- When a person's role, the plan or the tool policy keeps Chat from doing
-- what they asked, Chat's out-of-permission answer offers Ask your Admin
-- (CHAT-20 §4c, registry row 80a `access.request`): only after their click,
-- a request goes to the workspace's Admins, who see it in Settings › Team ›
-- Roles & access › Requests with a count. Behind CHAT_AGENTIC: nothing writes
-- here while the flag is off.
--
--   * asked: what was asked, in the answer's words ("Add competitors ·
--     Peec AI"); asked_hash its fingerprint, so a person asks for the same
--     change at most once a day (requested_on, UTC).
--   * tool_key: the registry row's label key, the name the browser knows a
--     tool by (a tool's name never reaches a member, CHAT-03 item 22); null
--     for a request about the plan or the role as a whole.
--   * rule_kind / rule_detail: the rule that refused it (web
--     lib/chat/denial.ts: role, plan, policy, workspace, brand, demo) and its
--     words.
--   * drafted_change: the change Chat had drafted, for an Admin to approve as
--     their own card once Chat runs (C3); null when there was none.
--   * status: pending until an Admin approves or dismisses it (the first one
--     to act decides it for every Admin), or the person withdraws it.
--
-- The server writes every row (service role), after its own checks: a person
-- has at most 10 pending requests and sends at most 20 a day. The person
-- reads their own; the workspace's Admins read all of its requests.

create table if not exists public.chat_access_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  requester_id uuid not null references auth.users(id) on delete cascade,
  brand_id uuid references public.brands(id) on delete set null,
  conversation_id uuid references public.chat_conversations(id) on delete set null,
  asked text not null check (char_length(asked) between 1 and 500),
  asked_hash text not null check (asked_hash ~ '^[0-9a-f]{64}$'),
  tool_key text check (tool_key is null or tool_key ~ '^[a-z][A-Za-z0-9]{1,63}$'),
  rule_kind text not null
    check (rule_kind in ('role', 'plan', 'policy', 'workspace', 'brand', 'demo')),
  rule_detail text not null default '' check (char_length(rule_detail) <= 500),
  -- The server takes at most 8,000 characters of JSON; this is its backstop.
  drafted_change jsonb
    check (
      drafted_change is null
      or (jsonb_typeof(drafted_change) = 'object' and octet_length(drafted_change::text) <= 32768)
    ),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'withdrawn')),
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  requested_on date not null default ((now() at time zone 'utc')::date),
  created_at timestamptz not null default now(),
  check ((status = 'pending') = (decided_at is null))
);

-- One request per person per asked change per day.
create unique index if not exists chat_access_requests_once_a_day_uidx
  on public.chat_access_requests (requester_id, asked_hash, requested_on);
-- Roles & access › Requests: the workspace's pending ones first, newest first.
create index if not exists chat_access_requests_org_idx
  on public.chat_access_requests (organization_id, status, created_at desc);
-- A person's own requests, and how many are pending.
create index if not exists chat_access_requests_requester_idx
  on public.chat_access_requests (requester_id, status, created_at desc);

comment on table public.chat_access_requests is
  'Chat (00403): "Ask your Admin" requests (CHAT-20 §4c). Server writes; the requester reads their own, the workspace''s Admins read all of its.';
comment on column public.chat_access_requests.tool_key is
  'The registry row''s label key (never a tool''s name); null for a request about the plan or the role.';
comment on column public.chat_access_requests.asked_hash is
  'sha256 of the asked change (tool key and words): one request per person per change per day.';

-- ─── Who reads and writes ───────────────────────────────────────────────────

alter table public.chat_access_requests enable row level security;
revoke all on table public.chat_access_requests from anon, authenticated;
grant select on table public.chat_access_requests to authenticated;
grant all on table public.chat_access_requests to service_role;

-- The requester reads their own, in the workspace they belong to now; its
-- Admins read all of the workspace's.
drop policy if exists "chat_access_requests: own or admin select" on public.chat_access_requests;
create policy "chat_access_requests: own or admin select"
  on public.chat_access_requests
  for select
  using (
    organization_id in (
      select p.organization_id from public.profiles p
      where p.id = auth.uid()
        and (p.role = 'admin' or chat_access_requests.requester_id = auth.uid())
    )
  );

notify pgrst, 'reload schema';
