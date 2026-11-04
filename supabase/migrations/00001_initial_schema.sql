


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';


CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";


CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";


CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";


CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";


CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";


CREATE TYPE "public"."user_role" AS ENUM (
    'admin',
    'manager',
    'analyst',
    'agency_partner'
);


ALTER TYPE "public"."user_role" OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."prompt_results" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "prompt_id" "uuid" NOT NULL,
    "brand_id" "uuid" NOT NULL,
    "platform" "text" NOT NULL,
    "response" "text" DEFAULT ''::"text" NOT NULL,
    "citations" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "mention_count" integer DEFAULT 0 NOT NULL,
    "citation_count" integer DEFAULT 0 NOT NULL,
    "sentiment" "text" DEFAULT 'neutral'::"text" NOT NULL,
    "visibility_score" numeric DEFAULT 0 NOT NULL,
    "model_used" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "region" "text",
    "competitor_mentions" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL
);


ALTER TABLE "public"."prompt_results" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_latest_prompt_results"("p_brand_id" "uuid", "p_platform" "text" DEFAULT NULL::"text") RETURNS SETOF "public"."prompt_results"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  SELECT DISTINCT ON (pr.prompt_id, pr.platform) pr.*
  FROM public.prompt_results pr
  WHERE pr.brand_id = p_brand_id
    AND (p_platform IS NULL OR pr.platform = p_platform)
  ORDER BY pr.prompt_id, pr.platform, pr.created_at DESC;
$$;


ALTER FUNCTION "public"."get_latest_prompt_results"("p_brand_id" "uuid", "p_platform" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_latest_prompt_results"("p_brand_id" "uuid", "p_platform" "text" DEFAULT NULL::"text", "p_model" "text" DEFAULT NULL::"text", "p_region" "text" DEFAULT NULL::"text", "p_date_from" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_date_to" timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS SETOF "public"."prompt_results"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  SELECT DISTINCT ON (pr.prompt_id, pr.platform, pr.model_used, pr.region) pr.*
  FROM public.prompt_results pr
  WHERE pr.brand_id = p_brand_id
    AND (p_platform IS NULL OR pr.platform = p_platform)
    AND (p_model IS NULL OR pr.model_used = p_model)
    AND (p_region IS NULL OR pr.region = p_region)
    AND (p_date_from IS NULL OR pr.created_at >= p_date_from)
    AND (p_date_to IS NULL OR pr.created_at <= p_date_to)
  ORDER BY pr.prompt_id, pr.platform, pr.model_used, pr.region, pr.created_at DESC;
$$;


ALTER FUNCTION "public"."get_latest_prompt_results"("p_brand_id" "uuid", "p_platform" "text", "p_model" "text", "p_region" "text", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (
    new.id,
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'avatar_url'
  );
  return new;
end;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."handle_updated_at"() OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ai_traffic_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "brand_id" "uuid" NOT NULL,
    "url" "text" NOT NULL,
    "referrer" "text",
    "source_platform" "text",
    "user_agent" "text",
    "ip_address" "text",
    "country" "text",
    "language" "text",
    "screen" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."ai_traffic_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."brand_domains" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "brand_id" "uuid" NOT NULL,
    "domain" "text" NOT NULL,
    "country" "text",
    "is_primary" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."brand_domains" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."brand_platforms" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "brand_id" "uuid" NOT NULL,
    "platform" "text" NOT NULL,
    "is_enabled" boolean DEFAULT true NOT NULL,
    "check_frequency" "text" DEFAULT 'daily'::"text" NOT NULL,
    "last_checked_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "api_model" "text"
);


ALTER TABLE "public"."brand_platforms" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."brands" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "logo_url" "text",
    "industry" "text",
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "tracking_code" "text" DEFAULT "encode"("extensions"."gen_random_bytes"(16), 'hex'::"text") NOT NULL,
    "region" "text" DEFAULT 'US'::"text",
    "language" "text" DEFAULT 'en'::"text"
);


ALTER TABLE "public"."brands" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."competitors" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "brand_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "domain" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."competitors" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."content_opportunities" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "brand_id" "uuid" NOT NULL,
    "prompt_id" "uuid",
    "title" "text" NOT NULL,
    "description" "text",
    "type" "text" DEFAULT 'owned'::"text" NOT NULL,
    "impact" "text" DEFAULT 'medium'::"text" NOT NULL,
    "opportunity_score" numeric(5,2) DEFAULT 0,
    "status" "text" DEFAULT 'new'::"text" NOT NULL,
    "source_data" "jsonb" DEFAULT '{}'::"jsonb",
    "webhook_sent_at" timestamp with time zone,
    "webhook_response" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "brief" "jsonb"
);


