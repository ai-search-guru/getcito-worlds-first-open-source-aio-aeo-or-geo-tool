import { ENV_REGISTRY } from "./env-registry";
import { parseScrapeTargets } from "./scrape-targets";
import type { DeploymentMode, EnvRequirement } from "./types";

export type EnvMap = Record<string, string | undefined>;

export interface MissingEnvVar {
	id: string;
	label: string;
	description?: string;
}

/**
 * Check if an environment variable has a non-empty value
 */
export const hasValue = (value: string | undefined): boolean => typeof value === "string" && value.trim().length > 0;

/**
 * Create a requirement checker that requires all specified keys to have values
 */
export const requireAll =
	(keys: string[]) =>
	(env: EnvMap): boolean =>
		keys.every((key) => hasValue(env[key]));

/**
 * Create a requirement checker that is satisfied when any key has a value.
 */
export const requireAny =
	(keys: string[]) =>
	(env: EnvMap): boolean =>
		keys.some((key) => hasValue(env[key]));

/**
 * Create a simple env requirement for a single key
 */
export function createEnvRequirement(key: string, description?: string): EnvRequirement {
	return {
		id: key,
		label: key,
		description,
		isSatisfied: requireAll([key]),
	};
}

/**
 * Requirements for every registry var hard-required by the given mode.
 */
function buildStaticRequirements(mode: DeploymentMode): EnvRequirement[] {
	return ENV_REGISTRY.filter((spec) => Array.isArray(spec.requiredBy) && spec.requiredBy.includes(mode)).map((spec) =>
		createEnvRequirement(spec.name, spec.description),
	);
}

/**
 * Build env requirements for exactly the provider keys referenced by SCRAPE_TARGETS.
 */
function buildProviderKeyRequirements(env: EnvMap = process.env): EnvRequirement[] {
	let providers: string[];
	try {
		providers = [...new Set(parseScrapeTargets(env.SCRAPE_TARGETS).map((target) => target.provider))];
	} catch {
		// A missing or malformed SCRAPE_TARGETS is reported by its own
		// requirement (and rejected at worker boot); provider keys can't be
		// derived from it.
		return [];
	}

	const requirements: EnvRequirement[] = [];
	for (const provider of providers) {
		const keys = ENV_REGISTRY.filter(
			(spec) => spec.requiredBy === "dynamic-scrape-targets" && spec.provider === provider,
		).map((spec) => spec.name);
		if (keys.length === 0) continue;
		requirements.push({
			id: `PROVIDER_${provider.toUpperCase().replace(/-/g, "_")}`,
			label: keys.join(" + "),
			description: `Required by SCRAPE_TARGETS provider "${provider}".`,
			isSatisfied: requireAll(keys),
		});
	}

	return requirements;
}

export const ENV_REQUIREMENTS: Record<DeploymentMode, EnvRequirement[]> = {
	local: [...buildStaticRequirements("local"), ...buildProviderKeyRequirements()],
	demo: [...buildStaticRequirements("demo"), ...buildProviderKeyRequirements()],
	whitelabel: [...buildStaticRequirements("whitelabel"), ...buildProviderKeyRequirements()],
	cloud: [], // todo
};

/**
 * Get the deployment mode from environment variables
 *
 * Defaults to "local" for OSS builds. The build system should set
 * DEPLOYMENT_MODE appropriately for each environment.
 */
const VALID_MODES: DeploymentMode[] = ["local", "demo", "whitelabel", "cloud"];

export function getDeploymentModeFromEnv(env: EnvMap = process.env): DeploymentMode {
	const mode = env.DEPLOYMENT_MODE?.toLowerCase();

	if (!mode) {
		throw new Error("DEPLOYMENT_MODE environment variable is required");
	}

	if (!VALID_MODES.includes(mode as DeploymentMode)) {
		throw new Error(`Invalid DEPLOYMENT_MODE: "${mode}". Must be one of: ${VALID_MODES.join(", ")}`);
	}

	return mode as DeploymentMode;
}

export function getEnvRequirements(mode: DeploymentMode): EnvRequirement[] {
	return ENV_REQUIREMENTS[mode];
}

export function getEnvValidationState(env: EnvMap = process.env): {
	mode: DeploymentMode;
	requirements: EnvRequirement[];
	missing: MissingEnvVar[];
	isValid: boolean;
} {
	const mode = getDeploymentModeFromEnv(env);
	const requirements = getEnvRequirements(mode);
	const missing = requirements
		.filter((requirement) => !requirement.isSatisfied(env))
		.map((requirement) => ({
			id: requirement.id,
			label: requirement.label,
			description: requirement.description,
		}));

	return {
		mode,
		requirements,
		missing,
		isValid: missing.length === 0,
	};
}

/**
 * Validate environment variables against a specific set of requirements
 * Used by deployment packages to validate their specific requirements
 */
export function validateEnvRequirements(
	requirements: EnvRequirement[],
	env: EnvMap = process.env,
): {
	missing: MissingEnvVar[];
	isValid: boolean;
} {
	const missing = requirements
		.filter((requirement) => !requirement.isSatisfied(env))
		.map((requirement) => ({
			id: requirement.id,
			label: requirement.label,
			description: requirement.description,
		}));

	return {
		missing,
		isValid: missing.length === 0,
	};
}

/**
 * Get a required environment variable or throw an error
 */
export function requireEnv(key: string, env: EnvMap = process.env): string {
	const value = env[key];
	if (!hasValue(value)) {
		throw new Error(`Missing required environment variable: ${key}`);
	}
	return value!;
}

/**
 * Get an optional environment variable with a default value
 */
export function getEnv(key: string, defaultValue: string, env: EnvMap = process.env): string {
	const value = env[key];
	return hasValue(value) ? value! : defaultValue;
}
