-- Capture DataForSEO competition data alongside search volume so the prompts
-- table can show a difficulty meter without an extra API call. This is Google
-- Ads paid-bid competition (a proxy for topic difficulty), pulled from the same
-- search_volume response we already fetch. No RLS changes: prompt_volumes
-- inherits the existing brand-scoped policies.

ALTER TABLE "public"."prompt_volumes"
  ADD COLUMN IF NOT EXISTS "competition_index" integer,
  ADD COLUMN IF NOT EXISTS "competition" text
    CHECK ("competition" IS NULL OR "competition" IN ('LOW', 'MEDIUM', 'HIGH'));
