-- 00036_daily_pulse.sql
-- Daily Pulse (#540): per-brand daily digest sent after the tracking run.
--
-- pulse_settings — per-brand delivery preferences (frequency + recipients).
-- sent_pulses    — send log: dedup ("already sent today"), the content
--                  snapshot that went out, and the warning keys used for the
--                  7-day warning cooldown.
--
-- All writes go through the Express server's service-role client; RLS below
-- covers the web app's direct reads plus settings writes by admin/manager.

CREATE TABLE IF NOT EXISTS "public"."pulse_settings" (
    "brand_id" "uuid" NOT NULL,
    "frequency" "text" DEFAULT 'daily'::"text" NOT NULL,
    "recipients" "text"[],
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "pulse_settings_pkey" PRIMARY KEY ("brand_id"),
    CONSTRAINT "pulse_settings_frequency_check" CHECK (
        "frequency" = ANY (ARRAY['daily'::"text", 'weekly'::"text", 'notable'::"text", 'off'::"text"])
    ),
    CONSTRAINT "pulse_settings_brand_id_fkey" FOREIGN KEY ("brand_id")
        REFERENCES "public"."brands"("id") ON DELETE CASCADE
);

ALTER TABLE "public"."pulse_settings" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."sent_pulses" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "brand_id" "uuid" NOT NULL,
    "pulse_date" "date" NOT NULL,
    "frequency" "text" NOT NULL,
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "warning_keys" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "email_sent" boolean DEFAULT false NOT NULL,
    "email_recipient_count" integer DEFAULT 0 NOT NULL,
    "webhook_sent" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "sent_pulses_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sent_pulses_brand_id_fkey" FOREIGN KEY ("brand_id")
        REFERENCES "public"."brands"("id") ON DELETE CASCADE,
    CONSTRAINT "sent_pulses_brand_date_key" UNIQUE ("brand_id", "pulse_date")
);

ALTER TABLE "public"."sent_pulses" OWNER TO "postgres";

CREATE INDEX IF NOT EXISTS "idx_sent_pulses_brand_created"
    ON "public"."sent_pulses" ("brand_id", "created_at" DESC);

ALTER TABLE "public"."pulse_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."sent_pulses" ENABLE ROW LEVEL SECURITY;

-- Same policy shape as topic_suggestions: every org member can read;
-- admin/manager can change delivery preferences from Settings.
CREATE POLICY "pulse_settings: member select" ON "public"."pulse_settings"
    FOR SELECT USING (
        "brand_id" IN (
            SELECT "b"."id"
            FROM "public"."brands" "b"
            JOIN "public"."profiles" "p" ON "p"."organization_id" = "b"."organization_id"
            WHERE "p"."id" = "auth"."uid"()
        )
    );

CREATE POLICY "pulse_settings: admin/manager insert" ON "public"."pulse_settings"
    FOR INSERT WITH CHECK (
        "brand_id" IN (
            SELECT "b"."id"
            FROM "public"."brands" "b"
            JOIN "public"."profiles" "p" ON "p"."organization_id" = "b"."organization_id"
            WHERE "p"."id" = "auth"."uid"()
              AND "p"."role" = ANY (ARRAY['admin'::"public"."user_role", 'manager'::"public"."user_role"])
        )
    );

CREATE POLICY "pulse_settings: admin/manager update" ON "public"."pulse_settings"
    FOR UPDATE USING (
        "brand_id" IN (
            SELECT "b"."id"
            FROM "public"."brands" "b"
            JOIN "public"."profiles" "p" ON "p"."organization_id" = "b"."organization_id"
            WHERE "p"."id" = "auth"."uid"()
              AND "p"."role" = ANY (ARRAY['admin'::"public"."user_role", 'manager'::"public"."user_role"])
        )
    );

CREATE POLICY "sent_pulses: member select" ON "public"."sent_pulses"
    FOR SELECT USING (
        "brand_id" IN (
            SELECT "b"."id"
            FROM "public"."brands" "b"
            JOIN "public"."profiles" "p" ON "p"."organization_id" = "b"."organization_id"
            WHERE "p"."id" = "auth"."uid"()
        )
    );

GRANT ALL ON TABLE "public"."pulse_settings" TO "anon";
GRANT ALL ON TABLE "public"."pulse_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."pulse_settings" TO "service_role";

GRANT ALL ON TABLE "public"."sent_pulses" TO "anon";
GRANT ALL ON TABLE "public"."sent_pulses" TO "authenticated";
GRANT ALL ON TABLE "public"."sent_pulses" TO "service_role";
