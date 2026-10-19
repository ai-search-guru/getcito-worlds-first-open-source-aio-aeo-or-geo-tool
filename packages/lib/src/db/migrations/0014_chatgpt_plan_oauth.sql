CREATE TABLE "provider_auth" (
	"provider" text PRIMARY KEY NOT NULL,
	"encrypted_credentials" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "provider_auth" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "provider_auth_attempts" (
	"state" text PRIMARY KEY NOT NULL,
	"encrypted_attempt" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "provider_auth_attempts" ENABLE ROW LEVEL SECURITY;