-- 00032_target_url_cited_stats.sql
-- v2 of the prompt workflow (00031): closed-loop citation tracking for
-- target URLs. Stats are denormalized onto the row so list surfaces read
-- them without scanning result citations: the tracking pipeline updates
-- them as new results arrive, and the web action backfills once when a URL
-- is added.

ALTER TABLE "public"."prompt_target_urls"
  ADD COLUMN IF NOT EXISTS "cited_count" integer DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS "first_cited_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "last_cited_at" timestamp with time zone;
