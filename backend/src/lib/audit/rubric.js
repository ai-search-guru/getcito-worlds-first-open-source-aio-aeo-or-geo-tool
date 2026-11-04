/**
 * AEO/GEO scoring rubric we implement for the Site Audit feature. We run the
 * checks ourselves rather than calling any third-party API; this module just
 * exposes the rubric's metadata (categories, weights, and the per-signal
 * label / what / why / howToFix / impactTier copy) so the engine and the UI
 * can describe each signal.
 */

import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const rubric = require('./rubric.json');

export const RUBRIC_VERSION = rubric.version;

/** Category descriptors with their scoring weights (sum to 1.0). */
export const categories = rubric.categories;

/** signalKey -> full signal descriptor ({ key, category, label, what, why, howToFix, source, impactTier }). */
export const signalsByKey = Object.fromEntries(rubric.signals.map((s) => [s.key, s]));

/** Total number of signals in the standard (48), regardless of how many we've implemented. */
export const TOTAL_SIGNALS = rubric.signals.length;

/**
 * @param {string} key
 * @returns {object|null}
 */
export function describeSignal(key) {
  return signalsByKey[key] ?? null;
}
