/**
 * Test mock helpers for deployment configuration.
 *
 * Provides factory functions to create mock Deployments for each deployment
 * mode, making it easy to write tests against different feature flag scenarios.
 *
 * Auth checks (admin, org access, etc.) are handled by better-auth and are
 * tested via the auth helpers, not through the Deployment interface.
 */
import type { Deployment, FeaturesConfig } from "@workspace/config/types";

// ============================================================================
// Feature flag presets (match the real deployment implementations)
// ============================================================================

export const LOCAL_FEATURES: FeaturesConfig = {
	readOnly: false,
	showOptimizeButton: false,
	supportsMultiOrg: true,
	canCreateBrands: true,
};

export const DEMO_FEATURES: FeaturesConfig = {
	readOnly: true,
	showOptimizeButton: false,
	supportsMultiOrg: true,
	canCreateBrands: false,
};

export const WHITELABEL_FEATURES: FeaturesConfig = {
	readOnly: false,
	showOptimizeButton: true,
	supportsMultiOrg: true,
	canCreateBrands: false,
};

// ============================================================================
// Mock Session (for tests that need a user object)
// ============================================================================

export function createMockSession(overrides: Partial<{ id: string; name: string; email: string; image: string }> = {}) {
	return {
		user: {
			id: overrides.id ?? "test-user-id",
			name: overrides.name ?? "Test User",
			email: overrides.email ?? "test@example.com",
			image: overrides.image,
		},
	};
}

// ============================================================================
// Mock Deployment
// ============================================================================

export type DeploymentMode = "local" | "demo" | "whitelabel";

const FEATURES_BY_MODE: Record<DeploymentMode, FeaturesConfig> = {
	local: LOCAL_FEATURES,
	demo: DEMO_FEATURES,
	whitelabel: WHITELABEL_FEATURES,
};

export interface MockDeploymentOptions {
	featureOverrides?: Partial<FeaturesConfig>;
}

export function createMockDeployment(mode: DeploymentMode, options: MockDeploymentOptions = {}): Deployment {
	return {
		mode,
		features: { ...FEATURES_BY_MODE[mode], ...options.featureOverrides },
		branding: {
			name: "Test App",
			icon: "/icon.svg",
			url: "http://localhost:3000",
			chartColors: ["#3b82f6", "#10b981", "#f59e0b"],
		},
	};
}
