-- Capture Perplexity shopping cards alongside text + citations so the
-- commerce-intent signal isn't lost. Other AI providers leave this empty;
-- only Perplexity populates it today. Mirrors the citations /
-- competitor_mentions columns on the same table (jsonb NOT NULL DEFAULT '[]').

ALTER TABLE "public"."prompt_results"
  ADD COLUMN IF NOT EXISTS "shopping_cards" jsonb
    NOT NULL DEFAULT '[]'::jsonb;
