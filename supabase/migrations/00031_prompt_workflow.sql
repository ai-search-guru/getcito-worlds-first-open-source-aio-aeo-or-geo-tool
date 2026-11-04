-- 00031_prompt_workflow.sql
-- Prompt workflow: per-prompt work status, a notes thread, and multiple
-- target URLs. Turns the prompts list into a workspace — "which prompts have
-- we acted on, which still need work, and which URLs are we pushing to get
-- cited?" Target URLs are structured (not free text inside notes) so a later
-- iteration can auto-check them against the prompt's citations.

ALTER TABLE "public"."prompts"
  ADD COLUMN IF NOT EXISTS "work_status" "text",
  ADD CONSTRAINT "prompts_work_status_check" CHECK (
    "work_status" IS NULL OR "work_status" = ANY (ARRAY['todo'::"text", 'in_progress'::"text", 'done'::"text"])
  );

CREATE TABLE IF NOT EXISTS "public"."prompt_notes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "prompt_id" "uuid" NOT NULL,
    "author_id" "uuid",
    "body" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "prompt_notes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "prompt_notes_prompt_id_fkey" FOREIGN KEY ("prompt_id")
        REFERENCES "public"."prompts"("id") ON DELETE CASCADE,
    CONSTRAINT "prompt_notes_author_id_fkey" FOREIGN KEY ("author_id")
        REFERENCES "public"."profiles"("id") ON DELETE SET NULL
);

ALTER TABLE "public"."prompt_notes" OWNER TO "postgres";

CREATE INDEX IF NOT EXISTS "idx_prompt_notes_prompt"
    ON "public"."prompt_notes" ("prompt_id", "created_at");

CREATE TABLE IF NOT EXISTS "public"."prompt_target_urls" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "prompt_id" "uuid" NOT NULL,
    "url" "text" NOT NULL,
    "label" "text",
    "added_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "prompt_target_urls_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "prompt_target_urls_prompt_id_fkey" FOREIGN KEY ("prompt_id")
        REFERENCES "public"."prompts"("id") ON DELETE CASCADE,
    CONSTRAINT "prompt_target_urls_added_by_fkey" FOREIGN KEY ("added_by")
        REFERENCES "public"."profiles"("id") ON DELETE SET NULL,
    CONSTRAINT "prompt_target_urls_unique" UNIQUE ("prompt_id", "url")
);

ALTER TABLE "public"."prompt_target_urls" OWNER TO "postgres";

CREATE INDEX IF NOT EXISTS "idx_prompt_target_urls_prompt"
    ON "public"."prompt_target_urls" ("prompt_id", "created_at");

ALTER TABLE "public"."prompt_notes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."prompt_target_urls" ENABLE ROW LEVEL SECURITY;

-- Same org scoping as prompts: members read, admin/manager write.
CREATE POLICY "prompt_notes: member select" ON "public"."prompt_notes"
    FOR SELECT USING (("prompt_id" IN ( SELECT "pr"."id"
        FROM ((("public"."prompts" "pr"
          JOIN "public"."prompt_sets" "ps" ON (("ps"."id" = "pr"."prompt_set_id")))
          JOIN "public"."brands" "b" ON (("b"."id" = "ps"."brand_id")))
          JOIN "public"."profiles" "p" ON (("p"."organization_id" = "b"."organization_id")))
        WHERE ("p"."id" = "auth"."uid"()))));

CREATE POLICY "prompt_notes: admin/manager insert" ON "public"."prompt_notes"
    FOR INSERT WITH CHECK (("prompt_id" IN ( SELECT "pr"."id"
        FROM ((("public"."prompts" "pr"
          JOIN "public"."prompt_sets" "ps" ON (("ps"."id" = "pr"."prompt_set_id")))
          JOIN "public"."brands" "b" ON (("b"."id" = "ps"."brand_id")))
          JOIN "public"."profiles" "p" ON (("p"."organization_id" = "b"."organization_id")))
        WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = ANY (ARRAY['admin'::"public"."user_role", 'manager'::"public"."user_role"]))))));

CREATE POLICY "prompt_notes: admin/manager delete" ON "public"."prompt_notes"
    FOR DELETE USING (("prompt_id" IN ( SELECT "pr"."id"
        FROM ((("public"."prompts" "pr"
          JOIN "public"."prompt_sets" "ps" ON (("ps"."id" = "pr"."prompt_set_id")))
          JOIN "public"."brands" "b" ON (("b"."id" = "ps"."brand_id")))
          JOIN "public"."profiles" "p" ON (("p"."organization_id" = "b"."organization_id")))
        WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = ANY (ARRAY['admin'::"public"."user_role", 'manager'::"public"."user_role"]))))));

CREATE POLICY "prompt_target_urls: member select" ON "public"."prompt_target_urls"
    FOR SELECT USING (("prompt_id" IN ( SELECT "pr"."id"
        FROM ((("public"."prompts" "pr"
          JOIN "public"."prompt_sets" "ps" ON (("ps"."id" = "pr"."prompt_set_id")))
          JOIN "public"."brands" "b" ON (("b"."id" = "ps"."brand_id")))
          JOIN "public"."profiles" "p" ON (("p"."organization_id" = "b"."organization_id")))
        WHERE ("p"."id" = "auth"."uid"()))));

CREATE POLICY "prompt_target_urls: admin/manager insert" ON "public"."prompt_target_urls"
    FOR INSERT WITH CHECK (("prompt_id" IN ( SELECT "pr"."id"
        FROM ((("public"."prompts" "pr"
          JOIN "public"."prompt_sets" "ps" ON (("ps"."id" = "pr"."prompt_set_id")))
          JOIN "public"."brands" "b" ON (("b"."id" = "ps"."brand_id")))
          JOIN "public"."profiles" "p" ON (("p"."organization_id" = "b"."organization_id")))
        WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = ANY (ARRAY['admin'::"public"."user_role", 'manager'::"public"."user_role"]))))));

CREATE POLICY "prompt_target_urls: admin/manager delete" ON "public"."prompt_target_urls"
    FOR DELETE USING (("prompt_id" IN ( SELECT "pr"."id"
        FROM ((("public"."prompts" "pr"
          JOIN "public"."prompt_sets" "ps" ON (("ps"."id" = "pr"."prompt_set_id")))
          JOIN "public"."brands" "b" ON (("b"."id" = "ps"."brand_id")))
          JOIN "public"."profiles" "p" ON (("p"."organization_id" = "b"."organization_id")))
        WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = ANY (ARRAY['admin'::"public"."user_role", 'manager'::"public"."user_role"]))))));

GRANT ALL ON TABLE "public"."prompt_notes" TO "anon";
GRANT ALL ON TABLE "public"."prompt_notes" TO "authenticated";
GRANT ALL ON TABLE "public"."prompt_notes" TO "service_role";
GRANT ALL ON TABLE "public"."prompt_target_urls" TO "anon";
GRANT ALL ON TABLE "public"."prompt_target_urls" TO "authenticated";
GRANT ALL ON TABLE "public"."prompt_target_urls" TO "service_role";
