/**
 * @workspace/whitelabel - Whitelabel deployment package
 *
 * Provides whitelabel-mode implementation:
 * - createWhitelabelDeployment() factory for static config
 * - OptimizeButton component
 * - Auth hooks (exported via ./auth-hooks subpath) for better-auth integration
 */

export {
	createWhitelabelDeployment,
	type CreateWhitelabelDeploymentOptions,
} from "./deployment";

export {
	OptimizeButton,
	type OptimizeButtonProps,
} from "./components/optimize-button";
