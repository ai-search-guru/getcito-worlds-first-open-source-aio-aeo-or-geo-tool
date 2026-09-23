import { anthropicApi } from "./registry/anthropic-api";
import { azureFoundryApi } from "./registry/azure-foundry-api";
import { brightdata } from "./registry/brightdata";
import { cloro } from "./registry/cloro";
import { dataforseo } from "./registry/dataforseo";
import { mistralApi } from "./registry/mistral-api";
import { olostep } from "./registry/olostep";
import { openaiApi } from "./registry/openai-api";
import { openrouter } from "./registry/openrouter";
import { oxylabs } from "./registry/oxylabs";
import type { Provider } from "./types";

export { parseScrapeTargets, validateScrapeTargets } from "./config";
// The prompt-text half of the locale hint is part of the public API: callers
// that build their own prompt (onboarding, opportunities) append it themselves.
export { localePromptInstruction } from "./locale";
export type { ModelMeta } from "./models";
export { getModelMeta, KNOWN_MODELS } from "./models";
export { selectTargetsForBrand } from "./runner";
export type {
	ModelConfig,
	Provider,
	ProviderOptions,
	ScrapeResult,
	StructuredResearchOptions,
	StructuredResearchResult,
	TestResult,
} from "./types";
export type { ProviderCallKind, ProviderCallRecord } from "./usage";
export { recordProviderCall, withProviderCallTracking } from "./usage";

const providerMap: Record<string, Provider> = {
	olostep,
	brightdata,
	oxylabs,
	cloro,
	"openai-api": openaiApi,
	"anthropic-api": anthropicApi,
	"mistral-api": mistralApi,
	dataforseo,
	openrouter,
	"azure-foundry-api": azureFoundryApi,
};

export function getProvider(id: string): Provider {
	const p = providerMap[id];
	if (!p) throw new Error(`Unknown provider: "${id}"`);
	return p;
}

export function getAvailableProviders(): Provider[] {
	return Object.values(providerMap).filter((p) => p.isConfigured());
}

export function getAllProviders(): Provider[] {
	return Object.values(providerMap);
}
