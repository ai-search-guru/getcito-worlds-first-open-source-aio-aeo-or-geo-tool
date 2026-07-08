// Constants for prompt processing
export const RUNS_PER_PROMPT = 5;

// Fallback cadence (hours) when the DEFAULT_DELAY_HOURS env var is unset or invalid.
export const DEFAULT_DELAY_HOURS_FALLBACK = 24;

/**
 * Resolves the default prompt cadence (hours) for brands without a
 * delayOverrideHours. Reads DEFAULT_DELAY_HOURS from the environment; falls
 * back to DEFAULT_DELAY_HOURS_FALLBACK when unset, non-numeric, or <= 0.
 *
 * Server-only. Client code should read clientConfig.defaultDelayHours instead
 * of calling this directly — `process` is not defined in browser bundles.
 */
export function getDefaultDelayHours(): number {
	const raw = typeof process !== "undefined" ? process.env.DEFAULT_DELAY_HOURS : undefined;
	if (!raw) return DEFAULT_DELAY_HOURS_FALLBACK;
	const parsed = Number(raw);
	if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_DELAY_HOURS_FALLBACK;
	return parsed;
}

// Maximum limits for brand resources
export const MAX_COMPETITORS = 100;
export const MAX_PROMPTS = 100;

/**
 * Sentinel providers store in `prompt_runs.web_queries` when a web search
 * happened (citations prove it) but the provider doesn't expose the actual
 * query strings (OpenRouter always; BrightData/Olostep on extraction failure).
 * Written by the provider implementations and filtered out by every fan-out
 * read path — keep both sides on this constant.
 */
export const WEB_QUERIES_UNAVAILABLE = "unavailable";
