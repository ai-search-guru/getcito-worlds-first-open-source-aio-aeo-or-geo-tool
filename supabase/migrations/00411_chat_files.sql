-- ============================================================================
-- 00411: Chat's Files — the work Chat finished, filed for the workspace, and
-- the storage it takes
-- ============================================================================
-- Outputs and Files (CHAT-06; CHAT-09 items 13–17; CHAT-18 item 21), behind
-- CHAT_AGENTIC: nothing writes here while the flag is off. The server writes
-- every row (service role): it files a deliverable when a run makes one,
-- an answer on Save to Files, and deletes a file for its creator or an
-- Admin (the Chat plan's decision).
--
--   * The bucket chat-files: private. Each file's canonical content (Markdown
--     for a document or report, JSON rows for a table, the source for code,
--     PNG or WebP for an image) under {organization_id}/{file id}/, and the
--     formats rendered from it on a first download, cached beside it (CHAT-06
--     Data notes). 25 MB an object: Chat's own output, not an upload. Members
--     have no policy on it; the app hands out one-time download addresses.
--   * chat_files: one row per filed deliverable or saved answer. Files
--     belong to the workspace (CHAT-06 item 24): every member reads them
--     (brand access is workspace membership today). Its type, the formats it
--     downloads in, where it came from (origin, and the chat, message and run
--     when Chat made it; the Content draft it was opened in), its status
--     (draft, attached to a task, done), audience (public content follows
--     CHAT-05's rule), version (a revision updates the same file), tags and
--     a one-line summary for the finder and the chat's history (CHAT-04
--     item 7), and when it was generated with the newest data it read
--     (items 38–42). Kept a year (expires_at); a daily sweep deletes it and
--     its objects after the 30-day notice. A deleted brand leaves its files
--     to the workspace, a deleted member leaves theirs with no creator.
--   * chat_file_task_links: a file attached to an Action Center task
--     (CHAT-09 item 13), by whom and when. Readable where its file is.
--   * chat_storage_usage: each workspace's bytes and files in Files, kept by
--     the trigger below on every file written, resized or deleted, so the
--     meter and the "Storage is full" check read one row (CHAT-06 items
--     26–29). Attachments (00409) and rendered formats don't count. The
--     limit is the plan's plus its storage packs (00413), worked out on the
--     server.

-- ─── The bucket ─────────────────────────────────────────────────────────────

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'chat-files',
  'chat-files',
  false,
  26214400,
  array[
    'text/markdown',
    'text/html',
    'text/plain',
    'text/csv',
    'application/json',
    'application/ld+json',
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'image/png',
    'image/webp'
  ]
)
-- Run again, it leaves the bucket as an admin may have set it.
on conflict (id) do nothing;

-- ─── Files ──────────────────────────────────────────────────────────────────

-- A list's words as one text, for a generated search column (array_to_string
-- is only stable).
create or replace function public.chat_text_array_words(p_values text[])
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(string_agg(v, ' '), '') from unnest(p_values) as t(v);
$$;

