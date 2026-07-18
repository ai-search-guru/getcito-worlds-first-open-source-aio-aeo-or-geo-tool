/**
 * Server-only deployment factory.
 *
 * Reads DEPLOYMENT_MODE from the environment and creates a Deployment
 * configuration object. The Deployment is now purely static config
 * (mode, features, branding) — all auth is handled by better-auth.
 *
 * The singleton is cached at module scope. On Vercel serverless this
 * persists across warm invocations, which is safe because the
 * Deployment object contains no request-scoped state.
 */
import { getDeploymentModeFromEnv } from "@workspace/config/env";
import type { Deployment } from "@workspace/config/types";
import { createLocalDeployment } from "@workspace/local";
import { createWhitelabelDeployment } from "@workspace/whitelabel";

let cached: Deployment | null = null;

export interface GetDeploymentOptions {
	env?: Record<string, string | undefined>;
}

export function getDeployment(options?: GetDeploymentOptions): Deployment {
	if (cached) return cached;

	const env = options?.env ?? process.env;
	const mode = getDeploymentModeFromEnv(env);

	switch (mode) {
		case "local":
			cached = createLocalDeployment(env);
			break;
		case "demo":
			cached = createLocalDeployment({ ...env, READ_ONLY: "true" });
			break;
		case "whitelabel":
			cached = createWhitelabelDeployment({ env });
			break;
		case "cloud":
			throw new Error("Cloud deployment mode is not yet implemented");
	}

	return cached!;
}

/**
 * Reset the cached deployment instance.
 * Only used in tests to switch between deployment modes.
 */
export function resetDeploymentCache(): void {
	cached = null;
}