ALTER TABLE "public"."content_opportunities" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."jobs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "type" "text" NOT NULL,
    "brand_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'waiting'::"text" NOT NULL,
    "data" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "progress" "jsonb",
    "result" "jsonb",
    "failed_reason" "text",
    "attempts" integer DEFAULT 0 NOT NULL,
    "max_attempts" integer DEFAULT 3 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "started_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    CONSTRAINT "jobs_status_check" CHECK (("status" = ANY (ARRAY['waiting'::"text", 'active'::"text", 'completed'::"text", 'failed'::"text", 'cancelled'::"text"]))),
    CONSTRAINT "jobs_type_check" CHECK (("type" = ANY (ARRAY['tracking'::"text", 'content'::"text"])))
);


ALTER TABLE "public"."jobs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."organizations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "plan" "text" DEFAULT 'free'::"text" NOT NULL,
    "subscription_status" "text" DEFAULT 'incomplete'::"text" NOT NULL,
    "stripe_customer_id" "text",
    "subscription_ends_at" timestamp with time zone,
    "stripe_subscription_id" "text",
    "plan_overrides" "jsonb"
);


ALTER TABLE "public"."organizations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "full_name" "text",
    "avatar_url" "text",
    "role" "public"."user_role" DEFAULT 'admin'::"public"."user_role" NOT NULL,
    "organization_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "onboarding_completed" boolean DEFAULT false
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."prompt_sets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "brand_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."prompt_sets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."prompt_volumes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "prompt_id" "uuid" NOT NULL,
    "intent" "text" NOT NULL,
    "keywords" "jsonb" NOT NULL,
    "google_volumes" "jsonb" NOT NULL,
    "total_google_volume" integer NOT NULL,
    "ai_volume_multiplier" numeric(4,3) NOT NULL,
    "est_ai_volume" integer NOT NULL,
    "location_code" integer,
    "language_code" "text",
    "fetched_at" timestamp with time zone DEFAULT "now"(),
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."prompt_volumes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."prompts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "prompt_set_id" "uuid" NOT NULL,
    "text" "text" NOT NULL,
    "category" "text",
    "platforms" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "regions" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "models" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "topic_id" "uuid"
);


ALTER TABLE "public"."prompts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."topics" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "brand_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."topics" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."volume_usage" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "used_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "action" "text" NOT NULL,
    "prompt_count" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."volume_usage" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."webhook_configs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "brand_id" "uuid" NOT NULL,
    "name" "text" DEFAULT 'Default'::"text" NOT NULL,
    "webhook_url" "text" NOT NULL,
    "webhook_secret" "text",
    "events" "text"[] DEFAULT '{opportunity.sent}'::"text"[],
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."webhook_configs" OWNER TO "postgres";


ALTER TABLE ONLY "public"."ai_traffic_logs"
    ADD CONSTRAINT "ai_traffic_logs_pkey" PRIMARY KEY ("id");


ALTER TABLE ONLY "public"."brand_domains"
    ADD CONSTRAINT "brand_domains_pkey" PRIMARY KEY ("id");


ALTER TABLE ONLY "public"."brand_platforms"
    ADD CONSTRAINT "brand_platforms_brand_id_platform_key" UNIQUE ("brand_id", "platform");


ALTER TABLE ONLY "public"."brand_platforms"
    ADD CONSTRAINT "brand_platforms_pkey" PRIMARY KEY ("id");


ALTER TABLE ONLY "public"."brands"
    ADD CONSTRAINT "brands_organization_id_slug_key" UNIQUE ("organization_id", "slug");


ALTER TABLE ONLY "public"."brands"
    ADD CONSTRAINT "brands_pkey" PRIMARY KEY ("id");


ALTER TABLE ONLY "public"."brands"
    ADD CONSTRAINT "brands_tracking_code_key" UNIQUE ("tracking_code");


ALTER TABLE ONLY "public"."competitors"
    ADD CONSTRAINT "competitors_pkey" PRIMARY KEY ("id");


