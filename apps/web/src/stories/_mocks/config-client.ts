/**
 * Mock for @/lib/config/client — provides a controllable clientConfig.
 *
 * Components import `clientConfig` directly from this module.
 * Stories call `setMockClientConfig()` before rendering to control values.
 */

export type DeploymentMode = "whitelabel" | "local" | "demo" | "cloud";

export interface FeaturesConfig {
	readOnly: boolean;
	showOptimizeButton: boolean;
	supportsMultiOrg: boolean;
	canCreateBrands: boolean;
}

export interface BrandingConfig {
	name: string;
	icon?: string;
	url?: string;
	parentName?: string;
	parentUrl?: string;
	onboardingRedirectUrl?: string;
	optimizationUrlTemplate?: string;
	chartColors: string[];
}

export interface AnalyticsConfig {
	plausibleDomain?: string;
	clarityProjectId?: string;
}

export interface ClientConfig {
	mode: DeploymentMode;
	features: FeaturesConfig;
	branding: BrandingConfig;
	analytics: AnalyticsConfig;
	defaultDelayHours: number;
	canRegister: boolean;
	hasUsers: boolean;
}

const DEFAULT_CHART_COLORS = ["#2563eb", "#efb118", "#3ca951", "#ff725c", "#a463f2", "#ff8ab7", "#38b2ac", "#9c6b4e"];

// ---------------------------------------------------------------------------
// Module-level config that stories can mutate
// ---------------------------------------------------------------------------

let _config: ClientConfig = {
	mode: "local",
	features: {
		readOnly: false,
		showOptimizeButton: false,
		supportsMultiOrg: false,
		canCreateBrands: false,
	},
	branding: {
		name: "Getcito",
		chartColors: DEFAULT_CHART_COLORS,
	},
	analytics: {},
	defaultDelayHours: 24,
	canRegister: false,
	hasUsers: true,
};

export function setMockClientConfig(config: ClientConfig) {
	_config = config;
}

/**
 * Proxy-like object that always reads from the current `_config`.
 * This ensures that stories calling `setMockClientConfig` before render
 * will have the updated config read by child components.
 */
export const clientConfig: ClientConfig = new Proxy({} as ClientConfig, {
	get(_target, prop: string) {
		return (_config as unknown as Record<string, unknown>)[prop];
	},
});

export { _config as getDeployment };
