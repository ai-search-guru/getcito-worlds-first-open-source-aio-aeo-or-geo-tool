/**
 * What the demo-site modules (traffic, site, catalog) share: the days they
 * count back over, and the citations of Brewline's own pages
 * in the core module's answers, so a page's citations, its AI visits and its
 * audit read the same month.
 */

import { BRAND } from './brewline.js';
import { coreRows } from './core.js';

export const DAY_MS = 24 * 60 * 60 * 1000;

/** The UTC day (YYYY-MM-DD) `days` before `now`. */
export function dayBefore(now, days) {
  return new Date(now.getTime() - days * DAY_MS).toISOString().slice(0, 10);
}

/** Midnight UTC of a day, in ms. */
export const dayStart = (day) => Date.parse(`${day}T00:00:00.000Z`);

/** The last built core, kept so the demo-site modules of one build read it once. */
let lastCore = null;

/**
 * The citations of Brewline's own pages in the core module's answers:
 * address, when, and the prompt whose answer cited it. Deterministic, as
 * the core is.
 *
 * @param {string} brandId
 * @param {Date} now
 * @returns {{ url: string, created_at: string, prompt_id: string }[]}
 */
export function brandCitations(brandId, now) {
  const key = `${brandId}|${now.toISOString()}`;
  if (lastCore?.key !== key) {
    const rows = coreRows({ brandId, now });
    const promptOf = new Map(rows.results.map((r) => [r.id, r.prompt_id]));
    const host = `https://${BRAND.domain}`;
    lastCore = {
      key,
      citations: rows.citations
        .filter((c) => c.url === host || c.url.startsWith(`${host}/`))
        .map((c) => ({
          url: c.url,
          created_at: c.created_at,
          prompt_id: promptOf.get(c.prompt_result_id),
        })),
    };
  }
  return lastCore.citations;
}