ALTER TABLE ONLY "public"."content_opportunities"
    ADD CONSTRAINT "content_opportunities_pkey" PRIMARY KEY ("id");


ALTER TABLE ONLY "public"."jobs"
    ADD CONSTRAINT "jobs_pkey" PRIMARY KEY ("id");


ALTER TABLE ONLY "public"."organizations"
    ADD CONSTRAINT "organizations_pkey" PRIMARY KEY ("id");


ALTER TABLE ONLY "public"."organizations"
    ADD CONSTRAINT "organizations_slug_key" UNIQUE ("slug");


ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");


ALTER TABLE ONLY "public"."prompt_results"
    ADD CONSTRAINT "prompt_results_pkey" PRIMARY KEY ("id");


ALTER TABLE ONLY "public"."prompt_sets"
    ADD CONSTRAINT "prompt_sets_pkey" PRIMARY KEY ("id");


ALTER TABLE ONLY "public"."prompt_volumes"
    ADD CONSTRAINT "prompt_volumes_pkey" PRIMARY KEY ("id");


ALTER TABLE ONLY "public"."prompts"
    ADD CONSTRAINT "prompts_pkey" PRIMARY KEY ("id");


ALTER TABLE ONLY "public"."topics"
    ADD CONSTRAINT "topics_pkey" PRIMARY KEY ("id");


ALTER TABLE ONLY "public"."prompt_volumes"
    ADD CONSTRAINT "uq_prompt_volumes_prompt_id" UNIQUE ("prompt_id");


ALTER TABLE ONLY "public"."volume_usage"
    ADD CONSTRAINT "volume_usage_pkey" PRIMARY KEY ("id");


ALTER TABLE ONLY "public"."webhook_configs"
    ADD CONSTRAINT "webhook_configs_brand_id_name_key" UNIQUE ("brand_id", "name");


ALTER TABLE ONLY "public"."webhook_configs"
    ADD CONSTRAINT "webhook_configs_pkey" PRIMARY KEY ("id");


CREATE INDEX "idx_ai_traffic_logs_brand_created" ON "public"."ai_traffic_logs" USING "btree" ("brand_id", "created_at" DESC);


CREATE INDEX "idx_ai_traffic_logs_brand_id" ON "public"."ai_traffic_logs" USING "btree" ("brand_id");


CREATE INDEX "idx_ai_traffic_logs_created_at" ON "public"."ai_traffic_logs" USING "btree" ("created_at" DESC);


CREATE INDEX "idx_ai_traffic_logs_source_platform" ON "public"."ai_traffic_logs" USING "btree" ("source_platform");


CREATE INDEX "idx_brand_domains_brand_id" ON "public"."brand_domains" USING "btree" ("brand_id");


CREATE INDEX "idx_brand_platforms_brand_id" ON "public"."brand_platforms" USING "btree" ("brand_id");


CREATE INDEX "idx_brands_organization_id" ON "public"."brands" USING "btree" ("organization_id");


CREATE INDEX "idx_brands_tracking_code" ON "public"."brands" USING "btree" ("tracking_code");


CREATE INDEX "idx_co_brand_id" ON "public"."content_opportunities" USING "btree" ("brand_id");


CREATE INDEX "idx_co_score" ON "public"."content_opportunities" USING "btree" ("opportunity_score" DESC);


CREATE INDEX "idx_co_status" ON "public"."content_opportunities" USING "btree" ("status");


CREATE INDEX "idx_competitors_brand_id" ON "public"."competitors" USING "btree" ("brand_id");


CREATE INDEX "idx_jobs_brand_id" ON "public"."jobs" USING "btree" ("brand_id");


CREATE INDEX "idx_jobs_status" ON "public"."jobs" USING "btree" ("status");


CREATE INDEX "idx_jobs_type_status" ON "public"."jobs" USING "btree" ("type", "status");


CREATE INDEX "idx_profiles_organization_id" ON "public"."profiles" USING "btree" ("organization_id");


CREATE INDEX "idx_prompt_results_brand_id" ON "public"."prompt_results" USING "btree" ("brand_id");


CREATE INDEX "idx_prompt_results_created_at" ON "public"."prompt_results" USING "btree" ("created_at" DESC);


CREATE INDEX "idx_prompt_results_prompt_id" ON "public"."prompt_results" USING "btree" ("prompt_id");


