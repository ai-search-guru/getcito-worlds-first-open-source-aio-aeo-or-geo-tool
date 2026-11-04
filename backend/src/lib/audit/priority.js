/**
 * The Opportunities inbox's priority score (SA-005): value × opportunity ×
 * ease, each 0–1, shown 0–100 as the cube root of the product (the same
 * order as the product, on a scale people read: 0.96 × 0.9 × 0.8 is 88).
 * Pure; the weights live here so they're tuned in one place.
 *
 * - Value: what the page is worth to the business. Google Analytics' value
 *   percentile, weighted by its signal (revenue and transactions above key
 *   events above engagement); else the page's sessions ranked within the
 *   site.
 * - Opportunity: how much an audit can win. No AI traffic, a competitor
 *   cited on the page's prompts, a target page not cited, never or long ago
 *   audited, no AI visits.
 * - Ease: how close the page is to passing. Its last score; unknown when
 *   never audited. A page whose template shares its gaps (SA-007) is easier:
 *   one fix covers every page of it.
 *
 * Its own composition (a product, not a weighted sum: a page worth nothing
 * or with nothing to win isn't worth an audit, however easy); the pieces it
 * shares with every screen's score are in priorityCore.js (learning D4).
 */

import { clamp, round } from '../priorityCore.js';
import { templateOf } from './templates.js';

export const PRIORITY_WEIGHTS = Object.freeze({
  value: Object.freeze({
    signals: Object.freeze({ revenue: 1, transactions: 1, key_events: 0.9, engagement: 0.75 }),
    /** A page without a GA value, at the top of the site's sessions. */
    sessions: 0.6,
    min: 0.15,
  }),
  opportunity: Object.freeze({
    noAiTraffic: 0.45,
    competitorCited: 0.3,
    perExtraPrompt: 0.05,
    competitorMax: 0.45,
    targetedNotCited: 0.15,
    neverAudited: 0.3,
    staleAudit: 0.2,
    zeroAiVisits: 0.1,
    /** A template whose pages share gaps (SA-007): its first gap, each more, the cap. */
    templateGaps: 0.3,
    perExtraGap: 0.05,
    templateGapsMax: 0.45,
    min: 0.1,
  }),
  ease: Object.freeze({
    /** Last score from here up: close to passing (70). */
    nearPassingScore: 0.6,
    middleScore: 0.4,
    nearPassing: 1,
    middle: 0.75,
    low: 0.55,
    unaudited: 0.8,
    /** Added for a page whose template shares its gaps (SA-007). */
    templateFix: 0.1,
  }),
});

/**
 * Each page's sessions as a share of the site's pages it beats (0–1), from
 * the site's 30-day sessions. As GA's value percentile (scorePages), ties
 * share a rank; a page above every site page is 1.
 *
 * @param {Array<number|null>} siteSessions
 * @returns {(sessions: number|null) => number|null}
 */
export function sessionsRanker(siteSessions) {
  const sorted = siteSessions.filter((n) => typeof n === 'number' && n > 0).sort((a, b) => a - b);
  return (sessions) => {
    if (!(sessions > 0) || sorted.length === 0) return null;
    let below = 0;
    while (below < sorted.length && sorted[below] < sessions) below += 1;
    return sorted.length === 1 ? 1 : Math.min(1, below / (sorted.length - 1));
  };
}

/**
 * @param {{ path?: string, reasons: Array<object>, sessions: number|null, aiVisits?: number|null, lastAudit: { score: number }|null }} row
 * @param {(sessions: number|null) => number|null} rankSessions
 * @param {Set<string>} [sharedTemplates]  templates whose pages share gaps (templates.js)
 * @returns {{ priority: number, value: number, opportunity: number, ease: number }}
 */
