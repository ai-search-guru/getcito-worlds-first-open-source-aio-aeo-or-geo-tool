-- Multi-domain support + aliases for competitors and brands

-- Competitors: domain -> domains array + aliases
ALTER TABLE "competitors" ADD COLUMN "domains" text[] NOT NULL DEFAULT '{}';--> statement-breakpoint
UPDATE "competitors" SET "domains" = ARRAY["domain"] WHERE "domain" IS NOT NULL AND "domain" != '';--> statement-breakpoint
ALTER TABLE "competitors" DROP COLUMN "domain";--> statement-breakpoint
ALTER TABLE "competitors" ADD COLUMN "aliases" text[] NOT NULL DEFAULT '{}';--> statement-breakpoint

-- Brands: additional_domains + aliases
ALTER TABLE "brands" ADD COLUMN "additional_domains" text[] NOT NULL DEFAULT '{}';--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "aliases" text[] NOT NULL DEFAULT '{}';
