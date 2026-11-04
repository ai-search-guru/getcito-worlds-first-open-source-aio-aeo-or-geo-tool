-- Team invitations
-- Adds invitation flow so organization admins can invite teammates via email.

CREATE TYPE "public"."invitation_status" AS ENUM (
    'pending',
    'accepted',
    'expired',
    'revoked'
);

ALTER TYPE "public"."invitation_status" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."invitations" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "organization_id" uuid NOT NULL,
    "email" text NOT NULL,
    "role" public.user_role NOT NULL DEFAULT 'analyst',
    "token" text NOT NULL,
    "invited_by" uuid NOT NULL,
    "status" public.invitation_status NOT NULL DEFAULT 'pending',
    "expires_at" timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
    "accepted_at" timestamptz,
    "created_at" timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE "public"."invitations" OWNER TO "postgres";

ALTER TABLE ONLY "public"."invitations"
    ADD CONSTRAINT "invitations_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."invitations"
    ADD CONSTRAINT "invitations_token_key" UNIQUE ("token");

ALTER TABLE ONLY "public"."invitations"
    ADD CONSTRAINT "invitations_organization_id_fkey"
    FOREIGN KEY ("organization_id")
    REFERENCES "public"."organizations"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."invitations"
    ADD CONSTRAINT "invitations_invited_by_fkey"
    FOREIGN KEY ("invited_by")
    REFERENCES "auth"."users"("id") ON DELETE CASCADE;

-- Prevent duplicate pending invitations for the same org+email combo.
CREATE UNIQUE INDEX IF NOT EXISTS "invitations_org_email_pending_idx"
    ON "public"."invitations" ("organization_id", lower("email"))
    WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS "idx_invitations_organization_id"
    ON "public"."invitations" USING btree ("organization_id");

CREATE INDEX IF NOT EXISTS "idx_invitations_email"
    ON "public"."invitations" USING btree (lower("email"));

CREATE INDEX IF NOT EXISTS "idx_invitations_token"
    ON "public"."invitations" USING btree ("token");

-- RLS
ALTER TABLE "public"."invitations" ENABLE ROW LEVEL SECURITY;

-- Members of an org can read invitations for that org.
CREATE POLICY "Members can view org invitations"
    ON "public"."invitations" FOR SELECT
    USING (
        organization_id IN (
            SELECT organization_id FROM public.profiles WHERE id = auth.uid()
        )
    );

-- Admins of an org can manage (insert/update/delete) invitations.
CREATE POLICY "Admins can insert invitations"
    ON "public"."invitations" FOR INSERT
    WITH CHECK (
        organization_id IN (
            SELECT organization_id FROM public.profiles
            WHERE id = auth.uid() AND role = 'admin'
        )
    );

CREATE POLICY "Admins can update invitations"
    ON "public"."invitations" FOR UPDATE
    USING (
        organization_id IN (
            SELECT organization_id FROM public.profiles
            WHERE id = auth.uid() AND role = 'admin'
        )
    );

CREATE POLICY "Admins can delete invitations"
    ON "public"."invitations" FOR DELETE
    USING (
        organization_id IN (
            SELECT organization_id FROM public.profiles
            WHERE id = auth.uid() AND role = 'admin'
        )
    );

GRANT ALL ON TABLE "public"."invitations" TO "anon";
GRANT ALL ON TABLE "public"."invitations" TO "authenticated";
GRANT ALL ON TABLE "public"."invitations" TO "service_role";
