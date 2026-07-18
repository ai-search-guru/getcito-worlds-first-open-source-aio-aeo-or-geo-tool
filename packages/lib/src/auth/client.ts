/**
 * Better-auth client instance.
 *
 * Used in browser code for session management, organization switching,
 * permission checks, and SSO flows.
 */
import { createAuthClient } from "better-auth/react";
import { organizationClient, adminClient } from "better-auth/client/plugins";
import { ssoClient } from "@better-auth/sso/client";
import { ac, adminRole, userRole } from "./permissions";

export const authClient = createAuthClient({
	baseURL: typeof window !== "undefined" ? window.location.origin : "",
	basePath: "/api/auth",
	plugins: [
		organizationClient(),
		adminClient({
			ac,
			roles: {
				admin: adminRole,
				user: userRole,
			},
		}),
		ssoClient(),
	],
});

export type AuthClient = typeof authClient;
