-- 00030_topic_suggestions.sql
-- Persisted AI topic suggestions for the Topics page (#463).
--
-- Mirrors prompt_suggestions: rows are generated only on explicit user
-- action (never on page load), survive reloads, and dismissed suggestions
-- never reappear. All writes go through the Express server's service-role
-- client; RLS below covers the web app's direct reads.

CREATE TABLE IF NOT EXISTS "public"."topic_suggestions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "brand_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "reason" "text",
    "source" "text" DEFAULT 'llm'::"text" NOT NULL,
    "status" "text" DEFAULT 'new'::"text" NOT NULL,
    "added_topic_id" "uuid",
    "generated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "topic_suggestions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "topic_suggestions_status_check" CHECK (
        "status" = ANY (ARRAY['new'::"text", 'added'::"text", 'dismissed'::"text"])
    ),
    CONSTRAINT "topic_suggestions_brand_id_fkey" FOREIGN KEY ("brand_id")
        REFERENCES "public"."brands"("id") ON DELETE CASCADE,
    CONSTRAINT "topic_suggestions_added_topic_id_fkey" FOREIGN KEY ("added_topic_id")
        REFERENCES "public"."topics"("id") ON DELETE SET NULL
);

ALTER TABLE "public"."topic_suggestions" OWNER TO "postgres";

CREATE INDEX IF NOT EXISTS "idx_topic_suggestions_brand_status"
    ON "public"."topic_suggestions" ("brand_id", "status");

ALTER TABLE "public"."topic_suggestions" ENABLE ROW LEVEL SECURITY;

-- Same policy shape as prompt_suggestions: every org member can read,
-- admin/manager/analyst can update (dismiss/accept acks happen server-side,
-- but the web app reads rows directly when accepting).
CREATE POLICY "topic_suggestions: member select" ON "public"."topic_suggestions"
    FOR SELECT USING (
        "brand_id" IN (
            SELECT "b"."id"
            FROM "public"."brands" "b"
            JOIN "public"."profiles" "p" ON "p"."organization_id" = "b"."organization_id"
            WHERE "p"."id" = "auth"."uid"()
        )
    );

CREATE POLICY "topic_suggestions: admin/manager/analyst update" ON "public"."topic_suggestions"
    FOR UPDATE USING (
        "brand_id" IN (
            SELECT "b"."id"
            FROM "public"."brands" "b"
            JOIN "public"."profiles" "p" ON "p"."organization_id" = "b"."organization_id"
            WHERE "p"."id" = "auth"."uid"()
              AND "p"."role" = ANY (ARRAY['admin'::"public"."user_role", 'manager'::"public"."user_role", 'analyst'::"public"."user_role"])
        )
    );

GRANT ALL ON TABLE "public"."topic_suggestions" TO "anon";
GRANT ALL ON TABLE "public"."topic_suggestions" TO "authenticated";
GRANT ALL ON TABLE "public"."topic_suggestions" TO "service_role";
