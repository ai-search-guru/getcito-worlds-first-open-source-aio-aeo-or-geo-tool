-- GSC-fed prompt suggestions (#648).
--
-- 1. prompt_suggestions.source_data — provenance for 'gsc'-sourced rows
--    (original query, impressions, clicks, rationale badge, competition).
-- 2. gsc_candidate_queries() — server-side aggregation of the candidate
--    mining window so the app never ships tens of thousands of daily rows
--    over the wire just to group them.
-- 3. dataforseo_competition_cache — 30-day cache for competition lookups so
--    repeat suggestion refreshes cost zero new DataForSEO calls. Service
--    role only (RLS enabled, no policies).

-- ── Recovered table definition (#709) ────────────────────────────────────────
--
-- prompt_suggestions was created directly against the hosted database and
-- never written back into a migration, so the ALTERs below had nothing to
-- alter on a clean one: `supabase db reset` failed here with 42P01, and
-- schema.sql inherited the same gap. Every documented fresh-install path was
-- broken from the moment this migration shipped.
--
-- The definition belongs *here* rather than in a later numbered file, because
-- the very next statement alters this table — a migration appended at the end
-- would never be reached. Editing a shipped migration is normally off-limits;
-- this one is safe because every clause is idempotent and any database that
-- already ran 00048 will not run it again.
--
-- Deliberately the table as it was BEFORE the ALTERs below: no source_data
-- column, and the two-value source check. Transcribing a live database's
-- current shape instead would leave a fresh install failing one line later on
-- "column source_data already exists".
CREATE TABLE IF NOT EXISTS "public"."prompt_suggestions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "brand_id" "uuid" NOT NULL,
    "suggested_text" "text" NOT NULL,
    "topic_name" "text",
    "topic_id" "uuid",
    "reason" "text",
    "est_volume" integer,
    "source" "text" DEFAULT 'llm'::"text" NOT NULL,
    "status" "text" DEFAULT 'new'::"text" NOT NULL,
    "added_prompt_id" "uuid",
    "generated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone DEFAULT ("now"() + '48:00:00'::interval) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "prompt_suggestions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "prompt_suggestions_source_check" CHECK (
        "source" = ANY (ARRAY['llm'::"text", 'heuristic'::"text"])
    ),
    CONSTRAINT "prompt_suggestions_status_check" CHECK (
        "status" = ANY (ARRAY['new'::"text", 'added'::"text", 'dismissed'::"text"])
    ),
    CONSTRAINT "prompt_suggestions_brand_id_fkey" FOREIGN KEY ("brand_id")
        REFERENCES "public"."brands"("id") ON DELETE CASCADE,
    CONSTRAINT "prompt_suggestions_topic_id_fkey" FOREIGN KEY ("topic_id")
        REFERENCES "public"."topics"("id") ON DELETE SET NULL,
    CONSTRAINT "prompt_suggestions_added_prompt_id_fkey" FOREIGN KEY ("added_prompt_id")
        REFERENCES "public"."prompts"("id") ON DELETE SET NULL
);

ALTER TABLE "public"."prompt_suggestions" OWNER TO "postgres";

CREATE INDEX IF NOT EXISTS "idx_prompt_suggestions_brand_status"
    ON "public"."prompt_suggestions" ("brand_id", "status", "generated_at" DESC);

-- One live suggestion per brand per text, case-insensitively. Partial on
-- 'new' so an accepted or dismissed suggestion never blocks a later one.
CREATE UNIQUE INDEX IF NOT EXISTS "idx_prompt_suggestions_brand_text_active"
    ON "public"."prompt_suggestions" ("brand_id", "lower"("suggested_text"))
    WHERE ("status" = 'new'::"text");

ALTER TABLE "public"."prompt_suggestions" ENABLE ROW LEVEL SECURITY;

-- Writes go through the Express server's service-role client; these cover the
-- web app's direct reads and the accept/dismiss updates it performs.
CREATE POLICY "prompt_suggestions: member select" ON "public"."prompt_suggestions"
    FOR SELECT USING (
        "brand_id" IN (
            SELECT "b"."id"
            FROM "public"."brands" "b"
            JOIN "public"."profiles" "p" ON "p"."organization_id" = "b"."organization_id"
            WHERE "p"."id" = "auth"."uid"()
        )
    );

CREATE POLICY "prompt_suggestions: admin/manager/analyst update" ON "public"."prompt_suggestions"
    FOR UPDATE USING (
        "brand_id" IN (
            SELECT "b"."id"
            FROM "public"."brands" "b"
            JOIN "public"."profiles" "p" ON "p"."organization_id" = "b"."organization_id"
            WHERE "p"."id" = "auth"."uid"()
              AND "p"."role" = ANY (ARRAY['admin'::"public"."user_role", 'manager'::"public"."user_role", 'analyst'::"public"."user_role"])
        )
    );

GRANT ALL ON TABLE "public"."prompt_suggestions" TO "anon";
GRANT ALL ON TABLE "public"."prompt_suggestions" TO "authenticated";
GRANT ALL ON TABLE "public"."prompt_suggestions" TO "service_role";

-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.prompt_suggestions ADD COLUMN source_data jsonb;

-- The live table's source check predates 'gsc' — extend it.
ALTER TABLE public.prompt_suggestions DROP CONSTRAINT prompt_suggestions_source_check;
ALTER TABLE public.prompt_suggestions ADD CONSTRAINT prompt_suggestions_source_check
    CHECK (source = ANY (ARRAY['llm'::text, 'heuristic'::text, 'gsc'::text]));

CREATE FUNCTION public.gsc_candidate_queries(
    p_brand_id uuid,
    p_since date,
    p_min_impressions integer
)
RETURNS TABLE(query text, impressions bigint, clicks bigint, avg_position double precision)
LANGUAGE sql
STABLE
AS $$
    SELECT s.query,
           sum(s.impressions) AS impressions,
           sum(s.clicks) AS clicks,
           avg(s.position) AS avg_position
    FROM public.gsc_query_stats s
    WHERE s.brand_id = p_brand_id
      AND s.date >= p_since
    GROUP BY s.query
    HAVING sum(s.impressions) >= p_min_impressions
    ORDER BY sum(s.impressions) DESC
    LIMIT 200;
$$;

CREATE TABLE public.dataforseo_competition_cache (
    keyword text NOT NULL,
    location_code integer NOT NULL DEFAULT 0,
    language_code text NOT NULL DEFAULT '',
    competition_index integer,
    competition text,
    fetched_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (keyword, location_code, language_code)
);

ALTER TABLE public.dataforseo_competition_cache ENABLE ROW LEVEL SECURITY;
