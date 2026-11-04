-- ============================================================================
-- 00463: where a draft was made, and the chat that made it
-- ============================================================================
-- Chat Wave 4 (CHAT-25 §2, CHAT-15 §C), behind CHAT_AGENTIC for the chat
-- parts. Content › Library's "Made in" column and filter, the editor's
-- "From chat: {title}" line and Chat's version cards read these; the
-- writers set them as they make a draft (W4-10).
--
--   * content_drafts.origin: editor (made in the Content Editor, the
--     default), chat (Chat's create_draft), action_center (an Action Center
--     task), agent (an agent's run) or mcp (an MCP client). Set once, when
--     the draft is made.
--   * content_drafts.conversation_id: the chat a draft was made in, or
--     continued from (chat_conversations, 00400). Null once the chat is
--     deleted: the draft stays. A member reads it with the draft; whether
--     they may open the chat is the chat's own policy (00400, 00424).
--   * A member's own write (the editor, and Chat's create_draft in a run
--     with the person's session) may say editor or chat, and name only a
--     chat of their own; neither changes afterwards. The other origins, and
--     any change, are the server's (service role).
--   * Drafts made before this: one with an action_id is action_center, the
--     rest stay editor. Their updated_at isn't touched, so the Library keeps
--     its order.

alter table public.content_drafts
  add column if not exists origin text not null default 'editor',
  add column if not exists conversation_id uuid
    references public.chat_conversations(id) on delete set null;

alter table public.content_drafts
  drop constraint if exists content_drafts_origin_check;
alter table public.content_drafts
  add constraint content_drafts_origin_check
    check (origin in ('editor', 'chat', 'action_center', 'agent', 'mcp'));

-- A member's write: editor or chat, a chat of their own, set once. Its own
-- trigger, beside guard_content_draft_server_columns (00289's), which stays
-- as it is.
create or replace function public.guard_content_draft_origin()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- A role that bypasses RLS is server-side (service role, migrations).
  if (select rolbypassrls from pg_catalog.pg_roles where rolname = current_user) then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.origin not in ('editor', 'chat') then
      raise exception 'content draft origin is set server-side'
        using errcode = '42501';
    end if;
    if new.conversation_id is not null and not exists (
      select 1
      from public.chat_conversations c
      where c.id = new.conversation_id
        and c.user_id = auth.uid()
        and c.deleted_at is null
    ) then
      raise exception 'content draft chat is not the person''s'
        using errcode = '42501';
    end if;
  elsif new.origin is distinct from old.origin
     or (new.conversation_id is distinct from old.conversation_id
         and new.conversation_id is not null)
  then
    raise exception 'content draft origin is managed server-side'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists content_drafts_guard_origin on public.content_drafts;
create trigger content_drafts_guard_origin
  before insert or update of origin, conversation_id on public.content_drafts
  for each row execute function public.guard_content_draft_origin();

-- The drafts an Action Center task made. The updated_at trigger is off for
-- this one statement (the migration's own transaction), so no draft looks
-- edited today.
alter table public.content_drafts disable trigger content_drafts_updated_at;
update public.content_drafts
set origin = 'action_center'
where action_id is not null
  and origin = 'editor';
alter table public.content_drafts enable trigger content_drafts_updated_at;

-- A chat's drafts (its version cards, and "From chat" back to it).
create index if not exists content_drafts_conversation_idx
  on public.content_drafts (conversation_id)
  where conversation_id is not null;

comment on column public.content_drafts.origin is
  'Where the draft was made (00463; CHAT-25): editor (default), chat, action_center, agent or mcp. Content › Library''s "Made in". Drafts from before 00463 with an action_id are action_center.';
comment on column public.content_drafts.conversation_id is
  'The chat the draft was made in or continued from (00463; CHAT-25). Null for other drafts, and once the chat is deleted.';

notify pgrst, 'reload schema';
