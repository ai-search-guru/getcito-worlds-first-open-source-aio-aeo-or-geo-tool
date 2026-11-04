-- ============================================================================
-- 00460: Take down a published page (AUTONOMOUS-GO-LIVE PR 10)
-- ============================================================================
-- A person takes a page GetCito published in Webflow, WordPress or Wix back
-- down to a draft there, from the Inbox notice, Chat's Activity, the Content
-- Library or Chat's unpublish_cms (always a person's click). The send that
-- published it keeps the record:
--
--   * content_draft_deliveries.status takes 'taken_down'. A taken-down send
--     is neither 'sent' nor 'published', so the CMS status sweeps never read
--     it again (Webflow's would mark it published again from its old
--     lastPublished), and the impact ledger's nightly fill never ships it
--     again.
--   * taken_down_at and taken_down_by: when, and who. A page someone took
--     down never goes live on its own again: an agent's next go-live of that
--     draft waits for a click (held `taken_down`).
--
-- The rest is written by the server with the take down, not here: the page's
-- address cleared (content_drafts back to 'ready'), the agent's go-live event
-- 'taken_down' (00443's status and columns), and the ship event's measurement
-- Not measurable with reason 'taken_down' (00421's reason is free text).

alter table public.content_draft_deliveries
  drop constraint if exists content_draft_deliveries_status_check,
  add constraint content_draft_deliveries_status_check
    check (status in ('queued', 'sent', 'failed', 'published', 'taken_down'));

alter table public.content_draft_deliveries
  add column if not exists taken_down_at timestamptz,
  add column if not exists taken_down_by uuid references public.profiles(id) on delete set null;

alter table public.content_draft_deliveries
  drop constraint if exists content_draft_deliveries_taken_down,
  add constraint content_draft_deliveries_taken_down
    check ((status = 'taken_down') = (taken_down_at is not null));

comment on column public.content_draft_deliveries.taken_down_at is
  'When a person took the published page down to a draft in its CMS (00460); set exactly when status is taken_down.';
comment on column public.content_draft_deliveries.taken_down_by is
  'Who took the page down (00460).';

notify pgrst, 'reload schema';