export function scorePriority(row, rankSessions, sharedTemplates = new Set()) {
  const w = PRIORITY_WEIGHTS;
  const reason = (type) => row.reasons.find((r) => r.type === type);

  const ga = reason('no_ai_traffic');
  const sessionsRank = rankSessions(row.sessions);
  const value = clamp(
    ga
      ? (ga.percentile / 100) * (w.value.signals[ga.signal] ?? w.value.signals.engagement)
      : (sessionsRank ?? 0) * w.value.sessions,
    w.value.min,
    1,
  );

  const o = w.opportunity;
  const competitor = reason('competitor_cited');
  let opportunity = 0;
  if (ga) opportunity += o.noAiTraffic;
  if (ga?.citationState === 'targeted_not_cited') opportunity += o.targetedNotCited;
  if (competitor) {
    opportunity += Math.min(
      o.competitorMax,
      o.competitorCited + o.perExtraPrompt * Math.max(0, competitor.prompts - 1),
    );
  }
  // Never audited is a fact about the page, whichever source listed it.
  if (row.lastAudit === null) opportunity += o.neverAudited;
  if (reason('stale_audit')) opportunity += o.staleAudit;
  // GA's reason already says the page has no AI traffic.
  if (!ga && row.aiVisits === 0) opportunity += o.zeroAiVisits;
  opportunity = clamp(opportunity, o.min, 1);

  const e = w.ease;
  const score = row.lastAudit?.score ?? null;
  const byScore =
    score === null
      ? e.unaudited
      : score >= e.nearPassingScore
        ? e.nearPassing
        : score >= e.middleScore
          ? e.middle
          : e.low;
  const ease = Math.min(
    1,
    byScore + (sharedTemplates.has(templateOf(row.path)) ? e.templateFix : 0),
  );

  return {
    priority: Math.round(100 * Math.cbrt(value * opportunity * ease)),
    value: round(value),
    opportunity: round(opportunity),
    ease: round(ease),
  };
}

/**
 * A template row's score (SA-007): value from its pages' summed sessions;
 * opportunity from the gaps they share, its pages not audited yet and no AI
 * visits; ease as a never-audited page's plus the template fix, since one
 * fix covers them all.
 *
 * @param {{ reasons: Array<object>, sessions: number|null, aiVisits?: number|null, template: { pages: number, audited: number } }} row
 * @param {(sessions: number|null) => number|null} rankSessions
 */
export function scoreTemplate(row, rankSessions) {
  const w = PRIORITY_WEIGHTS;
  const o = w.opportunity;
  const value = clamp((rankSessions(row.sessions) ?? 0) * w.value.sessions, w.value.min, 1);
  const gaps = row.reasons.find((r) => r.type === 'template_gaps')?.gaps.length ?? 0;
  const unaudited = row.template.pages > 0 ? 1 - row.template.audited / row.template.pages : 0;
  let opportunity = 0;
  if (gaps > 0) {
    opportunity += Math.min(o.templateGapsMax, o.templateGaps + o.perExtraGap * (gaps - 1));
  }
  opportunity += o.neverAudited * unaudited;
  if (row.aiVisits === 0) opportunity += o.zeroAiVisits;
  opportunity = clamp(opportunity, o.min, 1);
  const ease = Math.min(1, w.ease.unaudited + w.ease.templateFix);
  return {
    priority: Math.round(100 * Math.cbrt(value * opportunity * ease)),
    value: round(value),
    opportunity: round(opportunity),
    ease: round(ease),
  };
}

/**
 * Scores every row and orders the inbox: pinned pages first, then by
 * priority, then by path. A template row (SA-007) scores as a template.
 *
 * @template {{ path: string, pinned: boolean, reasons: Array<object>, sessions: number|null, aiVisits?: number|null, lastAudit: object|null }} R
 * @param {R[]} rows
 * @param {Array<number|null>} siteSessions  the site pages' 30-day sessions
 * @param {Set<string>} [sharedTemplates]  templates whose pages share gaps (SA-007)
 * @returns {Array<R & { priority: number, priorityParts: { value: number, opportunity: number, ease: number } }>}
 */
export function rankOpportunities(rows, siteSessions, sharedTemplates = new Set()) {
  const rankSessions = sessionsRanker(siteSessions);
  return rows
    .map((row) => {
      const { priority, ...priorityParts } = row.template
        ? scoreTemplate(row, rankSessions)
        : scorePriority(row, rankSessions, sharedTemplates);
      return { ...row, priority, priorityParts };
    })
    .sort(
      (a, b) =>
        Number(b.pinned) - Number(a.pinned) ||
        b.priority - a.priority ||
        a.path.localeCompare(b.path),
    );
}
