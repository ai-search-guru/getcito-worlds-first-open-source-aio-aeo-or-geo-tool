import type { ModelConfig } from "./types";

/**
 * Resolve which SCRAPE_TARGETS configs a brand should run.
 *
 * `enabledModels` is a brand-level override keyed by model name:
 *   - `null` / `undefined`: no override — run every configured target.
 *   - `[]`: explicit empty — run nothing (caller skips the prompt).
 *   - `[...]`: run exactly these models. Every entry must correspond to a
 *     model in `configs`; an unknown model throws so the configuration error
 *     surfaces loudly instead of silently dropping runs.
 */
export function selectTargetsForBrand(
	configs: ModelConfig[],
	enabledModels: string[] | null | undefined,
): ModelConfig[] {
	if (enabledModels === null || enabledModels === undefined) return configs;
	if (enabledModels.length === 0) return [];
	const configModels = new Set(configs.map((c) => c.model));
	const unknown = enabledModels.filter((m) => !configModels.has(m));
	if (unknown.length > 0) {
		throw new Error(
			`brand.enabledModels references models not in SCRAPE_TARGETS: ${unknown.join(", ")}. ` +
				`Configured models: ${[...configModels].join(", ") || "(none)"}.`,
		);
	}
	const allowed = new Set(enabledModels);
	return configs.filter((c) => allowed.has(c.model));
}
