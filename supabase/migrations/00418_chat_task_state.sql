-- ============================================================================
-- 00418: Chat's task strip — where Chat's work on each Action Center task is
-- ============================================================================
-- Complete tasks (CHAT-09 §B, CHAT-08 /tasks), behind CHAT_AGENTIC: nothing
-- writes here while the flag is off.
--
--   * chat_task_state: one row per Action Center task a chat works on, for
--     the strip under the answer (`tasks.updated`): its place in the strip
--     and Chat's own status for it, Queued, Writing, Ready for review or
--     Done. These describe Chat's work, not the task's Action Center status
--     (§B item 6): Done is set only once Action Center has the task
--     completed by the person's click (§D), and Ready for review is where
--     Chat, or an agent, says its work for the task is finished (CHAT-09
--     item 16a, CHAT-21 item 32). action_tasks itself is never changed here:
--     the Action Center engine and its statuses stay as they are (CHAT-09
--     guardrail). run_id is the run working on the task now, or the last one
--     that did; file_id the deliverable drafted for it (the card's "Task:
--     {title}"), before and after it is attached (chat_file_task_links,
--     00411). The task's title, Priority Score and category are read from
--     Action Center each time, never copied here.
--
-- The server writes every row (service role). Rows are readable where their
-- chat is (its policies, 00400 and 00407), and go with it.

create table if not exists public.chat_task_state (
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  action_task_id uuid not null references public.action_tasks(id) on delete cascade,
  -- Its place in the strip, from 1: the order the run took them in.
  position smallint not null check (position >= 1),
  chat_status text not null default 'queued'
    check (chat_status in ('queued', 'writing', 'ready_for_review', 'done')),
  run_id uuid references public.chat_runs(id) on delete set null,
  file_id uuid references public.chat_files(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (conversation_id, action_task_id)
);

create index if not exists chat_task_state_task_idx
  on public.chat_task_state (action_task_id);
create index if not exists chat_task_state_run_idx
  on public.chat_task_state (run_id) where run_id is not null;
create index if not exists chat_task_state_file_idx
  on public.chat_task_state (file_id) where file_id is not null;

drop trigger if exists trg_chat_task_state_updated_at on public.chat_task_state;
create trigger trg_chat_task_state_updated_at
  before update on public.chat_task_state
  for each row execute function public.handle_updated_at();

comment on table public.chat_task_state is
  'Chat (00418): the task strip (CHAT-09 §B): per chat and Action Center task, its place and Chat''s own status (queued, writing, ready_for_review, done), the run on it and the deliverable drafted for it. Never the task''s Action Center status. Readable where the chat is; the server writes.';
comment on column public.chat_task_state.chat_status is
  'Chat''s work on the task: queued, writing, ready_for_review (Chat or an agent finished its work), done (only once Action Center has the task completed by the person''s click).';

-- ─── Who reads and writes ───────────────────────────────────────────────────

alter table public.chat_task_state enable row level security;
revoke all on table public.chat_task_state from anon, authenticated;
grant select on table public.chat_task_state to authenticated;
grant all on table public.chat_task_state to service_role;

drop policy if exists "chat_task_state: chat select" on public.chat_task_state;
create policy "chat_task_state: chat select"
  on public.chat_task_state
  for select
  using (conversation_id in (select c.id from public.chat_conversations c));

notify pgrst, 'reload schema';
