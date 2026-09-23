/**
 * Provider-agnostic onboarding research.
 *
 * Onboarding always runs against a direct API provider (Anthropic / OpenAI /
 * OpenRouter / Mistral) — the deployment guarantees one is configured, and
 * the CLI's setup wizard enforces it. Each provider implements
 * `runStructuredResearch<T>(prompt, schema)` itself, picking the most
 * idiomatic combo for its API:
 *   • Anthropic / OpenAI — `generateText` + native web-search tool +
 *     `experimental_output: Output.object(schema)`.
 *   • OpenRouter — `generateObject` against a `:online`-suffixed slug
 *     (web search baked into the route).
 *   • Mistral — OpenAI-compat `generateObject` (no web search; users who
 *     want it should target a different provider via ONBOARDING_LLM_TARGET).
 *
 * This module's job is just to pick the right provider and forward the call.
 * No prompt wrappers, no JSON parsing, no two-pass anything.
 *
 * `ONBOARDING_LLM_TARGET` (parsed like a SCRAPE_TARGETS entry) overrides the
 * preference order if a deployment wants a specific provider/model.
 */
import type { z } from "zod";
import {
	getProvider,
	type Provider,
	type ProviderOptions,
	parseScrapeTargets,
	type StructuredResearchResult,
	withProviderCallTracking,
} from "../providers";

/**
 * Direct-API providers in the order onboarding prefers them. GPT-5 Mini was
 * the cheapest + best-recall in compare-onboarding runs, so we go OpenAI
 * direct first, then OpenAI via OpenRouter as a fallback (same model, just
 * different key), then Anthropic, then Mistral.
 *
 * Exported so the compare-onboarding script reads from the same source as
 * production — keeps the two from drifting.
 */
export const RESEARCH_PROVIDER_PREFERENCE = [
	"openai-api",
	"openrouter",
	"anthropic-api",
	"mistral-api",
	// Last resort: Foundry deployments do structured output but no web search,
	// so prefer any provider that can research live first.
	"azure-foundry-api",
] as const;

export type ResearchProviderId = (typeof RESEARCH_PROVIDER_PREFERENCE)[number];

const ONBOARDING_LLM_TARGET_HELP =
	"Set ONBOARDING_LLM_TARGET (e.g. claude:anthropic-api) " +
	"or configure ANTHROPIC_API_KEY / OPENAI_API_KEY / OPENROUTER_API_KEY / MISTRAL_API_KEY / AZURE_FOUNDRY_API_KEY.";

/**
 * Pick which direct-API provider the onboarding flow should use.
 *
 * Resolution order:
 *   1. `ONBOARDING_LLM_TARGET` env override (parsed `model:provider`; only
 *      the `provider` segment is honored).
 *   2. First provider in `RESEARCH_PROVIDER_PREFERENCE` that's configured AND
 *      implements `runStructuredResearch`.
 *
 * Each provider supplies its own research model internally — there's no way
 * to override the model via env or option. Operators who want a different
 * model edit the provider's `DEFAULT_RESEARCH_MODEL` constant in source.
 */
export function resolveResearchProvider(env: Record<string, string | undefined> = process.env): {
	provider: Provider;
	version?: string;
} {
	const explicit = env.ONBOARDING_LLM_TARGET?.trim();
	if (explicit) {
		const [parsed] = parseScrapeTargets(explicit);
		if (!parsed) throw new Error(`Invalid ONBOARDING_LLM_TARGET: "${explicit}"`);
		const provider = getProvider(parsed.provider);
		if (!provider.isConfigured()) {
			throw new Error(
				`ONBOARDING_LLM_TARGET points at "${parsed.provider}" but it isn't configured. ${ONBOARDING_LLM_TARGET_HELP}`,
			);
		}
		if (!provider.runStructuredResearch) {
			throw new Error(
				`ONBOARDING_LLM_TARGET points at "${parsed.provider}", which does not support structured research. ${ONBOARDING_LLM_TARGET_HELP}`,
			);
		}
		return { provider, version: parsed.version || parsed.model };
	}

	for (const id of RESEARCH_PROVIDER_PREFERENCE) {
		const provider = getProvider(id);
		if (!provider.isConfigured()) continue;
		if (!provider.runStructuredResearch) continue;

		// Only borrow a model name from a target on this same provider. Model ids
		// are provider-scoped (an Azure deployment name, an OpenRouter slug, a
		// scraper's engine id), so falling back to some other provider's target
		// sends a name the API can't resolve. With no matching target the
		// provider uses its own DEFAULT_RESEARCH_MODEL.
		let version: string | undefined;
		try {
			const matching = parseScrapeTargets(process.env.SCRAPE_TARGETS).find((t) => t.provider === id);
			if (matching) version = matching.version || matching.model;
		} catch {
			// ignore
		}

		return { provider, version };
	}

	throw new Error(`Onboarding requires at least one direct LLM API provider. ${ONBOARDING_LLM_TARGET_HELP}`);
}

/**
 * Run a research prompt and return a Zod-validated structured response. The
 * heavy lifting (web search, structured outputs, retry) lives inside each
 * provider's `runStructuredResearch` impl — we just pick the provider and hand
 * it the brand's locale.
 *
 * `options.targetMarket` / `options.targetLanguage` reach the provider as its
 * system message and its search-localization hint; `options.webSearch` is
 * forwarded too (undefined keeps the provider default). `version` is not
 * accepted: the model id is provider-scoped and resolved here.
 */
export async function runStructuredResearchPrompt<T>(
	prompt: string,
	schema: z.ZodType<T>,
	options?: ProviderOptions,
): Promise<T> {
	const { provider, version } = resolveResearchProvider();
	if (!provider.runStructuredResearch) {
		throw new Error(`Provider "${provider.id}" does not implement structured research`);
	}
	const result = await withProviderCallTracking(
		{ provider: provider.id, model: version ?? provider.id, kind: "research" },
		() =>
			provider.runStructuredResearch!({
				prompt,
				schema,
				version,
				webSearch: options?.webSearch,
				targetMarket: options?.targetMarket,
				targetLanguage: options?.targetLanguage,
			}),
	);
	return result.object;
}

/**
 * Like {@link runStructuredResearchPrompt} but with the web-search tool OFF — a
 * single structured completion over context you assemble into the prompt. Same
 * provider selection (honors `ONBOARDING_LLM_TARGET` / the preference order),
 * no tools and no agent loop. Use when the prompt already carries all the data.
 *
 * Accepts the brand locale for the same reason (the completion itself must come
 * back in the brand's language); `webSearch` and `version` are not part of this
 * path by construction.
 *
 * Returns the validated object plus the resolved model id (`modelVersion`) so
 * callers can record which model produced the result.
 */
export async function runStructuredCompletionPrompt<T>(
	prompt: string,
	schema: z.ZodType<T>,
	options?: ProviderOptions,
): Promise<StructuredResearchResult<T>> {
	const { provider, version } = resolveResearchProvider();
	if (!provider.runStructuredResearch) {
		throw new Error(`Provider "${provider.id}" does not implement structured research`);
	}
	return withProviderCallTracking({ provider: provider.id, model: version ?? provider.id, kind: "research" }, () =>
		provider.runStructuredResearch!({
			prompt,
			schema,
			version,
			webSearch: false,
			targetMarket: options?.targetMarket,
			targetLanguage: options?.targetLanguage,
		}),
	);
}
