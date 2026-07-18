/**
 * Mode-compatibility boot smoke test (issue #341).
 *
 * For each non-cloud DEPLOYMENT_MODE, proves the boot path resolves:
 *   1. env validation     — the canonical minimal env satisfies the registry
 *   2. factory resolution — getDeployment() returns the expected mode
 *   3. auth initialization — createAuth() constructs with the mode's options
 *
 * This guards the getcito-cloud build-out: open-source, demo, and whitelabel
 * deployments must keep booting unchanged while cloud lands (issue #8).
 *
 * Runs the real shared-package boot path via tsx — no build, no live DB.
 * createAuth() only constructs the better-auth instance (drizzle's pg pool is
 * lazy), so a dummy DATABASE_URL is enough.
 *
 * Lives in apps/web because that package depends on every @workspace/* package
 * this script boots; the script itself imports only @workspace/* entrypoints
 * (never apps/web's @/ alias), so tsx resolves it with no app bundling.
 *
 * Usage (from repo root):
 *   pnpm -C apps/web exec tsx scripts/smoke-deployment-mode.ts            # all modes
 *   pnpm -C apps/web exec tsx scripts/smoke-deployment-mode.ts whitelabel # one mode
 *
 * Cloud is intentionally skipped: the factory throws "not yet implemented"
 * and ENV_REQUIREMENTS.cloud is empty until #342.
 */
import type { DeploymentMode } from "@workspace/config/types";
import { getDeployment, resetDeploymentCache } from "@workspace/deployment";
import { getEnvValidationState } from "@workspace/config/env";

type SmokeMode = Exclude<DeploymentMode, "cloud">;

const SMOKE_MODES: SmokeMode[] = ["local", "demo", "whitelabel"];

/**
 * Canonical minimal env that should satisfy each mode's startup requirements.
 *
 * Values are dummies — nothing here connects to a real service. If a PR adds a
 * new hard-required registry var without updating this map, env validation
 * below fails and the guard catches it.
 *
 * DATABASE_URL is never connected; APP_URL / VITE_APP_URL are read by
 * createAuth(); the AUTH0_* vars are read by getWhitelabelAuthOptions() and the
 * whitelabel env requirements. SCRAPE_TARGETS=chatgpt:olostep:online pulls in
 * the OLOSTEP_API_KEY provider-key requirement.
 */
const SHARED_ENV: Record<string, string> = {
	DATABASE_URL: "postgres://smoke:smoke@127.0.0.1:5432/smoke",
	BETTER_AUTH_SECRET: "smoke-test-better-auth-secret-0000000000",
	SCRAPE_TARGETS: "chatgpt:olostep:online",
	OLOSTEP_API_KEY: "smoke-olostep-key",
};

const MINIMAL_ENV: Record<SmokeMode, Record<string, string>> = {
	local: {
		...SHARED_ENV,
		DEPLOYMENT_MODE: "local",
		APP_URL: "http://localhost:3000",
	},
	demo: {
		...SHARED_ENV,
		DEPLOYMENT_MODE: "demo",
		APP_URL: "http://localhost:3000",
	},
	whitelabel: {
		...SHARED_ENV,
		DEPLOYMENT_MODE: "whitelabel",
		AUTH0_DOMAIN: "smoke.auth0.com",
		AUTH0_CLIENT_ID: "smoke-client-id",
		AUTH0_CLIENT_SECRET: "smoke-client-secret",
		AUTH0_MGMT_API_DOMAIN: "smoke.auth0.com",
		VITE_APP_NAME: "Smoke App",
		VITE_APP_ICON: "https://example.com/icon.png",
		VITE_APP_URL: "https://smoke.example.com/",
		VITE_APP_PARENT_NAME: "Smoke Parent",
		VITE_APP_PARENT_URL: "https://parent.example.com/",
		VITE_OPTIMIZATION_URL_TEMPLATE: "https://parent.example.com/optimize?org_id={brandId}&prompt={prompt}",
	},
};

