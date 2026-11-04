-- ============================================================================
-- 00400: Chat's core — chats, their messages, runs and steps, and each
-- person's Chat settings
-- ============================================================================
-- The new Chat (the Drive Chat specs, CHAT-00…25), behind CHAT_AGENTIC:
-- nothing reads these tables while the flag is off, and agent_conversations
-- and agent_messages (00009) keep serving today's /dashboard/agent as they do.
--
--   * chat_conversations: one chat. Private to its author (CHAT-20 §16c):
--     only they read it, admins included; the server writes it. brand_id is
--     the brand it is about, null for the workspace as a whole (a Help
--     question). A deleted brand leaves its chats with their author, then
--     about the workspace, as agent_conversations does (00009).
--   * chat_messages: the person's messages and Chat's answers. An answer
--     holds the answer only, never a tool's output (content_md; CHAT-03 item
--     23), and when it was made: generated_at, the newest data it read
--     (data_as_of) and the time zone it was shown in (CHAT-06 items 38–42).
--   * chat_runs: the work behind one answer (one run, one answer: CHAT-00):
--     its status, the model and effort it ran with, and its times. Its chat
--     is kept equal to its answer's by the foreign key.
--   * chat_run_steps: a run's steps in order (CHAT-03). What the person sees
--     (kind, label, detail, scope in names, row count, status) and, for the
--     server and staff only, the tool that ran and its debug record: members
--     are granted every column but those two (the grants below).
--   * chat_step_kinds: the kinds a step can be. A table, not a check: a new
--     kind (CHAT-03 added `execute`; the Content Editor and images add more)
--     is a row a later migration inserts, with no constraint to rewrite and
--     no scan of the steps. Kinds aren't taken away: a step keeps its kind
--     (the key refuses deleting one in use, and finding out reads every step,
--     with no index on kind). The web's CHAT_STEP_KINDS (lib/chat/events.ts)
--     lists the same kinds; its test reads them from the migrations.
--   * chat_user_prefs: a person's Chat settings, on the server so they follow
--     them to every device (DECISIONS N3): the chat menu open or closed
--     (CHAT-01 9a–9f), where pages open (CHAT-25 §12), what Chat focuses on
--     (CHAT-24 §3), and their model and effort (CHAT-16; null = the
--     workspace's default, Auto and Normal). Theirs to write; the server
--     checks the model against its catalog before a run uses it.
--
-- Messages, runs and steps are readable where their chat is (they follow its
-- policies), so sharing a chat with the team is one more policy on
-- chat_conversations later. Approvals, the activity log with Undo, and AI
-- budget metering bring their own tables and columns in later migrations.

-- ─── Step kinds ─────────────────────────────────────────────────────────────

create table if not exists public.chat_step_kinds (
  kind text primary key check (kind ~ '^[a-z][a-z_]{1,39}$')
);

-- CHAT-03 "Labels by kind", and `execute` (CHAT-03 v2) for a step that waits
-- on the person's click.
insert into public.chat_step_kinds (kind) values
  ('thinking'), ('read'), ('open_page'), ('skill'), ('check'),
  ('write'), ('ask'), ('schedule'), ('image'), ('execute')
on conflict (kind) do nothing;

-- The server's list: members read a step's kind on the step itself.
alter table public.chat_step_kinds enable row level security;
revoke all on table public.chat_step_kinds from anon, authenticated;
grant all on table public.chat_step_kinds to service_role;

comment on table public.chat_step_kinds is
  'Chat (00400): the kinds a run step can be (CHAT-03). A new kind is a row a later migration inserts; web lib/chat/events.ts CHAT_STEP_KINDS lists the same.';

-- ─── Chats ──────────────────────────────────────────────────────────────────

create table if not exists public.chat_conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Null: about the workspace as a whole, not one brand.
  brand_id uuid references public.brands(id) on delete set null,
  -- Null until Chat names it from the first message (CHAT-01 item 8); the
  -- web shows "New chat" meanwhile.
  title text check (char_length(title) between 1 and 200),
  -- The full Chat page or the side panel on another page (CHAT-01).
  origin text not null default 'page' check (origin in ('page', 'panel')),
  -- The route it was started on, for "Back to {page}" (CHAT-01).
  origin_page text check (char_length(origin_page) between 1 and 500),
  pinned_at timestamptz,
  archived_at timestamptz,
  -- Recents' order: the last message, not a rename or a pin. Kept by the
  -- trigger on chat_messages below.
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists chat_conversations_user_recent_idx
  on public.chat_conversations (user_id, last_message_at desc);
create index if not exists chat_conversations_organization_idx
  on public.chat_conversations (organization_id);
create index if not exists chat_conversations_brand_idx
  on public.chat_conversations (brand_id) where brand_id is not null;

drop trigger if exists trg_chat_conversations_updated_at on public.chat_conversations;
create trigger trg_chat_conversations_updated_at
  before update on public.chat_conversations
  for each row execute function public.handle_updated_at();

comment on table public.chat_conversations is
  'Chat (00400): one chat, private to its author (CHAT-20 §16c): only they read it, admins included. Written by the server.';

-- ─── Messages ───────────────────────────────────────────────────────────────

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  -- The message, or the answer only: a tool's output never goes here. Up to
  -- 200,000 characters: the server cuts or refuses a longer one first.
  content_md text not null default '' check (char_length(content_md) <= 200000),
  -- An answer's "Generated …" (UTC), the newest data it read ("Data as of",
  -- null when it read none) and the IANA time zone both were shown in.
  generated_at timestamptz,
  data_as_of timestamptz,
  timezone text check (char_length(timezone) between 1 and 64),
  -- clock_timestamp(): a question and its answer written in one statement
  -- still come in order.
  created_at timestamptz not null default clock_timestamp(),
  -- For chat_runs' key: a run's chat is its answer's.
  unique (id, conversation_id)
);

