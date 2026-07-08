import type { ModelConfig } from "./types";

// SCRAPE_TARGETS parsing/formatting lives in @workspace/config (the env source
// of truth, shared with the CLI); re-exported here for compatibility.
export { parseScrapeTargets } from "@workspace/config/scrape-targets";

export function validateScrapeTargets(
	configs: ModelConfig[],
	getProvider: (id: string) => { isConfigured(): boolean; validateTarget?(config: ModelConfig): string | null } | undefined,
): void {
	for (const config of configs) {
		const provider = getProvider(config.provider);
		if (!provider) throw new Error(`SCRAPE_TARGETS: unknown provider "${config.provider}"`);
		if (!provider.isConfigured())
			throw new Error(
				`SCRAPE_TARGETS: provider "${config.provider}" requires API key(s) to be configured (see docs)`,
			);
		if ((config.provider === "openai-api" || config.provider === "anthropic-api" || config.provider === "mistral-api" || config.provider === "openrouter") && !config.version)
			throw new Error(`SCRAPE_TARGETS: "${config.model}:${config.provider}" requires a version slug (third segment)`);
		const targetError = provider.validateTarget?.(config);
		if (targetError)
			throw new Error(`SCRAPE_TARGETS: invalid target "${config.model}:${config.provider}": ${targetError}`);
	}
}
