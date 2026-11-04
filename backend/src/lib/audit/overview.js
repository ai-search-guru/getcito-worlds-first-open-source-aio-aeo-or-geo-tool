/**
 * The Site Audit hub's KPI cards (SA-018): site score, pages audited, and the
 * Authority and E-E-A-T scores with their biggest gaps; and the summary
 * strip's lowest category (SA-019). Pure, so the route only reads rows and
 * this decides what they add up to.
 *
 * Everything covers the brand's primary domain, like the Score over time
 * chart, and each page counts once, through its latest completed audit.
 */

import { categories, signalsByKey } from './rubric.js';

/** The categories the Authority · E-E-A-T card reads. */
export const AUTHORITY_CATEGORIES = ['authority', 'eeat'];

/** Gaps listed on the card. */
export const OVERVIEW_GAPS = 3;

const average = (values) =>
  values.length === 0 ? null : values.reduce((sum, v) => sum + v, 0) / values.length;

const points = (score) => Math.round(score * 100);

/**
 * @param {Array<{ host: string|null, auditId: string, score: number|null, previousScore: number|null }>} pages
 *   from buildAuditPages
 * @param {string|null} primaryHost
 * @returns {{ own: typeof pages, otherPages: number }} the primary domain's audited pages, and how many
 *   audited pages are on other sites
 */
export function primaryPages(pages, primaryHost) {
  const audited = (pages ?? []).filter((p) => p.score !== null);
  const own = primaryHost ? audited.filter((p) => p.host === primaryHost) : [];
  return { own, otherPages: audited.length - own.length };
}

/**
 * @param {ReturnType<typeof primaryPages>['own']} own
 * @param {Map<string, object>} categoryScoresById  each latest audit's category_scores
 * @param {Array<{ audit_id: string, signal_key: string }>} failingRows
 *   failed or warning Authority / E-E-A-T signals of those audits
 */
export function buildOverview(own, categoryScoresById, failingRows) {
  const siteScore = average(own.map((p) => p.score));
  // Against each page's previous audit; a page audited once counts as unchanged.
  const withPrevious = own.some((p) => p.previousScore !== null);
  const previous = average(own.map((p) => p.previousScore ?? p.score));
  const siteScoreChange =
    siteScore !== null && withPrevious ? points(siteScore) - points(previous) : null;

  const categoryAverage = (key) =>
    average(
      own
        .map((p) => categoryScoresById.get(p.auditId)?.[key]?.score)
        .filter((s) => typeof s === 'number'),
    );

  // Pages per failing signal, each page once.
  const ownIds = new Set(own.map((p) => p.auditId));
  const pagesBySignal = new Map();
  for (const row of failingRows ?? []) {
    if (!ownIds.has(row.audit_id)) continue;
    if (!pagesBySignal.has(row.signal_key)) pagesBySignal.set(row.signal_key, new Set());
    pagesBySignal.get(row.signal_key).add(row.audit_id);
  }
  const gaps = [...pagesBySignal.entries()]
    .map(([key, ids]) => ({
      key,
      label: signalsByKey[key]?.label ?? key,
      category: signalsByKey[key]?.category ?? null,
      pages: ids.size,
    }))
    .sort((a, b) => b.pages - a.pages || a.key.localeCompare(b.key))
    .slice(0, OVERVIEW_GAPS);

  // The weakest of the five categories; a tie goes to the rubric's order.
  let lowestCategory = null;
  for (const { key } of categories) {
    const score = categoryAverage(key);
    if (score !== null && (lowestCategory === null || score < lowestCategory.score)) {
      lowestCategory = { key, score };
    }
  }

  return {
    pages: own.length,
    siteScore,
    siteScoreChange,
    authority: categoryAverage('authority'),
    eeat: categoryAverage('eeat'),
    lowestCategory,
    gaps,
  };
}