create index if not exists chat_messages_conversation_created_idx
  on public.chat_messages (conversation_id, created_at);

comment on table public.chat_messages is
  'Chat (00400): a chat''s messages and answers. An answer holds the answer only, with when it was made and the newest data it read (CHAT-06 38–42). Written by the server.';

-- A new message moves its chat up Recents (last_message_at). Security
-- definer, so the update reaches the chat whoever writes the message: today
-- only the server does (service role), and members may not update chats.
-- greatest(): a message written late never moves its chat back. Not covered
-- by a test (the repository has no database tests); nothing else sets
-- last_message_at.
create or replace function public.chat_touch_last_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.chat_conversations
  set last_message_at = greatest(last_message_at, new.created_at)
  where id = new.conversation_id;
  return new;
end;
$$;

drop trigger if exists trg_chat_messages_touch_conversation on public.chat_messages;
create trigger trg_chat_messages_touch_conversation
  after insert on public.chat_messages
  for each row execute function public.chat_touch_last_message();

-- ─── Runs ───────────────────────────────────────────────────────────────────

create table if not exists public.chat_runs (
  id uuid primary key default gen_random_uuid(),
  -- The answer this run writes, and that answer's chat.
  message_id uuid not null unique,
  conversation_id uuid not null,
  -- queued: waiting for a free run (CHAT-20 §14); waiting: on the person (a
  -- question, an approval, a click, a plan's Start); paused: paused by the
  -- person; paused_cap: the month's AI limit is used (CHAT-04).
  status text not null default 'queued' check (
    status in (
      'queued', 'running', 'waiting', 'paused', 'paused_cap', 'done', 'error', 'stopped'
    )
  ),
  -- 'auto' or the model the person picked (CHAT-16).
  model text not null default 'auto' check (char_length(model) between 1 and 200),
  effort text not null default 'normal' check (effort in ('normal', 'high', 'max')),
  -- A standard result code (CHAT-20 §11a: 'failed', 'timeout'…) when it ended in error.
  error text check (error ~ '^[a-z_]{1,40}$'),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  foreign key (message_id, conversation_id)
    references public.chat_messages (id, conversation_id) on delete cascade
);

create index if not exists chat_runs_conversation_created_idx
  on public.chat_runs (conversation_id, created_at desc);
-- The runs under way, oldest first: the queue, the runs tray, the sweeps.
create index if not exists chat_runs_open_idx
  on public.chat_runs (created_at)
  where status in ('queued', 'running', 'waiting', 'paused', 'paused_cap');

comment on table public.chat_runs is
  'Chat (00400): the work behind one answer (CHAT-00: one run, one answer), with its status, model, effort and times. Written by the server.';

-- ─── Steps ──────────────────────────────────────────────────────────────────

create table if not exists public.chat_run_steps (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.chat_runs(id) on delete cascade,
  -- Its place in the run, from 1: how a question or an approval names it to
  -- the browser, which gets no ids.
  position smallint not null check (position >= 1),
  kind text not null references public.chat_step_kinds(kind) on update cascade,
  -- pending: in a plan, not started; waiting: on the person.
  status text not null default 'running' check (
    status in ('pending', 'running', 'waiting', 'done', 'error', 'skipped')
  ),
  -- The label registry's words (CHAT-03): "Read Citations".
  label text not null check (char_length(label) between 1 and 200),
  -- "Pricing prompts · Last 30 days · ChatGPT, Perplexity · 42 rows", or an
  -- error's plain reason.
  detail text check (char_length(detail) between 1 and 500),
  -- What a read covered, in names only (subject, date range, platforms,
  -- brand): never ids. The tool's own arguments are in debug_json.
  scope_json jsonb check (
    scope_json is null
    or (jsonb_typeof(scope_json) = 'object' and octet_length(scope_json::text) <= 8000)
  ),
  row_count integer check (row_count >= 0),
  -- A read's newest data (CHAT-20 §15a); the answer's "Data as of" is the newest of them.
  data_as_of timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  -- Server and staff only (members aren't granted them): the registry name
  -- of the tool that ran, and what the staff Debug view shows (CHAT-03 items
  -- 25–26: input, output, model, tokens, latency). Up to 1 MB as text: the
  -- server shortens a large tool output before it keeps it here.
  tool text check (char_length(tool) between 1 and 100),
  debug_json jsonb check (
    debug_json is null
    or (jsonb_typeof(debug_json) = 'object' and octet_length(debug_json::text) <= 1000000)
  ),
  unique (run_id, position)
);

comment on table public.chat_run_steps is
  'Chat (00400): a run''s steps in order (CHAT-03). Members read every column but tool and debug_json, which stay with the server and staff. Written by the server.';
comment on column public.chat_run_steps.scope_json is
  'What a read covered, in names only (subject, dateRange, platforms, brand): never ids. Members read it.';
comment on column public.chat_run_steps.debug_json is
  'The staff Debug view (CHAT-03 25–26): the tool''s input and output, model, tokens, latency. Never granted to members.';

-- ─── A person's Chat settings ───────────────────────────────────────────────

-- Whether a list has no value twice: a check can't hold a subquery.
create or replace function public.chat_text_array_distinct(p_values text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select count(*) = count(distinct v) from unnest(p_values) as t(v);
$$;

create table if not exists public.chat_user_prefs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  -- The chat menu beside the conversation (CHAT-01 9a–9f); open by default.
  menu_open boolean not null default true,
  -- Where a page Chat writes opens (CHAT-25 §12): ask each time, keep working
  -- in chat, the editor inside Chat, or the Content Editor.
  page_open text not null default 'ask' check (page_open in ('ask', 'chat', 'here', 'editor')),
  -- What Chat focuses on (CHAT-24 §2), in the order picked: the first one
  -- leads Home. Null: not asked yet (the picker shows once); empty: skipped,
  -- or none picked. Each area once.
  focus text[] check (
    focus <@ array['lead', 'comp', 'growth', 'seo', 'content', 'brand', 'pd', 'bd']::text[]
    and cardinality(focus) <= 8
    and public.chat_text_array_distinct(focus)
  ),
  -- Null: the workspace's default (Auto). Only its length is checked here:
  -- the server checks it against the model catalog and the plan before a
  -- run uses it (CHAT-16; the price sync and the engine, C1 and C3).
  model text check (char_length(model) between 1 and 200),
  -- Null: the workspace's default (Normal). CHAT-16 §E: Normal, High, Max.
  effort text check (effort in ('normal', 'high', 'max')),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_chat_user_prefs_updated_at on public.chat_user_prefs;
create trigger trg_chat_user_prefs_updated_at
  before update on public.chat_user_prefs
  for each row execute function public.handle_updated_at();

comment on table public.chat_user_prefs is
  'Chat (00400): a person''s Chat settings, on the server so they follow them to every device (DECISIONS N3): chat menu, where pages open, focus areas, model and effort. Theirs to read and write.';

-- ─── Who reads and writes ───────────────────────────────────────────────────

alter table public.chat_conversations enable row level security;
alter table public.chat_messages enable row level security;
alter table public.chat_runs enable row level security;
alter table public.chat_run_steps enable row level security;
alter table public.chat_user_prefs enable row level security;

revoke all on table public.chat_conversations from anon, authenticated;
revoke all on table public.chat_messages from anon, authenticated;
revoke all on table public.chat_runs from anon, authenticated;
revoke all on table public.chat_run_steps from anon, authenticated;
revoke all on table public.chat_user_prefs from anon, authenticated;

grant select on table public.chat_conversations to authenticated;
grant select on table public.chat_messages to authenticated;
grant select on table public.chat_runs to authenticated;
-- Every column but the tool and the debug record (CHAT-03 item 22).
grant select (
  id, run_id, position, kind, status, label, detail, scope_json, row_count,
  data_as_of, started_at, finished_at
) on table public.chat_run_steps to authenticated;
grant select, insert, update on table public.chat_user_prefs to authenticated;

grant all on table public.chat_conversations to service_role;
grant all on table public.chat_messages to service_role;
grant all on table public.chat_runs to service_role;
grant all on table public.chat_run_steps to service_role;
grant all on table public.chat_user_prefs to service_role;

-- The author reads their chat while they belong to its organization: a
-- member who left, or moved to another, doesn't.
drop policy if exists "chat_conversations: author select" on public.chat_conversations;
create policy "chat_conversations: author select"
  on public.chat_conversations
  for select
  using (
    user_id = auth.uid()
    and organization_id in (
      select p.organization_id from public.profiles p where p.id = auth.uid()
    )
  );

-- Messages, runs and steps follow their chat's policies.
drop policy if exists "chat_messages: chat select" on public.chat_messages;
create policy "chat_messages: chat select"
  on public.chat_messages
  for select
  using (conversation_id in (select c.id from public.chat_conversations c));

drop policy if exists "chat_runs: chat select" on public.chat_runs;
create policy "chat_runs: chat select"
  on public.chat_runs
  for select
  using (conversation_id in (select c.id from public.chat_conversations c));

drop policy if exists "chat_run_steps: chat select" on public.chat_run_steps;
create policy "chat_run_steps: chat select"
  on public.chat_run_steps
  for select
  using (run_id in (select r.id from public.chat_runs r));

drop policy if exists "chat_user_prefs: own select" on public.chat_user_prefs;
create policy "chat_user_prefs: own select"
  on public.chat_user_prefs
  for select
  using (user_id = auth.uid());

drop policy if exists "chat_user_prefs: own insert" on public.chat_user_prefs;
create policy "chat_user_prefs: own insert"
  on public.chat_user_prefs
  for insert
  with check (user_id = auth.uid());

drop policy if exists "chat_user_prefs: own update" on public.chat_user_prefs;
create policy "chat_user_prefs: own update"
  on public.chat_user_prefs
  for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

notify pgrst, 'reload schema';
