DROP INDEX IF EXISTS "citations_brand_id_created_at_idx";--> statement-breakpoint
ALTER TABLE "citations" ALTER COLUMN "citation_index" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "prompt_runs" ALTER COLUMN "brand_id" SET NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_citations_brand_analytics" ON "citations" USING btree ("brand_id","created_at","url","domain","title","prompt_id","modelGroup");