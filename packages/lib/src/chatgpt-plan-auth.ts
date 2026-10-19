import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { and, eq, gt, lt, sql } from "drizzle-orm";
import { db } from "./db/db";
import { providerAuth, providerAuthAttempts } from "./db/schema";

const PROVIDER_ID = "openai-chatgpt-plan";
const TOKEN_URL = "https://auth.openai.com/api/accounts/oauth/token";
const RESOURCE = "https://api.openai.com/v1";

export type ChatGptPlanCredentials = {
	clientId: string;
	extAgentHostId: string;
	idToken?: string;
	accessToken?: string;
	refreshToken?: string;
	tokenType: "Bearer";
	expiresAt?: number;
	scopes: string[];
	email: string;
	subject: string;
};

export type ChatGptOAuthAttempt = {
	clientId: string;
	newRegistration: boolean;
	codeVerifier: string;
	nonce: string;
	redirectUri: string;
	extAgentHostId: string;
	brandId: string;
	returnOrigin: string;
	returnPath: string;
	expectedSubject?: string;
};

function encryptionKey(): Buffer {
	const secret = process.env.BETTER_AUTH_SECRET;
	if (!secret) throw new Error("BETTER_AUTH_SECRET is required to protect ChatGPT sign-in credentials.");
	return scryptSync(secret, "getcito:chatgpt-plan-oauth:v1", 32);
}

function encrypt(value: unknown): string {
	const iv = randomBytes(12);
	const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
	const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
	return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}

function decrypt<T>(value: string): T {
	const [version, ivText, tagText, ciphertextText] = value.split(".");
	if (version !== "v1" || !ivText || !tagText || !ciphertextText) throw new Error("Stored ChatGPT credentials are unreadable.");
	const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivText, "base64url"));
	decipher.setAuthTag(Buffer.from(tagText, "base64url"));
	const plaintext = Buffer.concat([
		decipher.update(Buffer.from(ciphertextText, "base64url")),
		decipher.final(),
	]).toString("utf8");
	return JSON.parse(plaintext) as T;
}

export async function saveChatGptOAuthAttempt(state: string, attempt: ChatGptOAuthAttempt): Promise<void> {
	await db.delete(providerAuthAttempts).where(lt(providerAuthAttempts.expiresAt, new Date()));
	await db.insert(providerAuthAttempts).values({
		state,
		encryptedAttempt: encrypt(attempt),
		expiresAt: new Date(Date.now() + 10 * 60 * 1000),
	}).onConflictDoUpdate({
		target: providerAuthAttempts.state,
		set: { encryptedAttempt: encrypt(attempt), expiresAt: new Date(Date.now() + 10 * 60 * 1000) },
	});
}

export async function consumeChatGptOAuthAttempt(state: string): Promise<ChatGptOAuthAttempt | null> {
	const rows = await db.delete(providerAuthAttempts)
		.where(and(eq(providerAuthAttempts.state, state), gt(providerAuthAttempts.expiresAt, new Date())))
		.returning({ encryptedAttempt: providerAuthAttempts.encryptedAttempt });
	return rows[0] ? decrypt<ChatGptOAuthAttempt>(rows[0].encryptedAttempt) : null;
}

export async function getChatGptPlanCredentials(): Promise<ChatGptPlanCredentials | null> {
	const row = await db.query.providerAuth.findFirst({ where: eq(providerAuth.provider, PROVIDER_ID) });
	return row ? decrypt<ChatGptPlanCredentials>(row.encryptedCredentials) : null;
}

export async function saveChatGptPlanCredentials(credentials: ChatGptPlanCredentials): Promise<void> {
	await db.insert(providerAuth).values({
		provider: PROVIDER_ID,
		encryptedCredentials: encrypt(credentials),
		updatedAt: new Date(),
	}).onConflictDoUpdate({
		target: providerAuth.provider,
		set: { encryptedCredentials: encrypt(credentials), updatedAt: new Date() },
	});
}

