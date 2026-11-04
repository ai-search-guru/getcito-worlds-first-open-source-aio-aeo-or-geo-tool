-- ============================================================================
-- 00441: Chat notices, a person's own notes from the system
-- ============================================================================
-- AGENT-OWN-KEY §5.3, §6.2. When the workspace's own AI key fails, every
-- Admin is told once per failure episode: a row at the top of their Inbox's
-- Needs you, and an e-mail by their "Notify me when an agent needs me"
-- (chat_user_prefs.notify_via, 00408). One reminder after 3 days still
-- failing. Kinds own_key_limit_80 and own_key_limit_100 are the key guard's
-- warnings (AGENT-OWN-KEY PR 10).
--
--   * payload: what the words need (provider, class, model), ≤ 4 KB. No
--     brand data: a key belongs to the workspace.
--   * dedupe_key: one notice per person and event, e.g.
--     own_key:{provider}:{failing_since} and its :reminder; unique per person,
--     so failures at once write one row.
--   * read_at: the person opened it. resolved_at: what it was about is over
--     (the key works again); it leaves Needs you.
--
-- A person reads their own rows in the workspace they belong to now, and
-- sets read_at on them. The server writes.

create table if not exists public.chat_notices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null
    check (kind in ('own_key_failed', 'own_key_limit_80', 'own_key_limit_100')),
  payload jsonb not null default '{}'::jsonb check (
    jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 4096
  ),
  dedupe_key text not null check (char_length(dedupe_key) between 1 and 200),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  resolved_at timestamptz,
  unique (user_id, dedupe_key)
);

-- A person's open notices, newest first (the Inbox).
create index if not exists chat_notices_open_idx
  on public.chat_notices (user_id, created_at desc)
  where resolved_at is null;

-- What a key that works again resolves.
create index if not exists chat_notices_organization_idx
  on public.chat_notices (organization_id, kind)
  where resolved_at is null;

comment on table public.chat_notices is
  'Chat (00441): a note from the system to a person (AGENT-OWN-KEY §5.3): their own AI key failed, or reached its agents'' monthly limit. Theirs to read and mark read; the server writes.';

alter table public.chat_notices enable row level security;

revoke all on table public.chat_notices from anon, authenticated;
grant select on table public.chat_notices to authenticated;
grant update (read_at) on table public.chat_notices to authenticated;
grant all on table public.chat_notices to service_role;

drop policy if exists "chat_notices: own select" on public.chat_notices;
create policy "chat_notices: own select"
  on public.chat_notices
  for select
  using (
    user_id = auth.uid()
    and organization_id in (
      select p.organization_id from public.profiles p where p.id = auth.uid()
    )
  );

drop policy if exists "chat_notices: own read" on public.chat_notices;
create policy "chat_notices: own read"
  on public.chat_notices
  for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

notify pgrst, 'reload schema';
