/**
 * What an Improve generation (PROMPT-003) actually cost, so the monthly
 * quota can be a dollar budget — a share of what the customer pays — and stay
 * there whichever model IMPROVE_SUGGESTION_MODEL points at.
 *
 * List prices in USD per million tokens. Chat's own steps (chatBudget.js,
 * only for workspaces Chat is on for) read the prices synced daily from
 * OpenRouter's catalog first (modelPrices.js, CHAT-16 §A), at the price in
 * effect; every other call, and a Chat step whose model isn't synced or is
 * synced at $0, is priced from this table. Update it when a provider
 * changes its prices or a new model is configured; a model missing from both
 * is charged at FALLBACK_PRICE, deliberately expensive, so an unknown model
 * can only use the budget up faster, never overspend it. A model here priced
 * higher for a long prompt has its `long` rate, for a call whose input tokens
 * pass `over`.
 *
 * A Chat step's input read from the provider's prompt cache is priced at the
 * model's cache-read rate (`cacheRead`, CHAT-04 §D: a tenth of the input
 * price for Claude) and input written to it at
 * CACHE_WRITE_MULTIPLIER times the input price. A model without a known
 * cache-read rate has its cache reads priced in full: never less than they
 * cost.
 */

import { syncedPriceFor } from './modelPriceCache.js';

export const MODEL_PRICES = {
  'google/gemini-3-flash-preview': { input: 0.5, output: 3 },
  'google/gemini-3-flash': { input: 0.5, output: 3 },
  'openai/gpt-5-mini': { input: 0.25, output: 2 },
  'anthropic/claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1 },
  // The Content Editor's with an Anthropic key (contentBrief.js): Haiku reads, Sonnet writes.
  'anthropic/claude-haiku-5-5': {
    input: 0.1,
    output: 0.5,
    cacheRead: 0.01,
    long: { over: 100_000, input: 0.5, output: 2.5 },
  },
  'anthropic/claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2 },
};

/**
 * A prompt-cache write costs this many times the input price: Anthropic's
 * 5-minute cache, the one Chat writes (CHAT-04 §D item 26), and the most any
 * provider Chat uses charges, so a write is never priced below its cost.
 */
export const CACHE_WRITE_MULTIPLIER = 1.25;

export const FALLBACK_PRICE = { input: 5, output: 25 };

/**
 * A typical generation, used to estimate "generations left" before an org
 * has any history, and the least a call holds on the budget before it runs
 * (reserveAiBudget): ~7k input and ~2k output tokens on the configured model.
 */
const TYPICAL_TOKENS = { input: 7000, output: 2000 };

/**
 * This table's price for a model: under its id, or with OpenRouter's dotted
 * version written as ours ("anthropic/claude-haiku-5.5" is
 * "anthropic/claude-haiku-5-5"). OpenRouter ids carry the provider id after
 * an `openrouter/` prefix (`openrouter/google/gemini-3-flash-preview`);
 * they're priced as that model. Null when the table hasn't the model.
 */
function tablePriceFor(modelId) {
  const id = String(modelId ?? '').replace(/^openrouter\//, '');
  return MODEL_PRICES[id] ?? MODEL_PRICES[id.replace(/-(\d+)\.(\d+)$/, '-$1-$2')] ?? null;
}

/**
 * A synced price the budget may use: both rates above $0, unless the model
 * is a `:free` one. A $0 rate for a paid model (a catalog mistake or a
 * promotion) would let its calls cost the budget nothing, so the table (or
 * FALLBACK_PRICE) prices it instead.
 */
function usableSynced(modelId, price) {
  if (!price) return false;
  if (String(modelId ?? '').endsWith(':free')) return true;
  return price.input > 0 && price.output > 0;
}

/**
 * A model's price, for a call of `promptTokens` (which may cross a
 * prompt-size price). With `synced` (Chat's own steps only), the synced one
 * in effect now comes first; otherwise, and when it's missing or $0, this
 * table's, and FALLBACK_PRICE for a model the table hasn't.
 */
export function priceFor(modelId, { promptTokens = 0, synced = false } = {}) {
  if (synced) {
    const price = syncedPriceFor(modelId, { promptTokens });
    if (usableSynced(modelId, price)) return price;
  }
  const price = tablePriceFor(modelId) ?? FALLBACK_PRICE;
  return price.long && promptTokens > price.long.over ? price.long : price;
}

/**
 * The input a call read from and wrote to the prompt cache, within its
 * input tokens (which count both): a provider's count past the input is
 * held to it, so the rest is never priced below what it was.
 */
export function cacheSplit(usage) {
  const count = (n) => Math.max(0, Number(n) || 0);
  const input = count(usage?.inputTokens);
  const read = Math.min(input, count(usage?.cacheReadTokens));
  const written = Math.min(input - read, count(usage?.cacheWriteTokens));
  return { input, read, written };
}

/**
 * A price's cache-read rate: its own, when it has one above $0 (a `:free`
 * model's $0 included) and no higher than its input rate; else the input
 * rate, so a cache read is never priced below its cost.
 */
function cacheReadRate(modelId, price) {
  const rate = Number(price.cacheRead);
  const usable =
    price.cacheRead != null &&
    Number.isFinite(rate) &&
    (rate > 0 || String(modelId ?? '').endsWith(':free'));
  return usable ? Math.min(rate, price.input) : price.input;
}

/**
 * USD cost of one call from the AI SDK's `usage`. `synced`: a Chat step,
 * priced from the synced catalog first (priceFor). Its input read from the
 * prompt cache (`cacheReadTokens`) is priced at the cache-read rate, and
 * input written to it (`cacheWriteTokens`) at CACHE_WRITE_MULTIPLIER.
 */
export function generationCostUsd(modelId, usage, { synced = false } = {}) {
  const { input, read, written } = cacheSplit(usage);
  const price = priceFor(modelId, { promptTokens: input, synced });
  const output = Number(usage?.outputTokens) || 0;
  const plain = input - read - written;
  return (
    (plain * price.input +
      written * price.input * CACHE_WRITE_MULTIPLIER +
      read * cacheReadRate(modelId, price) +
      output * price.output) /
    1_000_000
  );
}

/**
 * One web search a call's provider runs (the Content Agent looking a fact
 * up: contentResearch.js), billed on top of its tokens: Anthropic's list
 * price, $10 per 1,000 searches. Other providers' searches are charged the
 * same.
 */
export const WEB_SEARCH_USD = 0.01;

/** USD cost of `searches` web searches. */
export function searchCostUsd(searches) {
  return Math.max(0, Number(searches) || 0) * WEB_SEARCH_USD;
}

export function typicalCostUsd(modelId) {
  return generationCostUsd(modelId, {
    inputTokens: TYPICAL_TOKENS.input,
    outputTokens: TYPICAL_TOKENS.output,
  });
}

/**
 * The org's typical generation cost: the median of its recent ones, so one
 * unusually long answer doesn't swing the estimate. Null with no history.
 */
export function medianCost(costs) {
  const sorted = costs.filter((c) => c > 0).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * The counter users see: about how many generations the remaining budget
 * buys, at the org's typical cost (or the model's before it has any).
 * Dollars stay internal.
 */
export function estimateGenerationsLeft(remainingUsd, avgCostUsd) {
  if (remainingUsd <= 0) return 0;
  if (!(avgCostUsd > 0)) return 0;
  return Math.floor(remainingUsd / avgCostUsd);
}
