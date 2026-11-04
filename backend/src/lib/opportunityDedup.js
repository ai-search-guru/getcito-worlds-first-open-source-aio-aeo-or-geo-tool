/**
 * Duplicate protection for content opportunities (CONTENT-004).
 *
 * Two opportunities are the same work when they rest on the same baskets:
 * the prompts they answer and the searches AI engines ran for those prompts
 * (query fan-out). Titles vary from run to run ("Comprehensive Guide to the
 * Best AI SEO Tools", "Definitive Listicle of…") while the baskets behind
 * them stay put, so the baskets decide, not the wording. The check runs
 * before the model is called, so a duplicate costs neither a model call nor
 * a slot of the monthly quota.
 *
 * Pure on purpose: the generator loads the baskets, this compares them, and
 * the tests pin known duplicate and distinct pairs.
 */

/** Weight of the prompt basket in the score; the fan-out basket gets the rest. */
export const PROMPT_WEIGHT = 0.6;

/**
 * Score from which two baskets count as the same work. Configurable on the
 * server (OPPORTUNITY_DUPLICATE_THRESHOLD) so it can be tuned without a
 * release; 0.6 keeps the known duplicate pairs in the tests and lets the
 * distinct ones through.
 */
export const DEFAULT_DUPLICATE_THRESHOLD = 0.6;

/** A dismissed opportunity blocks its basket for this long, then may return. */
export const DISMISSED_BLOCK_DAYS = 90;

export function duplicateThreshold(env = process.env) {
  const value = Number(env.OPPORTUNITY_DUPLICATE_THRESHOLD);
  return Number.isFinite(value) && value > 0 && value <= 1 ? value : DEFAULT_DUPLICATE_THRESHOLD;
}

/** Lowercase, no punctuation or extra spaces: "Best AI-SEO tools?" → "best ai seo tools". */
export function normalize(text) {
  return String(text ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function toSet(texts) {
  return new Set((texts || []).map(normalize).filter(Boolean));
}

/**
 * Dice overlap, 0–1: twice the shared items over both sizes. A basket that
 * grew by a merge still matches its original (3 of 3 inside 5 → 0.75), while
 * one shared prompt doesn't make a ten-prompt cluster a copy of an old
 * single-prompt opportunity (1 of 10 → 0.18).
 */
export function overlap(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const x of a) if (b.has(x)) shared += 1;
  return (2 * shared) / (a.size + b.size);
}

/** { prompts, queries } as normalized sets. */
export function basket({ prompts, queries }) {
  return { prompts: toSet(prompts), queries: toSet(queries) };
}

/**
 * An existing opportunity's baskets from its stored source_data. Rows from
 * the per-prompt generator have no prompt list, only the prompt they were
 * made for, which then is their prompt basket.
 */
export function storedBasket(sourceData) {
  const sd = sourceData || {};
  const prompts = Array.isArray(sd.prompts) && sd.prompts.length ? sd.prompts : [sd.promptText];
  const queries = Array.isArray(sd.queries?.top) ? sd.queries.top.map((q) => q.query) : [];
  return basket({ prompts, queries });
}

/**
 * 0–1: how much two baskets are the same work. The prompt basket leads; the
 * fan-out basket counts only when both sides recorded one, so a missing
 * basket neither helps nor hurts.
 */
export function basketSimilarity(a, b) {
  const prompts = overlap(a.prompts, b.prompts);
  if (a.queries.size === 0 || b.queries.size === 0) return prompts;
  return PROMPT_WEIGHT * prompts + (1 - PROMPT_WEIGHT) * overlap(a.queries, b.queries);
}

const DAY_MS = 86_400_000;

/** Whether an existing opportunity still blocks a new one with its basket. */
export function blocks(row, now = Date.now()) {
  if (row.status === 'archived') return false;
  if (row.status !== 'dismissed') return true;
  const at = Date.parse(row.updated_at);
  return Number.isFinite(at) && now - at < DISMISSED_BLOCK_DAYS * DAY_MS;
}

/**
 * The existing opportunity a candidate basket duplicates, as { row, score },
 * or null. `existing` rows carry { status, updated_at, basket }.
 */
export function findDuplicate(candidate, existing, { threshold, now = Date.now() } = {}) {
  const min = threshold ?? DEFAULT_DUPLICATE_THRESHOLD;
  let best = null;
  for (const row of existing) {
    if (!blocks(row, now)) continue;
    const score = basketSimilarity(candidate, row.basket);
    if (score >= min && (!best || score > best.score)) best = { row, score };
  }
  return best;
}
