-- Organizations: restrict client-side updates to admins, and keep
-- server-managed columns out of the client's reach entirely.
--
-- Two permissive UPDATE policies were in force. Postgres ORs permissive
-- policies together, so the wider of the two decided the outcome and the
-- admin restriction never applied. The wider policy's name states an intent
-- its WITH CHECK does not carry out: it names no columns, so it allowed a
-- row's every column to be rewritten by any member of the org.
--
-- Column-level intent cannot be expressed in a policy at all. WITH CHECK sees
-- only the new row, so "this column may not change" has nowhere to compare
-- against. A BEFORE UPDATE trigger can see both rows, and that is where the
-- rule belongs.

DROP POLICY IF EXISTS "Users cannot update plan fields directly" ON "public"."organizations";
DROP POLICY IF EXISTS "organizations: admin update" ON "public"."organizations";

-- USING picks the rows an admin may reach; WITH CHECK keeps the updated row
-- inside the same set, so an org cannot be handed to somebody else.
CREATE POLICY "organizations: admin update" ON "public"."organizations"
  FOR UPDATE
  USING (
    "id" IN (
      SELECT "profiles"."organization_id"
      FROM "public"."profiles"
      WHERE "profiles"."id" = "auth"."uid"()
        AND "profiles"."role" = 'admin'::"public"."user_role"
    )
  )
  WITH CHECK (
    "id" IN (
      SELECT "profiles"."organization_id"
      FROM "public"."profiles"
      WHERE "profiles"."id" = "auth"."uid"()
        AND "profiles"."role" = 'admin'::"public"."user_role"
    )
  );

-- Billing state belongs to Stripe and the webhook that mirrors it; the API key
-- columns hold ciphertext produced server-side. Neither is the client's to
-- write, admin or not.
CREATE OR REPLACE FUNCTION "public"."guard_organization_server_columns"()
RETURNS "trigger"
LANGUAGE "plpgsql"
SET "search_path" = ''
AS $$
BEGIN
  -- A role that already bypasses row-level security is server-side by
  -- definition -- the service role key, migrations, psql -- and this guard is
  -- not aimed at it. Everything else is a request carrying an end user's JWT.
  -- Naming the client roles instead would fail open on any role nobody
  -- thought of; asking about the privilege fails closed.
  IF (SELECT "rolbypassrls" FROM "pg_catalog"."pg_roles" WHERE "rolname" = current_user) THEN
    RETURN NEW;
  END IF;

  IF NEW."plan" IS DISTINCT FROM OLD."plan"
     OR NEW."plan_overrides" IS DISTINCT FROM OLD."plan_overrides"
     OR NEW."subscription_status" IS DISTINCT FROM OLD."subscription_status"
     OR NEW."subscription_ends_at" IS DISTINCT FROM OLD."subscription_ends_at"
     OR NEW."stripe_customer_id" IS DISTINCT FROM OLD."stripe_customer_id"
     OR NEW."stripe_subscription_id" IS DISTINCT FROM OLD."stripe_subscription_id"
     OR NEW."anthropic_api_key_encrypted" IS DISTINCT FROM OLD."anthropic_api_key_encrypted"
     OR NEW."anthropic_api_key_last4" IS DISTINCT FROM OLD."anthropic_api_key_last4"
     OR NEW."anthropic_api_key_set_at" IS DISTINCT FROM OLD."anthropic_api_key_set_at"
     OR NEW."anthropic_api_key_set_by" IS DISTINCT FROM OLD."anthropic_api_key_set_by"
  THEN
    RAISE EXCEPTION 'organization column is managed server-side and cannot be set from the client'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "organizations_guard_server_columns" ON "public"."organizations";

CREATE TRIGGER "organizations_guard_server_columns"
  BEFORE UPDATE ON "public"."organizations"
  FOR EACH ROW
  EXECUTE FUNCTION "public"."guard_organization_server_columns"();
