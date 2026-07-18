import type { DeploymentMode } from "./types";

/**
 * Canonical registry of every environment variable the apps read.
 *
 * This is the single source of truth for env var declarations. Tests in
 * env-registry.test.ts enforce that the two other declaration sites stay in
 * sync with it:
 * - turbo.json `globalEnv` (cache invalidation) must list exactly these names
 * - apps/web/src/env.d.ts must declare every entry (client vars in
 *   ImportMetaEnv, server vars in NodeJS.ProcessEnv)
 *
 * Adding or renaming a var = edit this file (+ the env.d.ts line and
 * turbo.json entry the failing test asks for).
 */

/** Where an env var is consumed. Client vars are baked into the browser bundle by Vite. */
type EnvVarScope = "server" | "client";

export interface EnvVarSpec {
	/** Variable name. `client` scope names must be VITE_-prefixed (enforced by test). */
	name: string;
	scope: EnvVarScope;
	/**
	 * - DeploymentMode[]: hard-required in those modes (startup validation reports it when missing)
	 * - "dynamic-scrape-targets": required only when SCRAPE_TARGETS references `provider`
	 * - "optional": never required at startup
	 */
	requiredBy: DeploymentMode[] | "dynamic-scrape-targets" | "optional";
	/** Only for requiredBy: "dynamic-scrape-targets" — the SCRAPE_TARGETS provider id that needs this key. */
	provider?: string;
	/**
	 * Set for vars read only by the marketing site (apps/www). They stay in
	 * turbo.json globalEnv but are excluded from the apps/web env.d.ts check,
	 * and must never be required by the product (enforced by test).
	 */
	wwwOnly?: boolean;
	description: string;
}

/** Modes with startup env validation. "cloud" requirements are TODO and intentionally excluded. */
const VALIDATED_MODES: DeploymentMode[] = ["local", "demo", "whitelabel"];

