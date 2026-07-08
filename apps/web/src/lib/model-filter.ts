/**
 * Pure helpers for building the model filter dropdown options. Kept
 * side-effect-free so unit tests can import them without pulling in the
 * rest of the filter-bar module graph (which touches Better Auth server
 * init via the brand hook).
 */

/** Sentinel value used as "no model filter". Any other string in the
 *  filter URL / dropdown is a concrete model id from SCRAPE_TARGETS. */
export const ALL_MODELS_VALUE = "all";

/** Build the dropdown option list from the brand's effective models.
 *  The server resolves `brand.enabledModels` against `SCRAPE_TARGETS`
 *  and hands us the list the brand actually runs — we just layer
 *  "All" on top when there's more than one option. A single-model
 *  brand gets no "all" entry since the filter is redundant (callers
 *  hide the dropdown entirely). */
export function getAvailableModels(effectiveModels: readonly string[]): string[] {
	return effectiveModels.length > 1 ? [ALL_MODELS_VALUE, ...effectiveModels] : [...effectiveModels];
}