export async function disconnectChatGptPlan(): Promise<boolean> {
	const credentials = await getChatGptPlanCredentials();
	if (!credentials?.refreshToken) return true;
	let revoked = false;
	try {
		const discoveryResponse = await fetch("https://auth.openai.com/.well-known/openid-configuration");
		if (discoveryResponse.ok) {
			const discovery = await discoveryResponse.json() as { revocation_endpoint?: string };
			if (discovery.revocation_endpoint) {
				for (let attempt = 0; attempt < 2; attempt++) {
					const response = await fetch(discovery.revocation_endpoint, {
						method: "POST",
						headers: { "Content-Type": "application/x-www-form-urlencoded" },
						body: new URLSearchParams({
							token: credentials.refreshToken,
							token_type_hint: "refresh_token",
							client_id: credentials.clientId,
						}),
					});
					if (response.status === 200) { revoked = true; break; }
					if (response.status < 500 || attempt === 1) break;
					await new Promise((resolve) => setTimeout(resolve, 500));
				}
			}
		}
	} catch {
		// Local sign-out proceeds; the UI reports if remote revocation could not be confirmed.
	}
	await saveChatGptPlanCredentials({
		clientId: credentials.clientId,
		extAgentHostId: credentials.extAgentHostId,
		tokenType: "Bearer",
		scopes: [],
		email: credentials.email,
		subject: credentials.subject,
	});
	return revoked;
}

export async function getChatGptPlanStatus(): Promise<{ connected: false } | { connected: true; email: string; expiresAt: number }> {
	const credentials = await getChatGptPlanCredentials();
	return credentials?.accessToken && credentials.refreshToken && credentials.expiresAt
		? { connected: true, email: credentials.email, expiresAt: credentials.expiresAt }
		: { connected: false };
}

/** Return a current access token, rotating and persisting the refresh token when needed. */
export async function getChatGptPlanAccessToken(): Promise<string> {
	return db.transaction(async (tx) => {
		// Web and worker processes share rotating refresh tokens; serialize refreshes across both.
		await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('getcito.chatgpt-plan-oauth')::bigint)`);
		const row = await tx.query.providerAuth.findFirst({ where: eq(providerAuth.provider, PROVIDER_ID) });
		if (!row) throw new Error("Connect your ChatGPT plan in Settings > LLMs before using the OpenAI provider.");
		const credentials = decrypt<ChatGptPlanCredentials>(row.encryptedCredentials);
		const currentAccessToken = credentials.accessToken;
		const currentRefreshToken = credentials.refreshToken;
		if (!currentAccessToken || !currentRefreshToken) {
			throw new Error("Connect your ChatGPT plan in Settings > LLMs before using the OpenAI provider.");
		}
		if (credentials.expiresAt && credentials.expiresAt > Date.now() + 60_000) return currentAccessToken;

		const body = new URLSearchParams({
			grant_type: "refresh_token",
			client_id: credentials.clientId,
			refresh_token: currentRefreshToken,
			resource: RESOURCE,
		});
		const response = await fetch(TOKEN_URL, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body,
		});
		if (!response.ok) {
			throw new Error(`ChatGPT sign-in refresh failed (${response.status}). Reconnect ChatGPT in Settings > LLMs.`);
		}
		const refreshed = await response.json() as {
			access_token?: string;
			refresh_token?: string;
			id_token?: string;
			expires_in?: number;
			scope?: string;
		};
		if (!refreshed.access_token || !refreshed.expires_in) {
			throw new Error("ChatGPT sign-in refresh returned an incomplete token response. Reconnect ChatGPT in Settings > LLMs.");
		}
		const next: ChatGptPlanCredentials = {
			...credentials,
			accessToken: refreshed.access_token,
			refreshToken: refreshed.refresh_token ?? credentials.refreshToken,
			idToken: refreshed.id_token ?? credentials.idToken,
			expiresAt: Date.now() + refreshed.expires_in * 1000,
			scopes: refreshed.scope?.split(" ").filter(Boolean) ?? credentials.scopes,
		};
		if (!next.scopes.includes("chatgpt.tokens.use.direct")) {
			throw new Error("ChatGPT sign-in no longer grants model access. Reconnect ChatGPT in Settings > LLMs.");
		}
		await tx.update(providerAuth).set({ encryptedCredentials: encrypt(next), updatedAt: new Date() })
			.where(eq(providerAuth.provider, PROVIDER_ID));
		return refreshed.access_token;
	});
}
