/**
 * Pure helpers for the Site Audit history reads (hub trend chart, the Pages
 * list and the raw audit list), kept out of the route so they can be unit
 * tested.
 */

import { normHost } from './host.js';

/** How many recent completed audits the trend endpoint reads. */
export const TREND_LIMIT = 500;

/** Default / maximum page size of the Recent audits list. */
export const LIST_DEFAULT_LIMIT = 50;
export const LIST_MAX_LIMIT = 100;

function toInt(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

/**
 * Parse `limit` / `offset` query params for the audit list. Missing or invalid
 * values fall back to the first page of LIST_DEFAULT_LIMIT, so callers that
 * pass neither keep the old "newest 50" behaviour.
 */
export function parseListPage(query = {}) {
  const limit = toInt(query.limit);
  const offset = toInt(query.offset);
  return {
    limit: limit !== null && limit > 0 ? Math.min(limit, LIST_MAX_LIMIT) : LIST_DEFAULT_LIMIT,
    offset: offset !== null && offset > 0 ? offset : 0,
  };
}

/**
 * Turn completed audit rows read NEWEST first into the chart's points: keep
 * only audits of the primary domain (host of final_url, else url) and return
 * them oldest → newest so the chart ends at the latest audit. A partial audit
 * (its AI-judged signals didn't run) isn't a point: its score isn't compared.
 */
export function buildTrendPoints(rowsNewestFirst, primaryHost) {
  if (!primaryHost) return [];
  return (rowsNewestFirst ?? [])
    .filter((r) => r.partial !== true)
    .filter((r) => (normHost(r.final_url) ?? normHost(r.url)) === primaryHost)
    .map((r) => ({
      id: r.id,
      createdAt: r.created_at,
      totalScore: r.total_score === null ? null : Number(r.total_score),
      categoryScores: r.category_scores ?? {},
    }))
    .reverse();
}

/** Score at or above which a page reads as Good (70/100). */
export const GOOD_SCORE = 0.7;

/** Completed scores drawn in a page's trend line, newest last. */
export const PAGE_TREND_POINTS = 10;

/** Runs listed under a page's history. */
export const PAGE_HISTORY_LIMIT = 50;

/**
 * One key per page, so repeat audits of it share a row: the host without
 * www. and the path without a trailing slash. Query and fragment are ignored.
 * Null for something that isn't a URL.
 */
export function pageKey(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./i, '').toLowerCase();
    const path = u.pathname.replace(/\/+$/, '') || '/';
    return { key: `${host}${path}`, host, path };
  } catch {
    return null;
  }
}

/**
 * The shared page identity used by the Pages list and a report's comparison.
 * Prefer the final URL because redirects should group with audits of their
 * destination; pageKey then ignores www, scheme, query, fragment and trailing
 * slash in the same way as buildAuditPages.
 */
function pageIdentityForAudit(row) {
  const url = row.final_url ?? row.url;
  return { url, ...(pageKey(url) ?? { key: url, host: null, path: url }) };
}

/**
 * How long a run may stay `running`. An audit takes a minute or two and a
 * queued bulk run waits longer; one older than this was cut short by a
 * restart (the bulk queue lives in memory) and will never complete, so it
 * reads as failed and stops holding a quota slot (planGuard.js).
 */
export const AUDIT_RUN_TIMEOUT_MS = 2 * 60 * 60 * 1000;

const points = (score) => Math.round(score * 100);

/**
 * A page's status from its runs (newest first) and its two latest completed
 * audits: Running while a run is in progress, Failed when none ever
 * completed, Good from 70, Improving below 70 when at least a point above the
 * previous audit, and Needs work otherwise.
 */
export function pageStatus(latestRun, current, previous) {
  if (latestRun?.status === 'running') return 'running';
  if (!current) return 'failed';
  if (current.totalScore >= GOOD_SCORE) return 'good';
  if (previous && points(current.totalScore) > points(previous.totalScore)) return 'improving';
  return 'needs_work';
}

