-- ============================================================================
-- 00417: Chat's questions and next moves, and the shortcut a message started
-- ============================================================================
-- Questions and next moves (CHAT-07) and shortcuts (CHAT-08), behind
-- CHAT_AGENTIC: nothing writes here while the flag is off. The server writes
-- every row (service role); members read them where their run is (its chat's
-- policies, 00400 and 00407), so a reload, the side panel and another device
-- show the same card and the same chips.
--
--   * chat_asks: a question card a run paused on (CHAT-07 §A). One row per
--     question, in the order the run asked them (position, from 1): the
--     card's "1 of 2" comes from it. A run asks at most 4 questions (§B: 2 a
--     task, 4 a run), which position's limit backs. Each has 2–4 options with
--     exactly one Recommended (the server's rule, backed by
--     chat_ask_options_valid), an "Other…" row when allow_other, and several
--     picks when multi. step_id is the run's `ask` step, "Waiting for your
--     answer". The answer is written once, with answered_at (a second one is
--     the API's 409): {selected: [0], other, skipped, via: card | composer}.
--     Stop saves the open ones as skipped (§A item 9). A subtask's question
--     (CHAT-27) is its own run's, shown under the parent.
--   * chat_next_moves: the 2–4 moves a finished run suggests (§C), ranked
--     from 1, so the chips and the composer's ghost text come back after a
--     reload. label names a real object, never an id or a tool; prompt is
--     what a click sends, under 80 characters so it fits as ghost text.
--     class is the move's action class: an Analyst or an Agency partner gets
--     no write or execute move, as a chip or as ghost text (§C item 4).
--     ghost_ok is the server's mark that the move continues an object of
--     this run: only such a move is shown as ghost text.
--   * chat_messages.shortcut_id: the shortcut a person's message started
--     (CHAT-08 Data notes: 'tasks', 'analyze', 'report'…), so the context
--     engine runs that shortcut's data plan and runs can be counted per
--     shortcut. context_json (00407) carries it for the browser; this is the
--     column an index counts by. A person's message only.

-- ─── Questions ──────────────────────────────────────────────────────────────

-- Whether a question's options are 2–4 rows, each with a label, exactly one
-- of them Recommended (CHAT-07 Data notes: the server refuses any other).
create or replace function public.chat_ask_options_valid(p_options jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when jsonb_typeof(p_options) <> 'array' then false
    when jsonb_array_length(p_options) not between 2 and 4 then false
    else coalesce(
      (
        select bool_and(
            jsonb_typeof(o) = 'object'
            and jsonb_typeof(o -> 'label') = 'string'
            and char_length(o ->> 'label') between 1 and 120
          )
          and count(*) filter (where o -> 'recommended' = 'true'::jsonb) = 1
        from jsonb_array_elements(p_options) as t(o)
      ),
      false
    )
  end;
$$;

create table if not exists public.chat_asks (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.chat_runs(id) on delete cascade,
  -- The run's `ask` step ("Waiting for your answer").
  step_id uuid not null references public.chat_run_steps(id) on delete cascade,
  -- Its place among the run's questions, from 1: at most 4 a run (CHAT-07 §B).
  position smallint not null check (position between 1 and 4),
  question text not null check (char_length(question) between 1 and 300),
  -- [{label, detail, recommended, cost_multiplier}]: 2–4 rows, one Recommended.
  -- A cost multiplier comes from the model prices (00404), never from code.
  options_json jsonb not null check (
    public.chat_ask_options_valid(options_json) and octet_length(options_json::text) <= 8000
  ),
  allow_other boolean not null default false,
  multi boolean not null default false,
  -- {selected: [0], other: null, skipped: false, via: 'card' | 'composer'}.
  answer_json jsonb check (
    answer_json is null
    or (jsonb_typeof(answer_json) = 'object' and octet_length(answer_json::text) <= 4000)
  ),
  answered_at timestamptz,
  created_at timestamptz not null default now(),
  unique (run_id, position),
  check ((answer_json is null) = (answered_at is null))
);

create index if not exists chat_asks_step_idx
  on public.chat_asks (step_id);

comment on table public.chat_asks is
  'Chat (00417): the questions a run paused on (CHAT-07 §A), in order, at most 4 a run: 2–4 options with one Recommended, Other, multi, and the answer once given. Readable where the run is; the server writes.';
comment on column public.chat_asks.answer_json is
  '{selected: [option indexes], other: text or null, skipped: boolean, via: card | composer}. Written once, with answered_at.';

-- ─── Next moves ─────────────────────────────────────────────────────────────

create table if not exists public.chat_next_moves (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.chat_runs(id) on delete cascade,
  -- Best first, from 1: the ghost text's candidate is rank 1. At most 4 a run.
  rank smallint not null check (rank between 1 and 4),
  -- "Start task 2: comparison page": real objects, never ids or tool names.
  label text not null check (char_length(label) between 1 and 80),
  -- What a click sends as the person's next message (CHAT-07 §C item 5).
  prompt text not null check (char_length(prompt) between 1 and 80),
  -- The move's action class: read-only roles get read moves only.
  class text not null check (class in ('read', 'write', 'execute')),
  -- It continues an object of this run, so it may show as ghost text.
  ghost_ok boolean not null default false,
  created_at timestamptz not null default now(),
  unique (run_id, rank)
);

comment on table public.chat_next_moves is
  'Chat (00417): the 2–4 next moves a finished run suggests (CHAT-07 §C), ranked, with the prompt a click sends, the move''s action class (read-only roles see read moves only) and whether it may show as ghost text. Readable where the run is; the server writes.';

-- ─── The shortcut a message started ─────────────────────────────────────────

alter table public.chat_messages
  add column if not exists shortcut_id text check (shortcut_id ~ '^[a-z][a-z0-9-]{1,39}$');

-- Only a person's message starts a shortcut.
alter table public.chat_messages
  drop constraint if exists chat_messages_shortcut_id_role_check;
alter table public.chat_messages
  add constraint chat_messages_shortcut_id_role_check
    check (shortcut_id is null or role = 'user');

comment on column public.chat_messages.shortcut_id is
  'The shortcut that started this message (CHAT-08: tasks, analyze, report…), whose data plan the run uses. A person''s message only; context_json (00407) carries it for the browser.';

-- Runs per shortcut (CHAT-08 telemetry).
create index if not exists chat_messages_shortcut_idx
  on public.chat_messages (shortcut_id, created_at)
  where shortcut_id is not null;

-- ─── Who reads and writes ───────────────────────────────────────────────────

alter table public.chat_asks enable row level security;
alter table public.chat_next_moves enable row level security;

revoke all on table public.chat_asks from anon, authenticated;
revoke all on table public.chat_next_moves from anon, authenticated;

grant select on table public.chat_asks to authenticated;
grant select on table public.chat_next_moves to authenticated;

grant all on table public.chat_asks to service_role;
grant all on table public.chat_next_moves to service_role;

-- Questions and moves follow their run, which follows its chat (00400).
drop policy if exists "chat_asks: run select" on public.chat_asks;
create policy "chat_asks: run select"
  on public.chat_asks
  for select
  using (run_id in (select r.id from public.chat_runs r));

drop policy if exists "chat_next_moves: run select" on public.chat_next_moves;
create policy "chat_next_moves: run select"
  on public.chat_next_moves
  for select
  using (run_id in (select r.id from public.chat_runs r));

notify pgrst, 'reload schema';
