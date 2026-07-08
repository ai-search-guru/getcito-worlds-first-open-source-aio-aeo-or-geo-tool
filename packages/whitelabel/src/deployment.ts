/**
 * Whitelabel deployment factory.
 *
 * Creates a Deployment with whitelabel-specific branding and feature flags.
 * Auth is fully handled by better-auth (SSO via sso() plugin, org sync
 * via auth-hooks.ts databaseHooks).
 */
import { DEFAULT_CHART_COLORS } from "@workspace/config/constants";
import { requireEnv } from "@workspace/config/env";
import type { Deployment } from "@workspace/config/types";

export interface CreateWhitelabelDeploymentOptions {
	env: Record<string, string | undefined>;
}

function createOnboardingRedirectUrl(template: string | undefined) {
	if (!template) return undefined;
	return (brandId: string) => template.replace("{brandId}", brandId);
}

function parseChartColors(raw: string | undefined): string[] | undefined {
	if (!raw) return undefined;
	const colors = raw
		.split(",")
		.map((c) => c.trim())
		.filter(Boolean);
	return colors.length > 0 ? colors : undefined;
}

export function createWhitelabelDeployment(
	options: CreateWhitelabelDeploymentOptions,
): Deployment {
	const { env } = options;

	return {
		mode: "whitelabel",
		features: {
			readOnly: false,
			showOptimizeButton: true,
			supportsMultiOrg: true,
			canCreateBrands: true,
		},
		branding: {
			name: requireEnv("VITE_APP_NAME", env),
			icon: requireEnv("VITE_APP_ICON", env),
			url: requireEnv("VITE_APP_URL", env),
			parentName: env.VITE_APP_PARENT_NAME,
			parentUrl: env.VITE_APP_PARENT_URL,
			onboardingRedirectUrl: createOnboardingRedirectUrl(env.VITE_ONBOARDING_REDIRECT_URL_TEMPLATE),
			onboardingRedirectUrlTemplate: env.VITE_ONBOARDING_REDIRECT_URL_TEMPLATE,
			optimizationUrlTemplate: requireEnv("VITE_OPTIMIZATION_URL_TEMPLATE", env),
			chartColors: parseChartColors(env.VITE_CHART_COLORS) ?? DEFAULT_CHART_COLORS,
		},
	};
}
