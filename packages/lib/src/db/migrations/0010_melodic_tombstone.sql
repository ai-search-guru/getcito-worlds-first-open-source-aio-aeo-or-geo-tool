ALTER TABLE "brands" ADD COLUMN "target_market" text;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "target_language" text;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "short_description" text;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "products_and_services" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "keywords" text[] DEFAULT '{}' NOT NULL;