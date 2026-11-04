-- ============================================================================
-- 00407: Chat's chats — shared with the team, read, deleted with Undo and
-- searched; and what a message was scoped to
-- ============================================================================
-- Chat's shell and composer (CHAT-01, CHAT-02; CHAT-20 §15b, §16c), behind
-- CHAT_AGENTIC: nothing reads or writes these columns while the flag is off.
-- The server writes every one of them (service role), as it writes the rest
-- of a chat (00400).
--
--   * shared_at: Share with team (CHAT-20 §16c). Null: private to its author,
--     as every chat starts. Set: every member of the chat's workspace reads
--     it, its messages, runs and steps (they follow the chat's policies,
--     00400); the row shows the author's initials. Unshare clears it. A
--     brand's access is its workspace's membership today; when brands are
--     shared with Agency partners one by one (a Team feature), this policy
--     narrows with it.
--   * last_read_at: when the author last opened the chat's newest answer.
--     An answer finished after it is an unread result, which keeps the chat
--     in Agents at work and bold in Recents (CHAT-01 agentic update).
--   * deleted_at: Delete with Undo (CHAT-01 row menu). A deleted chat is
--     gone for every member at once (the policies below leave it out); the
--     server brings it back on Undo, and its sweep removes it for good once
--     the Undo toast is over (CHAT-20 §16c: a hard delete after Undo), its
--     messages, runs and steps with it. Activity log rows stay (00402).
--   * search_tsv: Search chats and the Ctrl K palette (CHAT-01 item 6) look
--     in titles and message text. The 'simple' configuration: no stemming,
--     so a chat in any language is found by its words.
--   * chat_messages.context_json: what the person scoped a message to
--     (CHAT-02 Data notes): the page and its chips as sent (a removed chip
--     isn't), the @ references with their scope, the attachments
--     (chat_uploads, 00409), Browse a page, and the skill or shortcut that
--     started it. A person's message only; an answer has none.

-- ─── Chats ──────────────────────────────────────────────────────────────────

alter table public.chat_conversations
  add column if not exists shared_at timestamptz,
  add column if not exists last_read_at timestamptz,
  add column if not exists deleted_at timestamptz,
  add column if not exists search_tsv tsvector
    generated always as (to_tsvector('simple', coalesce(title, ''))) stored;

comment on column public.chat_conversations.shared_at is
  'Share with team (CHAT-20 §16c): null = private to the author; set = every member of the workspace reads the chat. Written by the server.';
comment on column public.chat_conversations.last_read_at is
  'When the author last opened the newest answer: an answer finished after it is an unread result (Agents at work, bold in Recents).';
comment on column public.chat_conversations.deleted_at is
  'Deleted, with the Undo toast still open: no member reads it; the server restores it on Undo and its sweep removes it for good afterwards.';
comment on column public.chat_conversations.search_tsv is
  'The title''s words (simple configuration, any language), for Search chats and Ctrl K.';

-- Search chats: titles.
create index if not exists chat_conversations_search_idx
  on public.chat_conversations using gin (search_tsv);
-- All chats › Team: the workspace's shared chats, newest first.
create index if not exists chat_conversations_shared_idx
  on public.chat_conversations (organization_id, last_message_at desc)
  where shared_at is not null and deleted_at is null;
-- The sweep of deleted chats once their Undo is over.
create index if not exists chat_conversations_deleted_idx
  on public.chat_conversations (deleted_at)
  where deleted_at is not null;

-- ─── Messages ───────────────────────────────────────────────────────────────

alter table public.chat_messages
  add column if not exists context_json jsonb
    check (
      context_json is null
      or (jsonb_typeof(context_json) = 'object' and octet_length(context_json::text) <= 32000)
    ),
  add column if not exists search_tsv tsvector
    generated always as (to_tsvector('simple', content_md)) stored;

-- Only a person's message carries what it was scoped to.
alter table public.chat_messages
  drop constraint if exists chat_messages_context_json_role_check;
alter table public.chat_messages
  add constraint chat_messages_context_json_role_check
    check (context_json is null or role = 'user');

comment on column public.chat_messages.context_json is
  'What the person scoped the message to (CHAT-02): {page, chips [{key, label, value}], references [{type, id, label, scope}], attachments [upload ids], browse, skill, shortcut}. Removed chips are not in it. A person''s message only; up to 32,000 bytes.';
comment on column public.chat_messages.search_tsv is
  'The message''s words (simple configuration, any language), for Search chats and Ctrl K.';

-- Search chats: message text.
create index if not exists chat_messages_search_idx
  on public.chat_messages using gin (search_tsv);

-- ─── Who reads ──────────────────────────────────────────────────────────────

-- 00400's author policy, without deleted chats.
drop policy if exists "chat_conversations: author select" on public.chat_conversations;
create policy "chat_conversations: author select"
  on public.chat_conversations
  for select
  using (
    user_id = auth.uid()
    and deleted_at is null
    and organization_id in (
      select p.organization_id from public.profiles p where p.id = auth.uid()
    )
  );

-- A shared chat: every member of its workspace, while they belong to it.
drop policy if exists "chat_conversations: shared select" on public.chat_conversations;
create policy "chat_conversations: shared select"
  on public.chat_conversations
  for select
  using (
    shared_at is not null
    and deleted_at is null
    and organization_id in (
      select p.organization_id from public.profiles p where p.id = auth.uid()
    )
  );

notify pgrst, 'reload schema';
