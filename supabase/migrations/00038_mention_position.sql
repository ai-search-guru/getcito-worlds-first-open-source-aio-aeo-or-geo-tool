-- Track where the brand lands in each answer's mention order.
--
--   mention_position        1-based rank of the brand's first mention among
--                           the brand + tracked competitors named in the
--                           answer (1 = named first); NULL when the brand
--                           isn't mentioned in the answer.
--   mentioned_entity_count  how many tracked entities the answer names.
--                           0 = computed, nothing found; NULL = not
--                           computed yet (rows from before this migration —
--                           the backfill script keys off this).
--
-- Computed deterministically at parse time (responseParser.js) — no LLM.
-- Not surfaced anywhere yet: the signal accumulates first so any future
-- position-aware scoring can be calibrated against real distributions.

ALTER TABLE "public"."prompt_results"
    ADD COLUMN IF NOT EXISTS "mention_position" integer,
    ADD COLUMN IF NOT EXISTS "mentioned_entity_count" integer;