create table if not exists public.chat_files (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- Null: about the workspace, or its brand was deleted.
  brand_id uuid references public.brands(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  title text not null check (char_length(title) between 1 and 200),
  type text not null check (type in ('document', 'table', 'code', 'image', 'report')),
  -- The formats it downloads in (CHAT-06 item 2), the first its main one.
  formats text[] not null default '{}' check (
    formats <@ array[
      'md', 'html', 'docx', 'pdf', 'csv', 'xlsx', 'json', 'jsonld', 'txt', 'png', 'webp'
    ]::text[]
    and public.chat_text_array_distinct(formats)
  ),
  -- The canonical content's type and object in chat-files.
  mime_type text not null check (char_length(mime_type) between 3 and 100),
  storage_path text not null unique check (char_length(storage_path) between 1 and 300),
  size_bytes bigint not null default 0 check (size_bytes >= 0),
  -- From: an Action Center task, Chat, a scheduled job or the Content Editor.
  origin text not null check (origin in ('task', 'chat', 'schedule', 'editor')),
  conversation_id uuid references public.chat_conversations(id) on delete set null,
  message_id uuid references public.chat_messages(id) on delete set null,
  run_id uuid references public.chat_runs(id) on delete set null,
  -- Open in Content Editor: the draft made from it ("Used in Content draft").
  content_draft_id uuid references public.content_drafts(id) on delete set null,
  status text not null default 'draft' check (status in ('draft', 'attached', 'done')),
  audience text not null default 'internal' check (audience in ('internal', 'public')),
  version integer not null default 1 check (version >= 1),
  summary text check (char_length(summary) between 1 and 300),
  tags text[] not null default '{}' check (cardinality(tags) <= 30),
  -- CHAT-06 items 38–42: when it was made (UTC), the newest data it read and
  -- the IANA time zone both were shown in.
  generated_at timestamptz not null default now(),
  data_as_of timestamptz,
  timezone text check (char_length(timezone) between 1 and 64),
  search_tsv tsvector generated always as (
    to_tsvector(
      'simple',
      title || ' ' || coalesce(summary, '') || ' ' || public.chat_text_array_words(tags)
    )
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '1 year')
);

-- Files: the workspace's, newest first.
create index if not exists chat_files_organization_created_idx
  on public.chat_files (organization_id, created_at desc);
create index if not exists chat_files_brand_idx
  on public.chat_files (brand_id) where brand_id is not null;
create index if not exists chat_files_created_by_idx
  on public.chat_files (created_by) where created_by is not null;
create index if not exists chat_files_conversation_idx
  on public.chat_files (conversation_id) where conversation_id is not null;
create index if not exists chat_files_message_idx
  on public.chat_files (message_id) where message_id is not null;
create index if not exists chat_files_run_idx
  on public.chat_files (run_id) where run_id is not null;
create index if not exists chat_files_content_draft_idx
  on public.chat_files (content_draft_id) where content_draft_id is not null;
-- The finder (CHAT-06 items 13–15): title, summary and tags.
create index if not exists chat_files_search_idx
  on public.chat_files using gin (search_tsv);
-- The daily sweep, and its 30-day notice.
create index if not exists chat_files_expires_idx
  on public.chat_files (expires_at);

drop trigger if exists trg_chat_files_updated_at on public.chat_files;
create trigger trg_chat_files_updated_at
  before update on public.chat_files
  for each row execute function public.handle_updated_at();

comment on table public.chat_files is
  'Chat (00411): the work Chat finished, filed for the workspace (CHAT-06): type, formats, origin, status, audience, version, tags, summary, generated_at / data_as_of / timezone; content in the private bucket chat-files; kept a year. Every member reads; the server writes.';
comment on column public.chat_files.storage_path is
  'The canonical content''s object in the chat-files bucket, under {organization_id}/{id}/; rendered formats are cached beside it.';
comment on column public.chat_files.formats is
  'The formats it downloads in (CHAT-06 item 2), its main format first.';

-- ─── Files attached to tasks ────────────────────────────────────────────────

create table if not exists public.chat_file_task_links (
  file_id uuid not null references public.chat_files(id) on delete cascade,
  action_task_id uuid not null references public.action_tasks(id) on delete cascade,
  attached_by uuid references auth.users(id) on delete set null,
  attached_at timestamptz not null default now(),
  primary key (file_id, action_task_id)
);

create index if not exists chat_file_task_links_task_idx
  on public.chat_file_task_links (action_task_id);

comment on table public.chat_file_task_links is
  'Chat (00411): a file attached to an Action Center task (CHAT-09 item 13), by whom and when. Readable where its file is; the server writes.';

-- ─── Storage used ───────────────────────────────────────────────────────────

create table if not exists public.chat_storage_usage (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  bytes_used bigint not null default 0 check (bytes_used >= 0),
  file_count integer not null default 0 check (file_count >= 0),
  updated_at timestamptz not null default now()
);

comment on table public.chat_storage_usage is
  'Chat (00411): a workspace''s bytes and files in Files (CHAT-06 items 26–29), kept by the trigger on chat_files. Members read it; only the trigger writes.';

-- Keeps chat_storage_usage in step with chat_files. Security definer, so
-- the row is kept whoever writes a file. A file leaving takes its bytes off
-- an existing row only: a workspace being deleted takes its counter with it,
-- and a new row there would fail its key.
create or replace function public.chat_files_count_storage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.chat_storage_usage as u (organization_id, bytes_used, file_count)
    values (new.organization_id, new.size_bytes, 1)
    on conflict (organization_id) do update
      set bytes_used = u.bytes_used + excluded.bytes_used,
          file_count = u.file_count + 1,
          updated_at = now();
    return new;
  elsif tg_op = 'DELETE' then
    update public.chat_storage_usage
    set bytes_used = greatest(bytes_used - old.size_bytes, 0),
        file_count = greatest(file_count - 1, 0),
        updated_at = now()
    where organization_id = old.organization_id;
    return old;
  else
    update public.chat_storage_usage
    set bytes_used = greatest(bytes_used + new.size_bytes - old.size_bytes, 0),
        updated_at = now()
    where organization_id = new.organization_id;
    return new;
  end if;
end;
$$;

drop trigger if exists trg_chat_files_count_storage on public.chat_files;
create trigger trg_chat_files_count_storage
  after insert or delete or update of size_bytes on public.chat_files
  for each row execute function public.chat_files_count_storage();

-- ─── Who reads and writes ───────────────────────────────────────────────────

alter table public.chat_files enable row level security;
alter table public.chat_file_task_links enable row level security;
alter table public.chat_storage_usage enable row level security;

revoke all on table public.chat_files from anon, authenticated;
revoke all on table public.chat_file_task_links from anon, authenticated;
revoke all on table public.chat_storage_usage from anon, authenticated;

grant select on table public.chat_files to authenticated;
grant select on table public.chat_file_task_links to authenticated;
grant select on table public.chat_storage_usage to authenticated;

grant all on table public.chat_files to service_role;
grant all on table public.chat_file_task_links to service_role;
grant all on table public.chat_storage_usage to service_role;

-- Files belong to the workspace: its members read them while they belong to it.
drop policy if exists "chat_files: member select" on public.chat_files;
create policy "chat_files: member select"
  on public.chat_files
  for select
  using (
    organization_id in (
      select p.organization_id from public.profiles p where p.id = auth.uid()
    )
  );

drop policy if exists "chat_file_task_links: file select" on public.chat_file_task_links;
create policy "chat_file_task_links: file select"
  on public.chat_file_task_links
  for select
  using (file_id in (select f.id from public.chat_files f));

drop policy if exists "chat_storage_usage: member select" on public.chat_storage_usage;
create policy "chat_storage_usage: member select"
  on public.chat_storage_usage
  for select
  using (
    organization_id in (
      select p.organization_id from public.profiles p where p.id = auth.uid()
    )
  );

notify pgrst, 'reload schema';
