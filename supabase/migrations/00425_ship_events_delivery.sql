-- ============================================================================
-- 00425: one ship event per CMS send, and a page published again
-- ============================================================================
-- The impact ledger (00421, CHAT-22 §2) writes a ship event when a CMS
-- confirms a sent page live (Send to CMS #1331). A callback or a status poll
-- can confirm the same send more than once, and two servers can confirm it at
-- the same moment: each would be a second shipped change on the same
-- prompts, and two measurements on the same targets make each other Not
-- measurable (overlapping_change).
--
--   * content_draft_delivery_id: the send (content_draft_deliveries) a ship
--     event is the publish of; null for every other kind of ship event. One
--     ship event per send: the server writes it with an upsert that ignores
--     a second (on conflict do nothing). A plain unique index rather than a
--     partial one: PostgREST's on_conflict names columns only, and Postgres
--     can't infer a partial index without its predicate. Nulls stay
--     distinct, so ship events without a send are never in each other's way.
--   * republished_at: the last time the same draft went live again within
--     90 days of this ship event (a post updated in place, sent again). No
--     second ship event is written then: the first measurement goes on, and
--     the ledger can say the page was published again.

alter table public.ship_events
  add column if not exists content_draft_delivery_id uuid
    references public.content_draft_deliveries(id) on delete set null,
  add column if not exists republished_at timestamptz;

create unique index if not exists ship_events_content_draft_delivery_uidx
  on public.ship_events (content_draft_delivery_id);

comment on column public.ship_events.content_draft_delivery_id is
  'The CMS send (content_draft_deliveries) this ship event is the confirmed publish of: one ship event per send (00425). Null for other kinds.';
comment on column public.ship_events.republished_at is
  'The last time the same draft went live again within 90 days of this ship event: no second ship event is written, the first measurement goes on (00425).';

notify pgrst, 'reload schema';