CREATE INDEX "idx_prompt_volumes_est_ai_volume" ON "public"."prompt_volumes" USING "btree" ("est_ai_volume" DESC);


CREATE INDEX "idx_prompt_volumes_prompt_id" ON "public"."prompt_volumes" USING "btree" ("prompt_id");


CREATE INDEX "idx_prompts_topic" ON "public"."prompts" USING "btree" ("topic_id");


CREATE INDEX "idx_topics_brand" ON "public"."topics" USING "btree" ("brand_id");


CREATE INDEX "idx_volume_usage_org_month" ON "public"."volume_usage" USING "btree" ("organization_id", "used_at");


CREATE INDEX "idx_wc_brand_id" ON "public"."webhook_configs" USING "btree" ("brand_id");


CREATE OR REPLACE TRIGGER "handle_prompt_sets_updated_at" BEFORE UPDATE ON "public"."prompt_sets" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();


CREATE OR REPLACE TRIGGER "trg_brands_updated_at" BEFORE UPDATE ON "public"."brands" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();


CREATE OR REPLACE TRIGGER "trg_organizations_updated_at" BEFORE UPDATE ON "public"."organizations" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();


CREATE OR REPLACE TRIGGER "trg_profiles_updated_at" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();


ALTER TABLE ONLY "public"."ai_traffic_logs"
    ADD CONSTRAINT "ai_traffic_logs_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE CASCADE;


ALTER TABLE ONLY "public"."brand_domains"
    ADD CONSTRAINT "brand_domains_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE CASCADE;


ALTER TABLE ONLY "public"."brand_platforms"
    ADD CONSTRAINT "brand_platforms_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE CASCADE;


ALTER TABLE ONLY "public"."brands"
    ADD CONSTRAINT "brands_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;


ALTER TABLE ONLY "public"."competitors"
    ADD CONSTRAINT "competitors_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE CASCADE;


ALTER TABLE ONLY "public"."content_opportunities"
    ADD CONSTRAINT "content_opportunities_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE CASCADE;


ALTER TABLE ONLY "public"."content_opportunities"
    ADD CONSTRAINT "content_opportunities_prompt_id_fkey" FOREIGN KEY ("prompt_id") REFERENCES "public"."prompts"("id") ON DELETE SET NULL;


ALTER TABLE ONLY "public"."jobs"
    ADD CONSTRAINT "jobs_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE CASCADE;


ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;


ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE SET NULL;


ALTER TABLE ONLY "public"."prompt_results"
    ADD CONSTRAINT "prompt_results_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE CASCADE;


ALTER TABLE ONLY "public"."prompt_results"
    ADD CONSTRAINT "prompt_results_prompt_id_fkey" FOREIGN KEY ("prompt_id") REFERENCES "public"."prompts"("id") ON DELETE CASCADE;


ALTER TABLE ONLY "public"."prompt_sets"
    ADD CONSTRAINT "prompt_sets_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE CASCADE;


ALTER TABLE ONLY "public"."prompt_volumes"
    ADD CONSTRAINT "prompt_volumes_prompt_id_fkey" FOREIGN KEY ("prompt_id") REFERENCES "public"."prompts"("id") ON DELETE CASCADE;


ALTER TABLE ONLY "public"."prompts"
    ADD CONSTRAINT "prompts_prompt_set_id_fkey" FOREIGN KEY ("prompt_set_id") REFERENCES "public"."prompt_sets"("id") ON DELETE CASCADE;


ALTER TABLE ONLY "public"."prompts"
    ADD CONSTRAINT "prompts_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE SET NULL;


ALTER TABLE ONLY "public"."topics"
    ADD CONSTRAINT "topics_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE CASCADE;


ALTER TABLE ONLY "public"."volume_usage"
    ADD CONSTRAINT "volume_usage_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;


ALTER TABLE ONLY "public"."webhook_configs"
    ADD CONSTRAINT "webhook_configs_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE CASCADE;


CREATE POLICY "Service role can delete prompt results" ON "public"."prompt_results" FOR DELETE USING (true);


CREATE POLICY "Service role can insert prompt results" ON "public"."prompt_results" FOR INSERT WITH CHECK (true);


CREATE POLICY "Service role can insert traffic logs" ON "public"."ai_traffic_logs" FOR INSERT WITH CHECK (true);


