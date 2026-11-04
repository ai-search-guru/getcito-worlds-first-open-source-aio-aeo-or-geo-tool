/**
 * The synced model prices (chat_model_prices, 00404), held in this process
 * so a call's cost is worked out without a database read (lib/improveCost.js
 * asks synchronously). modelPrices.js fills it at start and after each
 * daily sync; empty, every model is priced from improve-cost's own table, as
 * before the sync existed.
 *
 * Pure: no database, no network.
 */

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/** model_id → its row, as modelPrices.js reads it. */
let synced = new Map();

/** Replaces what the process holds with these rows. */
export function setSyncedPrices(rows) {
  synced = new Map((rows ?? []).map((row) => [row.model_id, row]));
}

/** How many models the process holds. */
export function syncedCount() {
  return synced.size;
}

/** Every row the process holds, for the model menu's search and counts. */
export function syncedRows() {
  return [...synced.values()];
}

/** A per-token price string as USD per million tokens; null when absent or variable ("-1"). */
export function perMillion(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n * 1_000_000 : null;
}

/** HHMM (0–2400) as minutes into the day. */
const minutesOf = (hhmm) => Math.floor(hhmm / 100) * 60 + (hhmm % 100);

/**
 * Whether a time override applies at `now` (UTC): its days, when it names
 * any, and its window, when it has one (HHMM, end excluded; an end before the
 * start runs past midnight).
 */
export function inTimeWindow(override, now) {
  const days = Array.isArray(override.utc_days)
    ? override.utc_days.map((d) => String(d).toLowerCase())
    : null;
  if (days && !days.includes(DAY_NAMES[now.getUTCDay()])) return false;
  const start = Number(override.utc_start);
  const end = Number(override.utc_end);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return true;
  const at = now.getUTCHours() * 60 + now.getUTCMinutes();
  const from = minutesOf(start);
  const to = minutesOf(end);
  return from <= to ? at >= from && at < to : at >= from || at < to;
}

const isTimeOverride = (o) => o && ('utc_days' in o || 'utc_start' in o || 'utc_end' in o);
const isSizeOverride = (o) => o && Number.isFinite(Number(o.min_prompt_tokens));

/** Whether the model's price changes by the hour or day (a time override). */
export function variesByTime(row) {
  return (row?.overrides ?? []).some(isTimeOverride);
}

/**
 * The price in effect for a row: its time override at `now`, when one
 * applies (CHAT-16 item 3), and on top the prompt-size override for a call
 * that large (`promptTokens` at or above its min_prompt_tokens; the largest
 * that fits). `{ input, output }` in USD per million tokens, and `cacheRead`
 * when the row has a cache-read rate; null when the row has no usable base
 * price. An override that raises the input rate without its own cache-read
 * rate raises that one as much: never lowered by a guess.
 *
 * @param {object} row  a chat_model_prices row
 * @param {{ now?: Date, promptTokens?: number }} [at]
 */
export function priceInEffect(row, { now = new Date(), promptTokens = 0 } = {}) {
  if (!row || row.input_per_m == null || row.output_per_m == null) return null;
  let price = { input: Number(row.input_per_m), output: Number(row.output_per_m) };
  if (row.cache_read_per_m != null) price.cacheRead = Number(row.cache_read_per_m);
  const overrides = Array.isArray(row.overrides) ? row.overrides : [];
  const apply = (override) => {
    const input = perMillion(override.prompt);
    const output = perMillion(override.completion);
    const cacheRead = perMillion(override.input_cache_read);
    const next = { input: input ?? price.input, output: output ?? price.output };
    if (cacheRead != null) next.cacheRead = cacheRead;
    else if (price.cacheRead != null) {
      const raised = price.input > 0 ? (price.cacheRead * next.input) / price.input : 0;
      next.cacheRead = Math.max(price.cacheRead, raised);
    }
    price = next;
  };
  const timed = overrides.find((o) => isTimeOverride(o) && inTimeWindow(o, now));
  if (timed) apply(timed);
  const sized = overrides
    .filter((o) => isSizeOverride(o) && promptTokens >= Number(o.min_prompt_tokens))
    .sort((a, b) => Number(b.min_prompt_tokens) - Number(a.min_prompt_tokens))[0];
  if (sized) apply(sized);
  return price;
}

/**
 * The ids a model may be synced under: as given, without an `openrouter/`
 * prefix, and with a trailing version's hyphen as OpenRouter's dot
 * (`anthropic/claude-haiku-4-5` → `anthropic/claude-haiku-4.5`).
 */
export function catalogIds(modelId) {
  const id = String(modelId ?? '').replace(/^openrouter\//, '');
  const dotted = id.replace(/-(\d+)-(\d+)$/, '-$1.$2');
  return dotted === id ? [id] : [id, dotted];
}

/** The synced row for a model, under any id it may be synced under; null when none. */
export function syncedRow(modelId) {
  for (const id of catalogIds(modelId)) {
    const row = synced.get(id);
    if (row) return row;
  }
  return null;
}

/** The synced price in effect for a model, or null when it isn't synced. */
export function syncedPriceFor(modelId, at) {
  return priceInEffect(syncedRow(modelId), at);
}
