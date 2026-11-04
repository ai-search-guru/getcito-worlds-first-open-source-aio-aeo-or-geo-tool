-- Content brief generation quota tracking.
-- Mirrors the volume_usage pattern: one row per generated brief, counted
-- per organization per calendar month against plan.limits.maxBriefGenerations
-- (Starter 10, Growth 50, Enterprise via organizations.plan_overrides).
-- Self-hosted instances bypass quota entirely (IS_CLOUD !== "true").

CREATE TABLE IF NOT EXISTS "public"."brief_usage" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "opportunity_id" "uuid",
    "used_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);

ALTER TABLE "public"."brief_usage" OWNER TO "postgres";

ALTER TABLE ONLY "public"."brief_usage"
    ADD CONSTRAINT "brief_usage_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."brief_usage"
    ADD CONSTRAINT "brief_usage_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."brief_usage"
    ADD CONSTRAINT "brief_usage_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "public"."content_opportunities"("id") ON DELETE SET NULL;

CREATE INDEX "idx_brief_usage_org_month" ON "public"."brief_usage" USING "btree" ("organization_id", "used_at");

-- RLS enabled with no policies: only the service role (aeo-server) writes
-- and reads usage rows — same posture as volume_usage.
ALTER TABLE "public"."brief_usage" ENABLE ROW LEVEL SECURITY;

GRANT ALL ON TABLE "public"."brief_usage" TO "anon";
GRANT ALL ON TABLE "public"."brief_usage" TO "authenticated";
GRANT ALL ON TABLE "public"."brief_usage" TO "service_role";