CREATE POLICY "Users can delete brand platforms through org" ON "public"."brand_platforms" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM ("public"."brands" "b"
     JOIN "public"."profiles" "p" ON (("p"."organization_id" = "b"."organization_id")))
  WHERE (("b"."id" = "brand_platforms"."brand_id") AND ("p"."id" = "auth"."uid"())))));


CREATE POLICY "Users can insert brand platforms through org" ON "public"."brand_platforms" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."brands" "b"
     JOIN "public"."profiles" "p" ON (("p"."organization_id" = "b"."organization_id")))
  WHERE (("b"."id" = "brand_platforms"."brand_id") AND ("p"."id" = "auth"."uid"())))));


CREATE POLICY "Users can read own org prompt results" ON "public"."prompt_results" FOR SELECT USING (("brand_id" IN ( SELECT "b"."id"
   FROM ("public"."brands" "b"
     JOIN "public"."profiles" "p" ON (("p"."organization_id" = "b"."organization_id")))
  WHERE ("p"."id" = "auth"."uid"()))));


CREATE POLICY "Users can update brand platforms through org" ON "public"."brand_platforms" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM ("public"."brands" "b"
     JOIN "public"."profiles" "p" ON (("p"."organization_id" = "b"."organization_id")))
  WHERE (("b"."id" = "brand_platforms"."brand_id") AND ("p"."id" = "auth"."uid"())))));


CREATE POLICY "Users can view brand platforms through org" ON "public"."brand_platforms" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM ("public"."brands" "b"
     JOIN "public"."profiles" "p" ON (("p"."organization_id" = "b"."organization_id")))
  WHERE (("b"."id" = "brand_platforms"."brand_id") AND ("p"."id" = "auth"."uid"())))));


CREATE POLICY "Users can view own org traffic logs" ON "public"."ai_traffic_logs" FOR SELECT USING (("brand_id" IN ( SELECT "b"."id"
   FROM ("public"."brands" "b"
     JOIN "public"."profiles" "p" ON (("p"."organization_id" = "b"."organization_id")))
  WHERE ("p"."id" = "auth"."uid"()))));


CREATE POLICY "Users cannot update plan fields directly" ON "public"."organizations" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."organization_id" = "organizations"."id") AND ("profiles"."id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."organization_id" = "organizations"."id") AND ("profiles"."id" = "auth"."uid"())))));


ALTER TABLE "public"."ai_traffic_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."brand_domains" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "brand_domains: admin/manager delete" ON "public"."brand_domains" FOR DELETE USING (("brand_id" IN ( SELECT "b"."id"
   FROM ("public"."brands" "b"
     JOIN "public"."profiles" "p" ON (("p"."organization_id" = "b"."organization_id")))
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = ANY (ARRAY['admin'::"public"."user_role", 'manager'::"public"."user_role"]))))));


CREATE POLICY "brand_domains: admin/manager insert" ON "public"."brand_domains" FOR INSERT WITH CHECK (("brand_id" IN ( SELECT "b"."id"
   FROM ("public"."brands" "b"
     JOIN "public"."profiles" "p" ON (("p"."organization_id" = "b"."organization_id")))
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = ANY (ARRAY['admin'::"public"."user_role", 'manager'::"public"."user_role"]))))));


CREATE POLICY "brand_domains: admin/manager update" ON "public"."brand_domains" FOR UPDATE USING (("brand_id" IN ( SELECT "b"."id"
   FROM ("public"."brands" "b"
     JOIN "public"."profiles" "p" ON (("p"."organization_id" = "b"."organization_id")))
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = ANY (ARRAY['admin'::"public"."user_role", 'manager'::"public"."user_role"]))))));


CREATE POLICY "brand_domains: member select" ON "public"."brand_domains" FOR SELECT USING (("brand_id" IN ( SELECT "b"."id"
   FROM ("public"."brands" "b"
     JOIN "public"."profiles" "p" ON (("p"."organization_id" = "b"."organization_id")))
  WHERE ("p"."id" = "auth"."uid"()))));


ALTER TABLE "public"."brand_platforms" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."brands" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "brands: admin delete" ON "public"."brands" FOR DELETE USING (("organization_id" IN ( SELECT "profiles"."organization_id"
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'admin'::"public"."user_role")))));


CREATE POLICY "brands: admin/manager insert" ON "public"."brands" FOR INSERT WITH CHECK (("organization_id" IN ( SELECT "profiles"."organization_id"
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = ANY (ARRAY['admin'::"public"."user_role", 'manager'::"public"."user_role"]))))));


