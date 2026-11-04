/**
 * The models Chat's model menu offers (CHAT-16 §A, W4-01): Auto, and the
 * models that passed Chat's tests on its rules (structured answers, the
 * guardrails, no made-up numbers) in a real run (Wave 4 decision 1 B; owner,
 * 2026-11-02). Each model Chat may run is listed with `tested`: only a tested
 * one is offered in the menu, asked of the price catalog, or run by the
 * engine; a chat or an agent that picked one not tested runs Auto. At launch
 * that was Haiku 5.5 and Sonnet 5.5, which Auto runs already; Opus 5.5 since
 * it passed the test set twice in a row (2026-11-03). Each has its id
 * in OpenRouter's catalog, which the API server prices and labels by
 * (lib/modelMenu.js), and its id in its provider's own API. Shared by the
 * browser and the server: no keys here.
 */

/** What a run's `model` is when the person picked nothing: Haiku reads, Sonnet writes. */
export const AUTO_MODEL = 'auto';

/** The providers an offered model runs on, by their own API. */
export type OfferedModelProvider = 'anthropic';

export interface OfferedModel {
  /** The catalog's id ("anthropic/claude-sonnet-5.5"): what a run keeps as its model. */
  id: string;
  /** The provider's own API id ("claude-sonnet-5-5"). */
  api: string;
  provider: OfferedModelProvider;
  /**
   * It passed Chat's test set in a real run: only then is it offered and run.
   * Set to true in the same pull request that records its passing run.
   */
  tested: boolean;
}

/** Every model Chat may run once it is tested, tested or not. */
export const CHAT_MODELS: readonly OfferedModel[] = [
  {
    id: 'anthropic/claude-haiku-5.5',
    api: 'claude-haiku-5-5',
    provider: 'anthropic',
    tested: true,
  },
  {
    id: 'anthropic/claude-sonnet-5.5',
    api: 'claude-sonnet-5-5',
    provider: 'anthropic',
    tested: true,
  },
  // Passed the whole test set twice in a row on Anthropic's API, cache on (2026-11-03, W4-35).
  { id: 'anthropic/claude-opus-5.5', api: 'claude-opus-5-5', provider: 'anthropic', tested: true },
];

/** The models the menu offers, the catalog is asked for and the engine runs: the tested ones. */
export const OFFERED_MODELS: readonly OfferedModel[] = CHAT_MODELS.filter((model) => model.tested);

/** An offered (tested) model by its catalog id; null for Auto, one not tested, or one not listed. */
export function offeredModel(id: string | null | undefined): OfferedModel | null {
  return OFFERED_MODELS.find((model) => model.id === id) ?? null;
}

/** Whether a value is a model a run may ask for: Auto or an offered model. */
export function isChatModelChoice(value: unknown): value is string {
  return value === AUTO_MODEL || (typeof value === 'string' && offeredModel(value) !== null);
}

/** A model id as the catalog writes it ("provider/model"), offered or not. */
export function isCatalogId(value: unknown): value is string {
  return (
    typeof value === 'string' && /^[A-Za-z0-9._~:-]{1,100}\/[A-Za-z0-9._~:-]{1,100}$/.test(value)
  );
}
