import { ALL_MODELS, ALL_SCRAPERS } from '@/config/promptOptions';

interface PromptEngineLimits {
  allowedScrapers?: readonly string[] | null;
  allowedModels?: readonly string[] | null;
}

/** Apply the same engine allow-lists used when adding prompts in the dashboard. */
export function filterPromptSuggestionEngines(
  limits: PromptEngineLimits,
  platforms: readonly string[],
  models: readonly string[],
): { platforms: string[]; models: string[] } {
  const allowedScrapers = limits.allowedScrapers
    ? new Set(limits.allowedScrapers)
    : new Set(ALL_SCRAPERS.map((scraper) => scraper.id));
  const allowedModels = limits.allowedModels
    ? new Set(limits.allowedModels)
    : new Set(ALL_MODELS.map((model) => model.id));

  return {
    platforms: platforms.filter((platform) => allowedScrapers.has(platform)),
    models: models.filter((model) => allowedModels.has(model)),
  };
}

/** Match the dashboard's stale state: empty lists and all-expired lists are stale. */
export function promptSuggestionsAreStale(
  suggestions: readonly { expires_at: string }[],
  now = Date.now(),
): boolean {
  return (
    suggestions.length === 0 ||
    suggestions.every((suggestion) => {
      const expiresAt = new Date(suggestion.expires_at).getTime();
      return !Number.isFinite(expiresAt) || expiresAt < now;
    })
  );
}
