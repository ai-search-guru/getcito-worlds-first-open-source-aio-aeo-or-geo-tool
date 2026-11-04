-- ============================================================================
-- 00461: notices about scheduled jobs and follow-up checks
-- ============================================================================
-- CHAT-12 items 16, 26–27 and CHAT-20 §13 (Wave 3, W3-04a): three new kinds
-- of chat_notices (00441), behind CHAT_AGENTIC. A job's creator gets them at
-- the top of their Inbox's Needs you:
--
--   * schedule_failed: a run of their job failed after its retry ("{Job}
--     didn't run: {reason}"), in plain words, never a raw error.
--   * schedule_paused: their job turned itself off: the monthly AI limit,
--     their role or brand access, its brand, its skill, or 3 failed runs.
--   * followup_result: a follow-up check they (or a Full auto run for them)
--     set has its result.
--
-- The payload names the job (its id, title and why), as the Inbox row says
-- it; nothing else. A job that runs again, or is turned back on, closes its
-- notices (resolved_at). A successful run needs no notice: the job's chat is
-- its creator's, and its result is in their Inbox as an unread answer.
--
-- The list includes 00446's kinds (agent_went_live, agent_go_live_off):
-- 00446 is applied before this one, and dropping its kinds here would refuse
-- its notices.

alter table public.chat_notices
  drop constraint if exists chat_notices_kind_check;
alter table public.chat_notices
  add constraint chat_notices_kind_check check (
    kind in (
      'own_key_failed',
      'own_key_limit_80',
      'own_key_limit_100',
      'agent_went_live',
      'agent_go_live_off',
      'schedule_failed',
      'schedule_paused',
      'followup_result'
    )
  );

-- A job's open notices, which a run that goes on closes.
create index if not exists chat_notices_schedule_idx
  on public.chat_notices ((payload ->> 'scheduleId'))
  where resolved_at is null and kind in ('schedule_failed', 'schedule_paused');

notify pgrst, 'reload schema';
