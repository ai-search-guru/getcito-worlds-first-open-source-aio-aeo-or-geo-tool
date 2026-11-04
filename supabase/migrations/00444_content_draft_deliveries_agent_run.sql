-- ============================================================================
-- 00444: a CMS send an agent made on its own
-- ============================================================================
-- AUTONOMOUS-GO-LIVE §10.2 (PR 4). A send an agent run made without a
-- person's click (its go-live step, chat_agent_go_live_events) names the
-- agent run, so the Library and the ship event can say "Sent by {agent} · on
-- its own". sent_by stays the person the run acted as. A person's own send
-- has none.

alter table public.content_draft_deliveries
  add column if not exists agent_run_id uuid
    references public.chat_agent_runs(id) on delete set null;

create index if not exists content_draft_deliveries_agent_run_idx
  on public.content_draft_deliveries (agent_run_id)
  where agent_run_id is not null;

comment on column public.content_draft_deliveries.agent_run_id is
  'The agent run that sent the page on its own (00444); null for a person''s send.';
