-- ============================================================================
-- 00378: which pending Cloro tasks went to ChatGPT's legacy interface
-- ============================================================================
-- A prompt's ChatGPT task asks for its query fan-out one day a week through
-- Cloro's legacy desktop interface (CLORO_CHATGPT_FANOUT), which Cloro calls
-- best-effort and temporary. When Cloro takes such a task and then fails it,
-- the webhook sends it again without legacy, so the day keeps its answer
-- (backend/src/routes/cloroCallback.js). The callback only has this row to
-- go on, so the row says whether the task was a legacy one. Every other task,
-- and every row from before this file, is not.

alter table public.cloro_pending_tasks
  add column if not exists legacy boolean not null default false;