/** Every env key this script manages, so we can clear leakage between modes. */
const MANAGED_KEYS = [...new Set(Object.values(MINIMAL_ENV).flatMap((env) => Object.keys(env)))];

/**
 * Replace the managed env vars in process.env with this mode's values.
 * createAuth(), db.ts, and getWhitelabelAuthOptions() read the global
 * process.env, so the mode's env must be live there before they run.
 */
function applyEnv(mode: SmokeMode): Record<string, string> {
	for (const key of MANAGED_KEYS) delete process.env[key];
	const env = MINIMAL_ENV[mode];
	for (const [key, value] of Object.entries(env)) process.env[key] = value;
	return env;
}

function getAuthOptions(mode: SmokeMode, getWhitelabelAuthOptions: () => unknown) {
	switch (mode) {
		case "demo":
			return { disableSignUp: true };
		case "whitelabel":
			return getWhitelabelAuthOptions();
		default:
			// Mirrors apps/web's getDeploymentAuthOptions default branch. Local's
			// real databaseHooks fire only at user-create runtime, not at init, so
			// constructing with no options is faithful for a boot smoke.
			return undefined;
	}
}

async function smokeMode(mode: SmokeMode): Promise<string[]> {
	const failures: string[] = [];
	const env = applyEnv(mode);

	// 1. env validation
	const validation = getEnvValidationState(env);
	if (!validation.isValid) {
		failures.push(`env invalid — missing: ${validation.missing.map((m) => m.id).join(", ")}`);
	} else if (validation.mode !== mode) {
		failures.push(`env validated as mode "${validation.mode}", expected "${mode}"`);
	}

	// 2. deployment factory resolution
	try {
		resetDeploymentCache();
		const deployment = getDeployment({ env });
		if (deployment.mode !== mode) {
			failures.push(`factory resolved mode "${deployment.mode}", expected "${mode}"`);
		}
		if (!deployment.features || !deployment.branding) {
			failures.push("factory returned an incomplete deployment (missing features/branding)");
		}
	} catch (error) {
		failures.push(`factory threw: ${(error as Error).message}`);
	}

	// 3. auth initialization — dynamic import so DATABASE_URL is live before db.ts runs
	try {
		const { createAuth } = await import("@workspace/lib/auth/server");
		const { getWhitelabelAuthOptions } = await import("@workspace/whitelabel/auth-hooks");
		const options = getAuthOptions(mode, getWhitelabelAuthOptions);
		// biome-ignore lint/suspicious/noExplicitAny: options shape varies per mode
		const auth = createAuth(options as any);
		if (typeof auth.handler !== "function" || typeof auth.api !== "object") {
			failures.push("auth initialized without a handler/api");
		}
	} catch (error) {
		failures.push(`auth init threw: ${(error as Error).message}`);
	}

	return failures;
}

async function main(): Promise<void> {
	const requested = process.argv[2];
	if (requested && !SMOKE_MODES.includes(requested as SmokeMode)) {
		console.error(`Unknown mode "${requested}". Expected one of: ${SMOKE_MODES.join(", ")}`);
		process.exit(2);
	}
	const modes = requested ? [requested as SmokeMode] : SMOKE_MODES;

	let failed = false;
	for (const mode of modes) {
		const failures = await smokeMode(mode);
		if (failures.length === 0) {
			console.log(`✓ ${mode}: env valid, factory resolved, auth initialized`);
		} else {
			failed = true;
			console.error(`✗ ${mode}:`);
			for (const failure of failures) console.error(`    - ${failure}`);
		}
	}

	if (failed) {
		console.error("\nMode-compatibility smoke FAILED.");
		process.exit(1);
	}
	console.log(`\nMode-compatibility smoke passed for: ${modes.join(", ")}`);
}

main().catch((error) => {
	console.error("Smoke runner crashed:", error);
	process.exit(1);
});
