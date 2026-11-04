import { multiplierFor, multiplierLabel } from './modelPrices.js';
import { syncedRow, syncedRows, variesByTime } from './modelPriceCache.js';

/**
 * What Chat's model menu shows (CHAT-16 §A–B, W4-01), from the prices the
 * daily sync keeps (modelPrices.js): for each model the web offers, its
 * multiplier against Auto as a label ("2.3x", "<0.1x"), a tone for its
 * colour, whether its price moves by the hour, and whether the catalog
 * dropped it; the catalog's size and when it was last synced. Never a
 * price: dollars stay on the server (CHAT-04, the 2026-10-27 decision).
 *
 * Which models are offered is the web's list (lib/chat/models.ts), the ones
 * that passed Chat's tests (Wave 4 decision 1 B). `q` searches the whole
 * catalog for chat models that can call tools, for when the menu opens to
 * more (decision 1 C); the web doesn't ask it yet.
 *
 * Pure but for the process's synced rows: no database, no network.
 */

/** The most search results one ask returns. */
export const SEARCH_LIMIT = 20;

/**
 * How much older than the newest sync a row may be before the model counts
 * as dropped from the catalog: two daily syncs, so one that failed halfway
 * doesn't take a model off the menu.
 */
export const REMOVED_AFTER_MS = 36 * 60 * 60 * 1000;

/**
 * A multiplier's tone (CHAT-16 item 7): `low` under 1x (green), `high` from
 * 3x (amber, "Uses your limit faster"), `normal` between.
 * @param {number | null} multiplier
 * @returns {'low' | 'normal' | 'high' | null}
 */
export function toneOf(multiplier) {
  if (multiplier === null || !Number.isFinite(multiplier)) return null;
  if (multiplier < 1) return 'low';
  if (multiplier >= 3) return 'high';
  return 'normal';
}

/**
 * Whether a catalog row is a model Chat's engine can run: text in and out,
 * tool calls (Chat can't work without them), and not a ":batch" variant.
 * A row the sync hasn't read the parameters of yet doesn't qualify.
 */
export function runsChat(row) {
  if (!row || row.is_batch) return false;
  const has = (list, value) => Array.isArray(list) && list.includes(value);
  return (
    has(row.input_modalities, 'text') &&
    has(row.output_modalities, 'text') &&
    has(row.supported_parameters, 'tools')
  );
}

/** When the catalog was last synced: the newest synced_at the process holds; null with none. */
export function catalogUpdatedAt(rows = syncedRows()) {
  let newest = '';
  for (const row of rows) if (row.synced_at > newest) newest = row.synced_at;
  return newest || null;
}

/** A catalog name without its provider ("Anthropic: Claude Sonnet 5.5" → "Claude Sonnet 5.5"). */
export function shortName(name, id) {
  const text = typeof name === 'string' ? name.trim() : '';
  return text.replace(/^[^:]{1,40}:\s+/, '') || id;
}

/**
 * One model as the menu shows it. `removed`: the catalog no longer lists it
 * (no row, or one REMOVED_AFTER_MS older than the newest sync): the menu
 * leaves it out and the engine runs Auto in its place. Its multiplier and
 * tone are null until it is synced (its name is then its id).
 */
export function menuModel(modelId, { now = new Date(), updatedAt = catalogUpdatedAt() } = {}) {
  const row = syncedRow(modelId);
  // With no sync at all (a first start that failed), nothing counts as dropped.
  const removed =
    updatedAt !== null &&
    (!row || Date.parse(updatedAt) - Date.parse(row.synced_at) > REMOVED_AFTER_MS);
  const multiplier = row ? multiplierFor(modelId, now) : null;
  return {
    id: modelId,
    name: shortName(row?.name, modelId),
    multiplier: multiplier === null ? null : multiplierLabel(multiplier),
    tone: toneOf(multiplier),
    variesByHour: row ? variesByTime(row) : false,
    removed,
  };
}

/**
 * The menu: Auto (1x by definition), the offered models the catalog still
 * lists, the selected one even when it was dropped (so the person reads why
 * the run went back to Auto), search results, the count of chat models with
 * tools ("Search {n} models…") and the last sync.
 *
 * @param {{ ids?: string[], q?: string, selected?: string | null, now?: Date }} [ask]
 */
export function chatModelMenu({ ids = [], q = '', selected = null, now = new Date() } = {}) {
  const rows = syncedRows();
  const updatedAt = catalogUpdatedAt(rows);
  const at = { now, updatedAt };
  const offered = [...new Set(ids)].map((id) => menuModel(id, at));
  const chatRows = rows.filter(runsChat);
  const query = q.trim().toLowerCase();
  const results = query
    ? chatRows
        .filter(
          (row) =>
            row.model_id.toLowerCase().includes(query) ||
            String(row.name ?? '')
              .toLowerCase()
              .includes(query),
        )
        .slice(0, SEARCH_LIMIT)
        .map((row) => menuModel(row.model_id, at))
        .filter((model) => !model.removed)
    : [];
  return {
    auto: { id: 'auto', multiplier: '1x', tone: 'normal' },
    models: offered.filter((model) => !model.removed),
    selected: selected && selected !== 'auto' ? menuModel(selected, at) : null,
    results,
    catalogCount: chatRows.length,
    updatedAt,
  };
}
