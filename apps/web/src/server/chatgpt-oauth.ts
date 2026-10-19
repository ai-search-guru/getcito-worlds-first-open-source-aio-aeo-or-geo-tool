import { createHash, createPublicKey, randomBytes, randomUUID, verify } from "node:crypto";
import { checkOrgAccess, getAuthSession } from "@/lib/auth/helpers";
import {
	consumeChatGptOAuthAttempt,
	getChatGptPlanCredentials,
	saveChatGptOAuthAttempt,
	saveChatGptPlanCredentials,
	type ChatGptPlanCredentials,
} from "@workspace/lib/chatgpt-plan-auth";

const AUTHORIZE_URL = "https://auth.openai.com/api/accounts/authorize";
const TOKEN_URL = "https://auth.openai.com/api/accounts/oauth/token";
const RESOURCE = "https://api.openai.com/v1";
const SCOPES = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";

export function requireLocalChatGptAuth(): void {
	if (process.env.DEPLOYMENT_MODE !== "local") {
		throw new Error("Sign in with ChatGPT is available only for local deployments.");
	}
}

function isLoopback(hostname: string): boolean {
	const normalized = hostname.toLowerCase();
	return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "[::1]";
}

function safeReturnOrigin(origin: string): string | null {
	try {
		const url = new URL(origin);
		if (url.protocol !== "http:" || !isLoopback(url.hostname)) return null;
		return url.origin;
	} catch {
		return null;
	}
}

export async function createChatGptAuthorization(request: Request, brandId: string): Promise<string> {
	requireLocalChatGptAuth();
	const session = await getAuthSession();
	if (!session) throw new Error("Sign in to GetCito before connecting ChatGPT.");
	if (!(await checkOrgAccess(session.user.id, brandId))) throw new Error("You do not have access to this brand.");

	const requestUrl = new URL(request.url);
	const returnOrigin = safeReturnOrigin(requestUrl.origin);
	if (!returnOrigin) throw new Error("Open GetCito from localhost to connect ChatGPT.");
	const port = requestUrl.port || "80";
	const redirectUri = `http://127.0.0.1:${port}/api/openai/chatgpt/callback`;
	const existing = await getChatGptPlanCredentials();
	const state = randomBytes(32).toString("base64url");
	const nonce = randomBytes(32).toString("base64url");
	const codeVerifier = randomBytes(48).toString("base64url");
	const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
	const attempt = {
		clientId: existing?.clientId ?? "dynamic_agent_client",
		newRegistration: !existing,
		codeVerifier,
		nonce,
		redirectUri,
		extAgentHostId: existing?.extAgentHostId ?? `urn:uuid:${randomUUID()}`,
		brandId,
		returnOrigin,
		returnPath: `/app/${encodeURIComponent(brandId)}/settings/llms`,
		expectedSubject: existing?.subject,
	};
	await saveChatGptOAuthAttempt(state, attempt);

	const authorize = new URL(AUTHORIZE_URL);
	const params = new URLSearchParams({
		client_id: attempt.clientId,
		response_type: "code",
		redirect_uri: redirectUri,
		scope: SCOPES,
		resource: RESOURCE,
		state,
		nonce,
		code_challenge_method: "S256",
		code_challenge: codeChallenge,
		ext_agent_host_id: attempt.extAgentHostId,
	});
	if (attempt.newRegistration) params.set("agent_name_hint", "GetCito");
	if (existing?.idToken) params.set("id_token_hint", existing.idToken);
	if (existing?.email) params.set("login_hint", existing.email);
	authorize.search = params.toString();
	return authorize.toString();
}