/**
 * Group audit rows read NEWEST first into one entry per page (pageKey of
 * final_url, else url), most recently audited page first. Each page carries
 * its latest completed score and audit, the one before it, its first
 * completed score and when (progress since the first audit), a status, its
 * trend and its runs. A run still `running` past AUDIT_RUN_TIMEOUT_MS reads as
 * failed, so the page isn't left Running (and the hub polling) for good.
 * lastAuditSource says whether the audit the row opens was an auto-audit
 * run's (SA-006) or a user's; rows read without `source` count as the user's.
 * A partial audit (its AI-judged signals didn't run) is never compared: the
 * page keeps its latest complete score, and shows a partial one only when it
 * has no other, with no previous or first score.
 */
export function buildAuditPages(rowsNewestFirst, now = Date.now()) {
  const groups = new Map();
  // Rows read in slices can repeat one at a slice boundary.
  const seen = new Set();
  for (const r of rowsNewestFirst ?? []) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    const { url, ...page } = pageIdentityForAudit(r);
    if (!groups.has(page.key)) groups.set(page.key, { ...page, runs: [] });
    groups.get(page.key).runs.push({
      id: r.id,
      url,
      status:
        r.status === 'running' && now - Date.parse(r.created_at) > AUDIT_RUN_TIMEOUT_MS
          ? 'failed'
          : r.status,
      totalScore: r.total_score === null ? null : Number(r.total_score),
      partial: r.partial === true,
      createdAt: r.created_at,
      source: r.source === 'auto' ? 'auto' : 'user',
    });
  }

  return [...groups.values()].map(({ key, host, path, runs }) => {
    const scored = runs.filter((r) => r.status === 'completed' && r.totalScore !== null);
    const completed = scored.filter((r) => !r.partial);
    const latest = runs[0];
    const current = completed[0] ?? scored[0] ?? null;
    const previous = completed[0] ? (completed[1] ?? null) : null;
    // Every audit of the brand is read: the oldest complete one is the page's
    // first. Partial runs are skipped, as for `previous`: a page with only
    // partial audits has no first score to compare with.
    const first = completed.at(-1) ?? null;
    return {
      key,
      host,
      path,
      url: (current ?? latest).url,
      auditId: (current ?? latest).id,
      score: current?.totalScore ?? null,
      previousScore: previous?.totalScore ?? null,
      firstScore: first?.totalScore ?? null,
      firstAuditedAt: first?.createdAt ?? null,
      status: pageStatus(latest, current, previous),
      lastAuditedAt: (current ?? latest).createdAt,
      lastAuditSource: (current ?? latest).source,
      trend: completed
        .slice(0, PAGE_TREND_POINTS)
        .map((r) => r.totalScore)
        .reverse(),
      runs: runs.slice(0, PAGE_HISTORY_LIMIT),
      runCount: runs.length,
    };
  });
}

/**
 * Find the immediately previous completed, scored audit for one audit's page.
 * This assumes the same created_at / id descending order used by readBrandAudits.
 * Strictly earlier created_at timestamps are required; a failed, running,
 * unscored or partial audit never becomes the comparison point, and a
 * partial audit has none.
 */
export function findPreviousCompletedAudit(rowsNewestFirst, auditId) {
  const seen = new Set();
  let currentKey = null;
  let currentCreatedAt = null;
  let foundCurrent = false;

  for (const row of rowsNewestFirst ?? []) {
    // A paged read can repeat the same row at a slice boundary.
    if (seen.has(row.id)) continue;
    seen.add(row.id);

    const { key } = pageIdentityForAudit(row);

    if (!foundCurrent) {
      if (row.id !== auditId) continue;
      if (row.status !== 'completed' || row.total_score == null || row.partial === true) {
        return null;
      }

      currentCreatedAt = Date.parse(row.created_at);
      if (!Number.isFinite(currentCreatedAt)) return null;
      currentKey = key;
      foundCurrent = true;
      continue;
    }

    const createdAt = Date.parse(row.created_at);
    if (!Number.isFinite(createdAt) || createdAt >= currentCreatedAt) continue;
    if (key !== currentKey) continue;
    if (row.status !== 'completed' || row.total_score == null || row.partial === true) continue;

    return {
      auditId: row.id,
      totalScore: Number(row.total_score),
      createdAt: row.created_at,
    };
  }

  return null;
}
