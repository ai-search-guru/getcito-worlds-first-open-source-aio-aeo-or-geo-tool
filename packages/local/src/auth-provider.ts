/**
 * @workspace/local - Local development deployment
 *
 * Creates a Deployment for local development.
 * When READ_ONLY=true, acts as a demo deployment with write operations blocked.
 *
 * Auth is fully handled by better-auth — this only provides static config.
 */
import { DEFAULT_APP_ICON, DEFAULT_APP_NAME, DEFAULT_APP_URL, DEFAULT_CHART_COLORS } from "@workspace/config/constants";
import { getEnv } from "@workspace/config/env";
import type { Deployment } from "@workspace/config/types";

export function createLocalDeployment(env: Record<string, string | undefined> = process.env): Deployment {
	const readOnly = env.READ_ONLY === "true";

	return {
		mode: readOnly ? "demo" : "local",
		features: {
			readOnly,
			showOptimizeButton: false,
			supportsMultiOrg: true,
			canCreateBrands: !readOnly,
		},
		branding: {
			name: getEnv("APP_NAME", DEFAULT_APP_NAME, env),
			icon: getEnv("APP_ICON", DEFAULT_APP_ICON, env),
			url: getEnv("APP_URL", DEFAULT_APP_URL, env),
			parentName: env.APP_PARENT_NAME,
			parentUrl: env.APP_PARENT_URL,
			chartColors: DEFAULT_CHART_COLORS,
		},
	};
}