export const ENV_REGISTRY: EnvVarSpec[] = [
	{
		name: "DATABASE_URL",
		scope: "server",
		requiredBy: VALIDATED_MODES,
		description: "PostgreSQL connection string.",
	},
	{
		name: "APP_URL",
		scope: "server",
		requiredBy: "optional",
		description: "Public base URL of the web app (written by `Getcito init`).",
	},
	{
		name: "BETTER_AUTH_SECRET",
		scope: "server",
		requiredBy: VALIDATED_MODES,
		description: "Session cookie encryption secret.",
	},
	{
		name: "AUTH0_DOMAIN",
		scope: "server",
		requiredBy: "optional",
		description: "Auth0 tenant domain (used for whitelabel logout redirects).",
	},
	{
		name: "AUTH0_CLIENT_ID",
		scope: "server",
		requiredBy: ["whitelabel"],
		description: "Auth0 client ID.",
	},
	{
		name: "AUTH0_CLIENT_SECRET",
		scope: "server",
		requiredBy: ["whitelabel"],
		description: "Auth0 client secret.",
	},
	{
		name: "AUTH0_AUDIENCE",
		scope: "server",
		requiredBy: "optional",
		description: "Auth0 API audience.",
	},
	{
		name: "AUTH0_SCOPE",
		scope: "server",
		requiredBy: "optional",
		description: "Auth0 OAuth scopes.",
	},
	{
		name: "AUTH0_MGMT_API_DOMAIN",
		scope: "server",
		requiredBy: ["whitelabel"],
		description: "Auth0 Management API domain.",
	},
	{
		name: "UPSTASH_REDIS_REST_URL",
		scope: "server",
		requiredBy: "optional",
		wwwOnly: true,
		description: "Upstash Redis REST URL (www caching: status, GitHub stars/releases).",
	},
	{
		name: "UPSTASH_REDIS_REST_TOKEN",
		scope: "server",
		requiredBy: "optional",
		wwwOnly: true,
		description: "Upstash Redis REST token.",
	},
	{
		name: "UPSTASH_REDIS_ENDPOINT",
		scope: "server",
		requiredBy: "optional",
		wwwOnly: true,
		description: "Upstash Redis endpoint.",
	},
	{
		name: "DATAFORSEO_LOGIN",
		scope: "server",
		requiredBy: "dynamic-scrape-targets",
		provider: "dataforseo",
		description: "DataForSEO account login.",
	},
	{
		name: "DATAFORSEO_PASSWORD",
		scope: "server",
		requiredBy: "dynamic-scrape-targets",
		provider: "dataforseo",
		description: "DataForSEO account password.",
	},
	{
		name: "OPENAI_API_KEY",
		scope: "server",
		requiredBy: "dynamic-scrape-targets",
		provider: "openai-api",
		description: "OpenAI API key.",
	},
	{
		name: "ANTHROPIC_API_KEY",
		scope: "server",
		requiredBy: "dynamic-scrape-targets",
		provider: "anthropic-api",
		description: "Anthropic API key.",
	},
	{
		name: "MISTRAL_API_KEY",
		scope: "server",
		requiredBy: "dynamic-scrape-targets",
		provider: "mistral-api",
		description: "Mistral API key.",
	},
	{
		name: "SCRAPE_TARGETS",
		scope: "server",
		requiredBy: VALIDATED_MODES,
		description:
			"Comma-separated model:provider[:version][:online] entries. Example: chatgpt:olostep:online,google-ai-mode:olostep:online,copilot:olostep:online",
	},
	{
		name: "OLOSTEP_API_KEY",
		scope: "server",
		requiredBy: "dynamic-scrape-targets",
		provider: "olostep",
		description: "Olostep API key.",
	},
	{
		name: "BRIGHTDATA_API_TOKEN",
		scope: "server",
		requiredBy: "dynamic-scrape-targets",
		provider: "brightdata",
		description: "BrightData API token.",
	},
	{
		name: "OXYLABS_USERNAME",
		scope: "server",
		requiredBy: "dynamic-scrape-targets",
		provider: "oxylabs",
		description: "Oxylabs Web Scraper API username.",
	},
	{
		name: "OXYLABS_PASSWORD",
		scope: "server",
		requiredBy: "dynamic-scrape-targets",
		provider: "oxylabs",
		description: "Oxylabs Web Scraper API password.",
	},
	{
		name: "OPENROUTER_API_KEY",
		scope: "server",
		requiredBy: "dynamic-scrape-targets",
		provider: "openrouter",
		description: "OpenRouter API key.",
	},
	{
		name: "DEPLOYMENT_MODE",
		scope: "server",
		requiredBy: VALIDATED_MODES,
		description: "Deployment mode: local, demo, whitelabel, or cloud.",
	},
	{
		name: "ADMIN_AUTH0_SUB",
		scope: "server",
		requiredBy: "optional",
		description: "Auth0 subject claim granted admin access.",
	},
	{
		name: "ADMIN_API_KEYS",
		scope: "server",
		requiredBy: "optional",
		description: "Comma-separated bearer tokens accepted by the admin API.",
	},
	{
		name: "DEFAULT_BRAND_DOMAINS",
		scope: "server",
		requiredBy: "optional",
		description: "Comma-separated domains added as default brands.",
	},
	{
		name: "ENVIRONMENT",
		scope: "server",
		requiredBy: "optional",
		description: "Environment name reported to Sentry (e.g. production).",
	},
	{
		name: "VITE_DEPLOYMENT_MODE",
		scope: "client",
		requiredBy: "optional",
		description: "Client-visible copy of DEPLOYMENT_MODE.",
	},
	{
		name: "VITE_APP_NAME",
		scope: "client",
		requiredBy: ["whitelabel"],
		description: "Application display name (e.g., 'Acme AI Search').",
	},
	{
		name: "VITE_APP_ICON",
		scope: "client",
		requiredBy: ["whitelabel"],
		description: "Application icon URL (must be an external URL, e.g., 'https://cdn.example.com/icon.png').",
	},
	{
		name: "VITE_APP_URL",
		scope: "client",
		requiredBy: ["whitelabel"],
		description: "Application URL (e.g., 'https://ai.example.com/').",
	},
	{
		name: "VITE_APP_PARENT_NAME",
		scope: "client",
		requiredBy: ["whitelabel"],
		description: "Parent application name (e.g., 'Acme').",
	},
	{
		name: "VITE_APP_PARENT_URL",
		scope: "client",
		requiredBy: ["whitelabel"],
		description: "Parent application URL (e.g., 'https://app.example.com/').",
	},
	{
		name: "VITE_OPTIMIZATION_URL_TEMPLATE",
		scope: "client",
		requiredBy: ["whitelabel"],
		description:
			"URL template for optimization with placeholders {brandId}, {prompt}, {webQuery} (e.g., 'https://app.example.com/optimize?org_id={brandId}&prompt={prompt}&web_query={webQuery}').",
	},
	{
		name: "VITE_PLAUSIBLE_DOMAIN",
		scope: "client",
		requiredBy: "optional",
		description: "Plausible analytics domain.",
	},
	{
		name: "VITE_CLARITY_PROJECT_ID",
		scope: "client",
		requiredBy: "optional",
		description: "Microsoft Clarity project ID.",
	},
	{
		name: "VITE_ONBOARDING_REDIRECT_URL_TEMPLATE",
		scope: "client",
		requiredBy: "optional",
		description:
			"Redirect URL template (with {brandId} placeholder) for sending users back to the parent app after onboarding.",
	},
	{
		name: "VITE_AUTH0_DOMAIN",
		scope: "client",
		requiredBy: "optional",
		description: "Auth0 domain exposed to the client.",
	},
	{
		name: "VITE_AUTH0_CLIENT_ID",
		scope: "client",
		requiredBy: "optional",
		description: "Auth0 client ID exposed to the client.",
	},
	{
		name: "BLOB_READ_WRITE_TOKEN",
		scope: "server",
		requiredBy: "optional",
		wwwOnly: true,
		description: "Vercel Blob token (www competitor screenshots).",
	},
	{
		name: "DBOS_SYSTEM_DATABASE_URL",
		scope: "server",
		requiredBy: "optional",
		description: "Override for the DBOS system database URL (read by the DBOS runtime).",
	},
	{
		name: "SENTRY_DSN",
		scope: "server",
		requiredBy: "optional",
		description: "Sentry DSN for server-side error reporting.",
	},
	{
		name: "SENTRY_ORG",
		scope: "server",
		requiredBy: "optional",
		description: "Sentry org slug for sourcemap upload at build time.",
	},
	{
		name: "SENTRY_PROJECT",
		scope: "server",
		requiredBy: "optional",
		description: "Sentry project slug for sourcemap upload at build time.",
	},
	{
		name: "SENTRY_AUTH_TOKEN",
		scope: "server",
		requiredBy: "optional",
		description: "Sentry auth token for sourcemap upload at build time.",
	},
	{
		name: "VITE_SENTRY_DSN",
		scope: "client",
		requiredBy: "optional",
		description: "Sentry DSN for browser error reporting.",
	},
	{
		name: "VITE_POSTHOG_KEY",
		scope: "client",
		requiredBy: "optional",
		description: "PostHog project API key override.",
	},
	{
		name: "VITE_CHART_COLORS",
		scope: "client",
		requiredBy: "optional",
		description: "Comma-separated chart color palette override.",
	},
	{
		name: "DISABLE_TELEMETRY",
		scope: "server",
		requiredBy: "optional",
		description: "Set to any value to disable telemetry.",
	},
];
