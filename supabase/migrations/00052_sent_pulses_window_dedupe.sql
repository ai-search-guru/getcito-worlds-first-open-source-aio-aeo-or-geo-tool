-- One Daily Pulse per brand per tracking window (#701).
--
-- sent_pulses already has a unique (brand_id, pulse_date) key, but the daily
-- KPI window is anchored to the tracking-run ledger rather than to the
-- calendar: two pulses filed under different dates repeat each other verbatim
-- whenever the anchor has not moved between them. That is how the catch-up
-- sweep's recovery mail and the brand's own end-of-run mail went out an hour
-- apart with identical numbers, and how a brand whose runs stopped stamping
-- received the same figures again on each following day.
--
-- The engine checks for a matching window before it computes, so this index is
-- the race guard rather than the primary mechanism — same role the date key
-- plays for same-day double-fires.
--
-- Partial on the extracted path so rows written before this migration — which
-- carry no payload->window at all — are excluded instead of colliding on NULL.
-- Weekly digests and brands with no completed run are indexed but can never
-- conflict: their window ends at the wall clock, which differs on every call.
CREATE UNIQUE INDEX IF NOT EXISTS sent_pulses_brand_window_key
    ON public.sent_pulses (brand_id, ((payload -> 'window' ->> 'to')))
    WHERE (payload -> 'window' ->> 'to') IS NOT NULL;
