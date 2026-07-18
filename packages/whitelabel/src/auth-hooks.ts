/**
 * Whitelabel auth hooks for better-auth.
 *
 * Syncs Auth0 app_metadata to better-auth's organization/user tables
 * on SSO login via the provisionUser callback.
 *
 * Data flow:
 * 1. User logs in via Auth0 SSO -> better-auth creates user + session
 * 2. provisionUser fires (before session cookie is set)
 * 3. Fetches app_metadata from Auth0 Management API
 * 4. Upserts better-auth organizations from Getcito_orgs
 * 5. Sets user admin role and report generator access flags
 * 6. Mutates the user object so the session cookie has correct data
 */

import type { CreateAuthOptions } from "@workspace/lib/auth/server";
import {
	findAccountByProvider,
	syncMemberships,
	updateUserFlags,
	upsertOrganization,
} from "@workspace/lib/db/auth-sync";
import { ManagementClient } from "auth0";
import { z } from "zod";

interface Auth0AppMetadata {
	Getcito_orgs: Array<{ id: string; name: string }>;
	Getcito_report_generator_access?: boolean;
	Getcito_admin?: boolean;
}

let managementClient: ManagementClient | null = null;

const Auth0AppMetadataSchema = z.object({
	Getcito_orgs: z
		.array(
			z.object({
				id: z.string().min(1),
				name: z.string().min(1),
			}),
		)
		.optional()
		.default([]),
	Getcito_report_generator_access: z.boolean().optional(),
	Getcito_admin: z.boolean().optional(),
});

const REVOKED_METADATA: Auth0AppMetadata = {
	Getcito_orgs: [],
	Getcito_report_generator_access: false,
	Getcito_admin: false,
};

function getManagementClient(): ManagementClient {
	if (!managementClient) {
		managementClient = new ManagementClient({
			domain: process.env.AUTH0_MGMT_API_DOMAIN!,
			clientId: process.env.AUTH0_CLIENT_ID!,
			clientSecret: process.env.AUTH0_CLIENT_SECRET!,
		});
	}
	return managementClient;
}

async function fetchAuth0AppMetadata(auth0UserId: string): Promise<Auth0AppMetadata> {
	const client = getManagementClient();
	const userData = await client.users.get(auth0UserId);
	const appMetadataRaw =
		(userData as { app_metadata?: unknown }).app_metadata ??
		(userData as { data?: { app_metadata?: unknown } }).data?.app_metadata;

	const parsed = Auth0AppMetadataSchema.safeParse(appMetadataRaw);
	if (!parsed.success) {
		// Missing/malformed metadata in a successful Auth0 response revokes access by policy.
		console.error(
			`[auth0-sync] Invalid app_metadata for auth0UserId=${auth0UserId}; revoking access`,
			parsed.error.issues,
		);
		return REVOKED_METADATA;
	}
	return parsed.data;
}

async function syncOrganizations(userId: string, orgs: Array<{ id: string; name: string }>): Promise<void> {
	for (const org of orgs) {
		await upsertOrganization(org);
	}
	const orgNameById = new Map(orgs.map((o) => [o.id, o.name]));
	const { added, removed } = await syncMemberships(
		userId,
		orgs.map((o) => o.id),
	);
	if (added.length > 0 || removed.length > 0) {
		const parts: string[] = [];
		if (added.length > 0) parts.push(`added=[${added.map((id) => orgNameById.get(id) ?? id).join(", ")}]`);
		if (removed.length > 0) parts.push(`removed=[${removed.join(", ")}]`);
		console.log(`[auth0-sync] user=${userId} ${parts.join(" ")}`);
	} else {
		console.log(`[auth0-sync] user=${userId} already in sync`);
	}
}

/**
 * Syncs Auth0 app_metadata for a user on login.
 *
 * Fetches metadata from Auth0 Management API, upserts organizations,
 * and updates user flags (admin role, report generator access).
 *
 * Returns the resolved flags so the caller can apply them to the user
 * object before the session cookie is set.
 */
export async function syncAuth0User(
	userId: string,
	auth0UserId: string,
): Promise<{ role: string; hasReportGeneratorAccess: boolean }> {
	console.log(`[auth0-sync] Syncing user=${userId}`);
	const metadata = await fetchAuth0AppMetadata(auth0UserId);

	await syncOrganizations(userId, metadata.Getcito_orgs);

	const flags = {
		role: metadata.Getcito_admin ? "admin" : "user",
		hasReportGeneratorAccess: metadata.Getcito_report_generator_access ?? false,
	};
	await updateUserFlags(userId, flags);

	return flags;
}

/**
 * Syncs a user's Auth0 memberships by looking up their linked Auth0 account.
 * Returns null if the user has no Auth0 account (non-SSO user).
 */
export async function syncAuth0UserById(
	userId: string,
): Promise<{ role: string; hasReportGeneratorAccess: boolean } | null> {
	const acc = await findAccountByProvider(userId, (p) => p === "auth0-whitelabel");
	if (!acc) return null;
	return syncAuth0User(userId, acc.accountId);
}

/**
 * Returns the CreateAuthOptions for whitelabel deployments.
 *
 * Wires up Auth0 OIDC SSO and the provisionUser callback that syncs
 * Auth0 app_metadata into better-auth's user/org tables on login.
 */
export function getWhitelabelAuthOptions(): CreateAuthOptions {
	const domain = process.env.AUTH0_DOMAIN!;
	return {
		emailAndPasswordEnabled: false,
		disableSignUp: true,
		trustedOrigins: [`https://${domain}`],
		sso: {
			defaultSSO: [
				{
					providerId: "auth0-whitelabel",
					domain,
					oidcConfig: {
						clientId: process.env.AUTH0_CLIENT_ID!,
						clientSecret: process.env.AUTH0_CLIENT_SECRET!,
						issuer: `https://${domain}/`,
						discoveryEndpoint: `https://${domain}/.well-known/openid-configuration`,
						authorizationEndpoint: `https://${domain}/authorize`,
						tokenEndpoint: `https://${domain}/oauth/token`,
						userInfoEndpoint: `https://${domain}/userinfo`,
						jwksEndpoint: `https://${domain}/.well-known/jwks.json`,
						tokenEndpointAuthentication: "client_secret_post",
						pkce: true,
					},
				},
			],
			provisionUser: async ({ user, userInfo }: { user: { id: string }; userInfo: Record<string, any> }) => {
				const flags = await syncAuth0User(user.id, userInfo.id);
				Object.assign(user, flags);
			},
		},
	};
}
