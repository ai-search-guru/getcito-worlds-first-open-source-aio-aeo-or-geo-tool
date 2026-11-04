-- ============================================================================
-- 00409: Chat's attachments — the files a person attaches to a message
-- ============================================================================
-- The composer's Attach (CHAT-02 items 18–22), behind CHAT_AGENTIC: nothing
-- writes here while the flag is off. An attachment is data for the run that
-- reads it (CHAT-05), never a deliverable: it doesn't show in Files (00411)
-- and doesn't count toward the workspace's storage.
--
--   * The bucket chat-uploads: private, 10 MB a file (CHAT-00: every
--     upload), the types CHAT-02 item 19 lists. Each file goes under its
--     workspace's folder ({organization_id}/{upload id}). Members have no
--     policy on it: the app gives a one-time upload address after its own
--     checks, and reads the file with the service role, as content-images
--     does (00272).
--   * chat_uploads: one row per attached file. pending until the file
--     arrived, ready once the server checked it, failed when it didn't (the
--     chip's Retry). conversation_id is null for a new chat's draft, before
--     its first message makes the chat; message_id is set when the message
--     is sent, and a message carries at most 5 (the trigger below backs the
--     server's check). Kept 90 days (expires_at): a daily sweep deletes the
--     row and its file, also after its chat was deleted, so no file is left
--     behind without a row.
--
-- The server writes every row (service role). A person reads their own, and
-- the attachments of a chat they can read (a shared chat's, 00407).

-- ─── The bucket ─────────────────────────────────────────────────────────────

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'chat-uploads',
  'chat-uploads',
  false,
  10485760,
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'text/markdown',
    'text/csv',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/json',
    'text/html',
    'image/png',
    'image/jpeg',
    'image/webp'
  ]
)
-- Run again, it leaves the bucket as an admin may have set it.
on conflict (id) do nothing;

-- ─── Attachments ────────────────────────────────────────────────────────────

create table if not exists public.chat_uploads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- The person who attached it.
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Null while it is in a new chat's draft. A deleted chat or message leaves
  -- its attachments to the sweep, which deletes each file with its row.
  conversation_id uuid references public.chat_conversations(id) on delete set null,
  -- The message it was sent with; null while it is in a draft.
  message_id uuid references public.chat_messages(id) on delete set null,
  -- The file's name as the person had it, for the chip.
  name text not null check (char_length(name) between 1 and 255),
  mime_type text not null check (
    mime_type in (
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
      'text/markdown',
      'text/csv',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/json',
      'text/html',
      'image/png',
      'image/jpeg',
      'image/webp'
    )
  ),
  size_bytes integer not null check (size_bytes between 1 and 10485760),
  -- Its object in chat-uploads: {organization_id}/{id}.
  storage_path text not null unique check (char_length(storage_path) between 1 and 300),
  status text not null default 'pending' check (status in ('pending', 'ready', 'failed')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '90 days')
);

create index if not exists chat_uploads_user_created_idx
  on public.chat_uploads (user_id, created_at desc);
create index if not exists chat_uploads_organization_idx
  on public.chat_uploads (organization_id);
create index if not exists chat_uploads_conversation_idx
  on public.chat_uploads (conversation_id) where conversation_id is not null;
create index if not exists chat_uploads_message_idx
  on public.chat_uploads (message_id) where message_id is not null;
-- The daily sweep of expired attachments.
create index if not exists chat_uploads_expires_idx
  on public.chat_uploads (expires_at);

comment on table public.chat_uploads is
  'Chat (00409): the files a person attached to a message (CHAT-02 18–22), in the private bucket chat-uploads; 10 MB each, 5 a message, kept 90 days. Data for the run, never a deliverable. Written by the server; a person reads their own and those of a chat they can read.';
comment on column public.chat_uploads.storage_path is
  'The object in the chat-uploads bucket: {organization_id}/{id}.';

-- At most 5 attachments a message: the database's backstop to the server's
-- check. Counted when an attachment joins a message.
create or replace function public.chat_uploads_per_message()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.message_id is not null
     and (tg_op = 'INSERT' or new.message_id is distinct from old.message_id)
     and (
       select count(*) from public.chat_uploads u
       where u.message_id = new.message_id and u.id <> new.id
     ) >= 5
  then
    raise exception 'a message carries at most 5 attachments' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_chat_uploads_per_message on public.chat_uploads;
create trigger trg_chat_uploads_per_message
  before insert or update of message_id on public.chat_uploads
  for each row execute function public.chat_uploads_per_message();

-- ─── Who reads and writes ───────────────────────────────────────────────────

alter table public.chat_uploads enable row level security;
revoke all on table public.chat_uploads from anon, authenticated;
grant select on table public.chat_uploads to authenticated;
grant all on table public.chat_uploads to service_role;

-- Their own, while they belong to its workspace; and those of a chat they
-- can read (its policies: the author's, or a shared one).
drop policy if exists "chat_uploads: own or chat select" on public.chat_uploads;
create policy "chat_uploads: own or chat select"
  on public.chat_uploads
  for select
  using (
    (
      user_id = auth.uid()
      and organization_id in (
        select p.organization_id from public.profiles p where p.id = auth.uid()
      )
    )
    or conversation_id in (select c.id from public.chat_conversations c)
  );

notify pgrst, 'reload schema';