CREATE POLICY "brands: admin/manager update" ON "public"."brands" FOR UPDATE USING (("organization_id" IN ( SELECT "profiles"."organization_id"
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = ANY (ARRAY['admin'::"public"."user_role", 'manager'::"public"."user_role"]))))));


CREATE POLICY "brands: member select" ON "public"."brands" FOR SELECT USING (("organization_id" IN ( SELECT "profiles"."organization_id"
   FROM "public"."profiles"
  WHERE ("profiles"."id" = "auth"."uid"()))));


ALTER TABLE "public"."content_opportunities" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "content_opportunities: admin/manager delete" ON "public"."content_opportunities" FOR DELETE USING (("brand_id" IN ( SELECT "b"."id"
   FROM ("public"."brands" "b"
     JOIN "public"."profiles" "p" ON (("p"."organization_id" = "b"."organization_id")))
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = ANY (ARRAY['admin'::"public"."user_role", 'manager'::"public"."user_role"]))))));


CREATE POLICY "content_opportunities: admin/manager insert" ON "public"."content_opportunities" FOR INSERT WITH CHECK (("brand_id" IN ( SELECT "b"."id"
   FROM ("public"."brands" "b"
     JOIN "public"."profiles" "p" ON (("p"."organization_id" = "b"."organization_id")))
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = ANY (ARRAY['admin'::"public"."user_role", 'manager'::"public"."user_role"]))))));


CREATE POLICY "content_opportunities: admin/manager update" ON "public"."content_opportunities" FOR UPDATE USING (("brand_id" IN ( SELECT "b"."id"
   FROM ("public"."brands" "b"
     JOIN "public"."profiles" "p" ON (("p"."organization_id" = "b"."organization_id")))
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = ANY (ARRAY['admin'::"public"."user_role", 'manager'::"public"."user_role"]))))));


CREATE POLICY "content_opportunities: member select" ON "public"."content_opportunities" FOR SELECT USING (("brand_id" IN ( SELECT "b"."id"
   FROM ("public"."brands" "b"
     JOIN "public"."profiles" "p" ON (("p"."organization_id" = "b"."organization_id")))
  WHERE ("p"."id" = "auth"."uid"()))));


ALTER TABLE "public"."organizations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "organizations: admin update" ON "public"."organizations" FOR UPDATE USING (("id" IN ( SELECT "profiles"."organization_id"
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'admin'::"public"."user_role")))));


CREATE POLICY "organizations: authenticated insert" ON "public"."organizations" FOR INSERT WITH CHECK (("auth"."uid"() IS NOT NULL));


CREATE POLICY "organizations: member or creator select" ON "public"."organizations" FOR SELECT USING ((("id" IN ( SELECT "profiles"."organization_id"
   FROM "public"."profiles"
  WHERE ("profiles"."id" = "auth"."uid"()))) OR (NOT (EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE ("profiles"."organization_id" = "organizations"."id"))))));


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profiles: own row select" ON "public"."profiles" FOR SELECT USING (("auth"."uid"() = "id"));


CREATE POLICY "profiles: own row update" ON "public"."profiles" FOR UPDATE USING (("auth"."uid"() = "id"));


ALTER TABLE "public"."prompt_results" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."prompt_sets" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "prompt_sets: admin/manager delete" ON "public"."prompt_sets" FOR DELETE USING (("brand_id" IN ( SELECT "b"."id"
   FROM ("public"."brands" "b"
     JOIN "public"."profiles" "p" ON (("p"."organization_id" = "b"."organization_id")))
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = ANY (ARRAY['admin'::"public"."user_role", 'manager'::"public"."user_role"]))))));


CREATE POLICY "prompt_sets: admin/manager insert" ON "public"."prompt_sets" FOR INSERT WITH CHECK (("brand_id" IN ( SELECT "b"."id"
   FROM ("public"."brands" "b"
     JOIN "public"."profiles" "p" ON (("p"."organization_id" = "b"."organization_id")))
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = ANY (ARRAY['admin'::"public"."user_role", 'manager'::"public"."user_role"]))))));


