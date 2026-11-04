-- Site Audit quota tracking. One row per completed audit, counted per
-- organization per calendar month against plan.limits.maxSiteAudits
-- (Starter 100, Growth 500, Enterprise/Self-hosted unlimited). Mirrors the
-- brief_usage pattern. Self-hosted instances bypass quota (IS_CLOUD !== "true").

CREATE TABLE IF NOT EXISTS "public"."site_audit_usage" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "audit_id" "uuid",
    "used_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);

ALTER TABLE ONLY "public"."site_audit_usage"
    ADD CONSTRAINT "site_audit_usage_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."site_audit_usage"
    ADD CONSTRAINT "site_audit_usage_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."site_audit_usage"
    ADD CONSTRAINT "site_audit_usage_audit_id_fkey" FOREIGN KEY ("audit_id") REFERENCES "public"."site_audits"("id") ON DELETE SET NULL;

CREATE INDEX "idx_site_audit_usage_org_month" ON "public"."site_audit_usage" USING "btree" ("organization_id", "used_at");

-- RLS enabled with no policies: only the service role (aeo-server) reads/writes
-- usage rows — same posture as brief_usage / volume_usage.
ALTER TABLE "public"."site_audit_usage" ENABLE ROW LEVEL SECURITY;

GRANT ALL ON TABLE "public"."site_audit_usage" TO "anon";
GRANT ALL ON TABLE "public"."site_audit_usage" TO "authenticated";
GRANT ALL ON TABLE "public"."site_audit_usage" TO "service_role";
