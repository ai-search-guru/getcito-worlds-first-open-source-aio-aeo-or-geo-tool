CREATE TABLE "citations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prompt_run_id" uuid NOT NULL,
	"prompt_id" uuid NOT NULL,
	"brand_id" text NOT NULL,
	"modelGroup" "model_groups" NOT NULL,
	"url" text NOT NULL,
	"domain" text NOT NULL,
	"title" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "citations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "prompt_runs" ADD COLUMN "brand_id" text;--> statement-breakpoint
ALTER TABLE "citations" ADD CONSTRAINT "citations_prompt_run_id_prompt_runs_id_fk" FOREIGN KEY ("prompt_run_id") REFERENCES "public"."prompt_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "citations" ADD CONSTRAINT "citations_prompt_id_prompts_id_fk" FOREIGN KEY ("prompt_id") REFERENCES "public"."prompts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "citations" ADD CONSTRAINT "citations_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "citations_brand_id_created_at_idx" ON "citations" USING btree ("brand_id","created_at");--> statement-breakpoint
CREATE INDEX "citations_prompt_id_created_at_idx" ON "citations" USING btree ("prompt_id","created_at");--> statement-breakpoint
CREATE INDEX "citations_domain_idx" ON "citations" USING btree ("domain");--> statement-breakpoint
ALTER TABLE "prompt_runs" ADD CONSTRAINT "prompt_runs_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;