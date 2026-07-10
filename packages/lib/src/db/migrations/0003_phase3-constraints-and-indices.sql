ALTER TABLE "prompt_runs" ALTER COLUMN "brand_id" SET NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_prompt_runs_brand_analytics"
  ON "prompt_runs" ("brand_id", "created_at")
  INCLUDE ("prompt_id", "brand_mentioned", "modelGroup", "web_search_enabled", "competitors_mentioned");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_prompt_runs_prompt_analytics"
  ON "prompt_runs" ("prompt_id", "created_at")
  INCLUDE ("brand_mentioned", "modelGroup", "web_search_enabled", "competitors_mentioned", "brand_id", "web_queries");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_prompt_runs_admin"
  ON "prompt_runs" ("created_at")
  INCLUDE ("brand_id");
