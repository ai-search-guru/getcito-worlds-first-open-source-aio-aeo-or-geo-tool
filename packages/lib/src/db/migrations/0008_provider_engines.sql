-- Migration: Multi-provider scraping support
--
-- Renames the model_group concept to "model" (the AI product being tracked),
-- renames the model column to "version" (specific model version),
-- and adds a "provider" column (how the model was reached).
--
-- NOTE: The original Drizzle schema used camelCase column names (modelGroup, not model_group).

-- Fail fast rather than queue behind a long-running query / worker insert.
SET lock_timeout = '5s';
SET statement_timeout = '15min';

-- Step 1: prompt_runs — rename old model column to version (metadata-only, instant)
ALTER TABLE "prompt_runs" RENAME COLUMN "model" TO "version";

-- Step 2: Combine enum→text conversion with value remap in a SINGLE table rewrite
-- (saves a second full-table UPDATE pass).
ALTER TABLE "prompt_runs" ALTER COLUMN "modelGroup" TYPE text USING (
  CASE "modelGroup"::text
    WHEN 'openai' THEN 'chatgpt'
    WHEN 'anthropic' THEN 'claude'
    WHEN 'google' THEN 'google-ai-mode'
    ELSE "modelGroup"::text
  END
);
ALTER TABLE "prompt_runs" RENAME COLUMN "modelGroup" TO "model";

-- Step 3: Add provider column. No default → metadata-only in PG11+, instant.
ALTER TABLE "prompt_runs" ADD COLUMN "provider" text;

-- Step 4: citations — same combined type + value remap in one rewrite.
ALTER TABLE "citations" ALTER COLUMN "modelGroup" TYPE text USING (
  CASE "modelGroup"::text
    WHEN 'openai' THEN 'chatgpt'
    WHEN 'anthropic' THEN 'claude'
    WHEN 'google' THEN 'google-ai-mode'
    ELSE "modelGroup"::text
  END
);
ALTER TABLE "citations" RENAME COLUMN "modelGroup" TO "model";

-- Step 5: Drop the now-unused enum type
DROP TYPE IF EXISTS "model_groups";

-- Step 6: Backfill provider for existing rows (one UPDATE pass — provider
-- references the new model values so this can't be folded into the ALTER TYPE).
UPDATE "prompt_runs" SET "provider" = CASE
  WHEN "model" IN ('chatgpt', 'claude') THEN 'direct'
  WHEN "model" = 'google-ai-mode' THEN 'dataforseo'
  ELSE NULL
END;

-- Step 7: Add enabled_models column to brands for per-brand model filtering
ALTER TABLE "brands" ADD COLUMN "enabled_models" text[];

-- Step 8: Create indexes (non-concurrent — holds AccessExclusiveLock during build).
CREATE INDEX IF NOT EXISTS "prompt_runs_provider_idx" ON "prompt_runs" ("provider");
CREATE INDEX IF NOT EXISTS "prompt_runs_model_created_at_idx" ON "prompt_runs" ("model", "created_at");

-- Step 9: Refresh planner stats for the rewritten tables.
ANALYZE "prompt_runs";
ANALYZE "citations";