CREATE POLICY "prompt_sets: admin/manager update" ON "public"."prompt_sets" FOR UPDATE USING (("brand_id" IN ( SELECT "b"."id"
   FROM ("public"."brands" "b"
     JOIN "public"."profiles" "p" ON (("p"."organization_id" = "b"."organization_id")))
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = ANY (ARRAY['admin'::"public"."user_role", 'manager'::"public"."user_role"]))))));


CREATE POLICY "prompt_sets: member select" ON "public"."prompt_sets" FOR SELECT USING (("brand_id" IN ( SELECT "b"."id"
   FROM ("public"."brands" "b"
     JOIN "public"."profiles" "p" ON (("p"."organization_id" = "b"."organization_id")))
  WHERE ("p"."id" = "auth"."uid"()))));


ALTER TABLE "public"."prompts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "prompts: admin/manager delete" ON "public"."prompts" FOR DELETE USING (("prompt_set_id" IN ( SELECT "ps"."id"
   FROM (("public"."prompt_sets" "ps"
     JOIN "public"."brands" "b" ON (("b"."id" = "ps"."brand_id")))
     JOIN "public"."profiles" "p" ON (("p"."organization_id" = "b"."organization_id")))
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = ANY (ARRAY['admin'::"public"."user_role", 'manager'::"public"."user_role"]))))));


CREATE POLICY "prompts: admin/manager insert" ON "public"."prompts" FOR INSERT WITH CHECK (("prompt_set_id" IN ( SELECT "ps"."id"
   FROM (("public"."prompt_sets" "ps"
     JOIN "public"."brands" "b" ON (("b"."id" = "ps"."brand_id")))
     JOIN "public"."profiles" "p" ON (("p"."organization_id" = "b"."organization_id")))
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = ANY (ARRAY['admin'::"public"."user_role", 'manager'::"public"."user_role"]))))));


CREATE POLICY "prompts: admin/manager update" ON "public"."prompts" FOR UPDATE USING (("prompt_set_id" IN ( SELECT "ps"."id"
   FROM (("public"."prompt_sets" "ps"
     JOIN "public"."brands" "b" ON (("b"."id" = "ps"."brand_id")))
     JOIN "public"."profiles" "p" ON (("p"."organization_id" = "b"."organization_id")))
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = ANY (ARRAY['admin'::"public"."user_role", 'manager'::"public"."user_role"]))))));


CREATE POLICY "prompts: member select" ON "public"."prompts" FOR SELECT USING (("prompt_set_id" IN ( SELECT "ps"."id"
   FROM (("public"."prompt_sets" "ps"
     JOIN "public"."brands" "b" ON (("b"."id" = "ps"."brand_id")))
     JOIN "public"."profiles" "p" ON (("p"."organization_id" = "b"."organization_id")))
  WHERE ("p"."id" = "auth"."uid"()))));


ALTER TABLE "public"."volume_usage" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."webhook_configs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "webhook_configs: admin/manager delete" ON "public"."webhook_configs" FOR DELETE USING (("brand_id" IN ( SELECT "b"."id"
   FROM ("public"."brands" "b"
     JOIN "public"."profiles" "p" ON (("p"."organization_id" = "b"."organization_id")))
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = ANY (ARRAY['admin'::"public"."user_role", 'manager'::"public"."user_role"]))))));


CREATE POLICY "webhook_configs: admin/manager insert" ON "public"."webhook_configs" FOR INSERT WITH CHECK (("brand_id" IN ( SELECT "b"."id"
   FROM ("public"."brands" "b"
     JOIN "public"."profiles" "p" ON (("p"."organization_id" = "b"."organization_id")))
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = ANY (ARRAY['admin'::"public"."user_role", 'manager'::"public"."user_role"]))))));


CREATE POLICY "webhook_configs: admin/manager update" ON "public"."webhook_configs" FOR UPDATE USING (("brand_id" IN ( SELECT "b"."id"
   FROM ("public"."brands" "b"
     JOIN "public"."profiles" "p" ON (("p"."organization_id" = "b"."organization_id")))
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = ANY (ARRAY['admin'::"public"."user_role", 'manager'::"public"."user_role"]))))));


CREATE POLICY "webhook_configs: member select" ON "public"."webhook_configs" FOR SELECT USING (("brand_id" IN ( SELECT "b"."id"
   FROM ("public"."brands" "b"
     JOIN "public"."profiles" "p" ON (("p"."organization_id" = "b"."organization_id")))
  WHERE ("p"."id" = "auth"."uid"()))));


ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";


