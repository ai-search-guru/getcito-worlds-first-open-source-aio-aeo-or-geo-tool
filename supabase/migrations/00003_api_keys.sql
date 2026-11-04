-- API keys
-- Long-lived bearer tokens that let external clients (MCP server, scripts,
-- third-party integrations) authenticate against the GetCito API on behalf
-- of a user without holding a Supabase session.
--
-- The plaintext token is shown to the user exactly once at creation time.
-- The server stores only `key_hash` (sha256 of the full token) and `prefix`
-- (first 12 chars, used for identification in the UI / logs).

CREATE TABLE IF NOT EXISTS "public"."api_keys" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "user_id" uuid NOT NULL,
    "name" text NOT NULL,
    "prefix" text NOT NULL,
    "key_hash" text NOT NULL,
    "last_used_at" timestamptz,
    "revoked_at" timestamptz,
    "created_at" timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE "public"."api_keys" OWNER TO "postgres";

ALTER TABLE ONLY "public"."api_keys"
    ADD CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."api_keys"
    ADD CONSTRAINT "api_keys_user_id_fkey"
    FOREIGN KEY ("user_id")
    REFERENCES "auth"."users"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."api_keys"
    ADD CONSTRAINT "api_keys_key_hash_key" UNIQUE ("key_hash");

CREATE INDEX IF NOT EXISTS "idx_api_keys_user_id"
    ON "public"."api_keys" USING btree ("user_id");

CREATE INDEX IF NOT EXISTS "idx_api_keys_key_hash"
    ON "public"."api_keys" USING btree ("key_hash");

-- RLS
ALTER TABLE "public"."api_keys" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own api keys"
    ON "public"."api_keys" FOR SELECT
    USING (user_id = auth.uid());

CREATE POLICY "Users can insert their own api keys"
    ON "public"."api_keys" FOR INSERT
    WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can revoke their own api keys"
    ON "public"."api_keys" FOR UPDATE
    USING (user_id = auth.uid());

CREATE POLICY "Users can delete their own api keys"
    ON "public"."api_keys" FOR DELETE
    USING (user_id = auth.uid());

GRANT ALL ON TABLE "public"."api_keys" TO "anon";
GRANT ALL ON TABLE "public"."api_keys" TO "authenticated";
GRANT ALL ON TABLE "public"."api_keys" TO "service_role";
