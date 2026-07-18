CREATE TABLE "brand_opportunities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" text NOT NULL,
	"report" json NOT NULL,
	"model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "brand_opportunities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "brand_opportunities" ADD CONSTRAINT "brand_opportunities_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "brand_opportunities_brand_id_created_at_idx" ON "brand_opportunities" USING btree ("brand_id","created_at");