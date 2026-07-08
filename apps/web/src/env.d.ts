/// <reference types="vite/client" />

// Every var here must have an entry in packages/config/src/env-registry.ts
// (enforced by env-registry.test.ts).

interface ImportMetaEnv {
	// Deployment mode
	readonly VITE_DEPLOYMENT_MODE: string;

	// Branding (whitelabel only - local/demo use server-side defaults)
	readonly VITE_APP_NAME?: string;
	readonly VITE_APP_ICON?: string;
	readonly VITE_APP_URL?: string;
	readonly VITE_APP_PARENT_NAME?: string;
	readonly VITE_APP_PARENT_URL?: string;
	readonly VITE_OPTIMIZATION_URL_TEMPLATE?: string;
	readonly VITE_ONBOARDING_REDIRECT_URL_TEMPLATE?: string;
	readonly VITE_CHART_COLORS?: string;

	// Auth0 (whitelabel)
	readonly VITE_AUTH0_DOMAIN?: string;
	readonly VITE_AUTH0_CLIENT_ID?: string;

	// Analytics
	readonly VITE_PLAUSIBLE_DOMAIN?: string;
	readonly VITE_CLARITY_PROJECT_ID?: string;
	readonly VITE_POSTHOG_KEY?: string;

	// Sentry
	readonly VITE_SENTRY_DSN?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}

// Server-side environment variables (accessed via process.env in server functions)
// and Vite define globals
declare global {
	// App version injected by Vite define
	const __APP_VERSION__: string;
	namespace NodeJS {
		interface ProcessEnv {
			readonly DEPLOYMENT_MODE: string;
			readonly DATABASE_URL: string;
			readonly APP_URL?: string;
			readonly SCRAPE_TARGETS?: string;
			readonly OPENAI_API_KEY: string;
			readonly ANTHROPIC_API_KEY: string;
			readonly MISTRAL_API_KEY?: string;
			readonly OPENROUTER_API_KEY?: string;
			readonly OLOSTEP_API_KEY?: string;
			readonly BRIGHTDATA_API_TOKEN?: string;
			readonly OXYLABS_USERNAME?: string;
			readonly OXYLABS_PASSWORD?: string;
			readonly DATAFORSEO_LOGIN: string;
			readonly DATAFORSEO_PASSWORD: string;
			readonly BETTER_AUTH_SECRET?: string;
			readonly AUTH0_DOMAIN?: string;
			readonly AUTH0_AUDIENCE?: string;
			readonly AUTH0_SCOPE?: string;
			readonly AUTH0_MGMT_API_DOMAIN?: string;
			readonly AUTH0_CLIENT_ID?: string;
			readonly AUTH0_CLIENT_SECRET?: string;
			readonly ADMIN_AUTH0_SUB?: string;
			readonly ADMIN_API_KEYS?: string;
			readonly DEFAULT_BRAND_DOMAINS?: string;
			readonly ENVIRONMENT?: string;
			readonly DBOS_SYSTEM_DATABASE_URL?: string;
			readonly SENTRY_DSN?: string;
			readonly SENTRY_ORG?: string;
			readonly SENTRY_PROJECT?: string;
			readonly SENTRY_AUTH_TOKEN?: string;
			readonly DISABLE_TELEMETRY?: string;
		}
	}
}

export {};