GRANT ALL ON TABLE "public"."prompt_results" TO "anon";
GRANT ALL ON TABLE "public"."prompt_results" TO "authenticated";
GRANT ALL ON TABLE "public"."prompt_results" TO "service_role";


GRANT ALL ON FUNCTION "public"."get_latest_prompt_results"("p_brand_id" "uuid", "p_platform" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_latest_prompt_results"("p_brand_id" "uuid", "p_platform" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_latest_prompt_results"("p_brand_id" "uuid", "p_platform" "text") TO "service_role";


GRANT ALL ON FUNCTION "public"."get_latest_prompt_results"("p_brand_id" "uuid", "p_platform" "text", "p_model" "text", "p_region" "text", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."get_latest_prompt_results"("p_brand_id" "uuid", "p_platform" "text", "p_model" "text", "p_region" "text", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_latest_prompt_results"("p_brand_id" "uuid", "p_platform" "text", "p_model" "text", "p_region" "text", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone) TO "service_role";


GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";


GRANT ALL ON FUNCTION "public"."handle_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_updated_at"() TO "service_role";


GRANT ALL ON TABLE "public"."ai_traffic_logs" TO "anon";
GRANT ALL ON TABLE "public"."ai_traffic_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."ai_traffic_logs" TO "service_role";


GRANT ALL ON TABLE "public"."brand_domains" TO "anon";
GRANT ALL ON TABLE "public"."brand_domains" TO "authenticated";
GRANT ALL ON TABLE "public"."brand_domains" TO "service_role";


GRANT ALL ON TABLE "public"."brand_platforms" TO "anon";
GRANT ALL ON TABLE "public"."brand_platforms" TO "authenticated";
GRANT ALL ON TABLE "public"."brand_platforms" TO "service_role";


GRANT ALL ON TABLE "public"."brands" TO "anon";
GRANT ALL ON TABLE "public"."brands" TO "authenticated";
GRANT ALL ON TABLE "public"."brands" TO "service_role";


GRANT ALL ON TABLE "public"."competitors" TO "anon";
GRANT ALL ON TABLE "public"."competitors" TO "authenticated";
GRANT ALL ON TABLE "public"."competitors" TO "service_role";


GRANT ALL ON TABLE "public"."content_opportunities" TO "anon";
GRANT ALL ON TABLE "public"."content_opportunities" TO "authenticated";
GRANT ALL ON TABLE "public"."content_opportunities" TO "service_role";


GRANT ALL ON TABLE "public"."jobs" TO "anon";
GRANT ALL ON TABLE "public"."jobs" TO "authenticated";
GRANT ALL ON TABLE "public"."jobs" TO "service_role";


GRANT ALL ON TABLE "public"."organizations" TO "anon";
GRANT ALL ON TABLE "public"."organizations" TO "authenticated";
GRANT ALL ON TABLE "public"."organizations" TO "service_role";


GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";


GRANT ALL ON TABLE "public"."prompt_sets" TO "anon";
GRANT ALL ON TABLE "public"."prompt_sets" TO "authenticated";
GRANT ALL ON TABLE "public"."prompt_sets" TO "service_role";


GRANT ALL ON TABLE "public"."prompt_volumes" TO "anon";
GRANT ALL ON TABLE "public"."prompt_volumes" TO "authenticated";
GRANT ALL ON TABLE "public"."prompt_volumes" TO "service_role";


GRANT ALL ON TABLE "public"."prompts" TO "anon";
GRANT ALL ON TABLE "public"."prompts" TO "authenticated";
GRANT ALL ON TABLE "public"."prompts" TO "service_role";


GRANT ALL ON TABLE "public"."topics" TO "anon";
GRANT ALL ON TABLE "public"."topics" TO "authenticated";
GRANT ALL ON TABLE "public"."topics" TO "service_role";


GRANT ALL ON TABLE "public"."volume_usage" TO "anon";
GRANT ALL ON TABLE "public"."volume_usage" TO "authenticated";
GRANT ALL ON TABLE "public"."volume_usage" TO "service_role";


GRANT ALL ON TABLE "public"."webhook_configs" TO "anon";
GRANT ALL ON TABLE "public"."webhook_configs" TO "authenticated";
GRANT ALL ON TABLE "public"."webhook_configs" TO "service_role";


ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";


ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";


ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";


CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();