async function validateIdToken(idToken: string, clientId: string, expectedNonce: string): Promise<{ subject: string; email: string }> {
	const parts = idToken.split(".");
	if (parts.length !== 3) throw new Error("ChatGPT returned an invalid identity token.");
	const header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as { alg?: string; kid?: string };
	const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Record<string, unknown>;
	if (header.alg !== "RS256" || !header.kid) throw new Error("ChatGPT returned an unsupported identity token.");
	const discoveryResponse = await fetch("https://auth.openai.com/.well-known/openid-configuration");
	if (!discoveryResponse.ok) throw new Error("Could not validate ChatGPT identity metadata.");
	const discovery = await discoveryResponse.json() as { jwks_uri?: string };
	if (!discovery.jwks_uri) throw new Error("ChatGPT identity metadata did not include signing keys.");
	const jwksResponse = await fetch(discovery.jwks_uri);
	if (!jwksResponse.ok) throw new Error("Could not retrieve ChatGPT identity signing keys.");
	const jwks = await jwksResponse.json() as { keys?: Array<Record<string, unknown>> };
	const jwk = jwks.keys?.find((key) => key.kid === header.kid && key.kty === "RSA");
	if (!jwk) throw new Error("ChatGPT identity token was signed with an unknown key.");
	const signedData = Buffer.from(`${parts[0]}.${parts[1]}`);
	const signature = Buffer.from(parts[2], "base64url");
	if (!verify("RSA-SHA256", signedData, createPublicKey({ key: jwk as JsonWebKey, format: "jwk" }), signature)) {
		throw new Error("ChatGPT identity token signature did not validate.");
	}
	const audience = claims.aud;
	if (
		claims.iss !== "https://auth.openai.com" ||
		!(audience === clientId || (Array.isArray(audience) && audience.includes(clientId))) ||
		typeof claims.exp !== "number" || claims.exp * 1000 <= Date.now() ||
		claims.nonce !== expectedNonce ||
		typeof claims.sub !== "string" ||
		typeof claims.email !== "string"
	) {
		throw new Error("ChatGPT identity did not match the sign-in request.");
	}
	return { subject: claims.sub, email: claims.email };
}

export async function finishChatGptAuthorization(request: Request): Promise<string> {
	requireLocalChatGptAuth();
	const url = new URL(request.url);
	const state = url.searchParams.get("state");
	if (!state) throw new Error("ChatGPT sign-in callback did not include state.");
	const attempt = await consumeChatGptOAuthAttempt(state);
	if (!attempt) throw new Error("ChatGPT sign-in expired or could not be matched to its request. Try again.");
	const target = new URL(attempt.returnPath, attempt.returnOrigin);
	const error = url.searchParams.get("error");
	if (error) {
		target.searchParams.set("chatgptAuth", error === "access_denied" ? "cancelled" : "failed");
		return target.toString();
	}
	const code = url.searchParams.get("code");
	const callbackClientId = url.searchParams.get("client_id");
	const clientId = attempt.newRegistration ? callbackClientId : attempt.clientId;
	if (!code || !clientId || (callbackClientId && callbackClientId !== clientId)) {
		target.searchParams.set("chatgptAuth", "failed");
		return target.toString();
	}
	const tokenResponse = await fetch(TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "authorization_code",
			client_id: clientId,
			code,
			code_verifier: attempt.codeVerifier,
			redirect_uri: attempt.redirectUri,
			resource: RESOURCE,
		}),
	});
	if (!tokenResponse.ok) {
		target.searchParams.set("chatgptAuth", "failed");
		return target.toString();
	}
	const tokens = await tokenResponse.json() as {
		access_token?: string;
		refresh_token?: string;
		id_token?: string;
		expires_in?: number;
		scope?: string;
		token_type?: string;
	};
	const scopes = tokens.scope?.split(" ").filter(Boolean) ?? [];
	if (
		!tokens.access_token || !tokens.refresh_token || !tokens.id_token || !tokens.expires_in ||
		tokens.token_type?.toLowerCase() !== "bearer" || !scopes.includes("chatgpt.tokens.use.direct")
	) {
		target.searchParams.set("chatgptAuth", "failed");
		return target.toString();
	}
	const identity = await validateIdToken(tokens.id_token, clientId, attempt.nonce);
	if (attempt.expectedSubject && attempt.expectedSubject !== identity.subject) {
		target.searchParams.set("chatgptAuth", "failed");
		return target.toString();
	}
	const credentials: ChatGptPlanCredentials = {
		clientId,
		extAgentHostId: attempt.extAgentHostId,
		idToken: tokens.id_token,
		accessToken: tokens.access_token,
		refreshToken: tokens.refresh_token,
		tokenType: "Bearer",
		expiresAt: Date.now() + tokens.expires_in * 1000,
		scopes,
		email: identity.email,
		subject: identity.subject,
	};
	await saveChatGptPlanCredentials(credentials);
	target.searchParams.set("chatgptAuth", "connected");
	return target.toString();
}
