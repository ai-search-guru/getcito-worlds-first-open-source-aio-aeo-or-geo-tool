-- ============================================================================
-- 00445: a step an agent took live on its own, in the Activity log
-- ============================================================================
-- AUTONOMOUS-GO-LIVE §10.3 (PR 5). An agent an Admin allowed may take an
-- EXECUTE (a CMS draft today) live without a person's click, in Full auto,
-- once its guards pass. Its Activity row says so: approval `auto` with
-- auto_via `go_live`, the agent and its run. Only an EXECUTE in an agent run
-- goes live on its own, so the log refuses go_live anywhere else. The Undo
-- check stays: an EXECUTE has no Undo (Take down is a row of its own later).

alter table public.chat_activity_log
  drop constraint if exists chat_activity_log_auto_via_check;
alter table public.chat_activity_log
  add constraint chat_activity_log_auto_via_check
  check (auto_via in ('always', 'full_auto', 'dont_ask_again', 'go_live'));

alter table public.chat_activity_log
  drop constraint if exists chat_activity_log_go_live_check;
alter table public.chat_activity_log
  add constraint chat_activity_log_go_live_check
  check (auto_via is distinct from 'go_live' or (class = 'execute' and agent_run_id is not null));

comment on column public.chat_activity_log.auto_via is
  'Why a change ran without a card (00402): an Admin''s Always, Full auto, the person''s "Don''t ask again", or go_live (00445): an EXECUTE an allowed agent took live on its own.';
