import { z } from 'zod';

/**
 * Quality's weights against AI citations (Content Editor Quality spec §11,
 * Phase 3, CE-055): "check whether pages with higher scores get more AI
 * citations … Adjust the weights from the result. Until then, the
 * 'GetCito estimate' label stays."
 *
 * It reads rows a maintainer exports, one page each: its type's profile,
 * each check's share of its points (0–1) by score, the AI citations the
 * page got over the same window, and optionally a group (a salted hash of
 * its brand: correlations are read within each, so a big brand's pages
 * don't stand for a good score). It gives back aggregates only:
 *   - per profile, each score's rank correlation (Spearman's rho) with the
 *     citations, the page's score worked out as the web's weighed() does,
 *     with the weights in use and with the suggested ones (in-sample);
 *   - per check, the pages that had it, its rho and its 95% interval, and
 *     whether the interval leaves 0 out (only such a check is read);
 *   - suggested weights: half the weights in use, half the read checks'
 *     points shared by their positive rho; never 0 for a check weighed
 *     today (dropping one is the maintainer's call), each score's total kept.
 * Nothing here reads a database or the network, and nothing of a page (its
 * URL, its brand, its group) is in what it returns: a row's other fields
 * are dropped.
 */

export const QUALITY_PROFILES = ['article', 'product', 'category', 'feature', 'comparison'];
export const QUALITY_SCORES = ['eeat', 'trust', 'readability'];

/** The fewest pages a check's correlation is read from: fewer say nothing. */
export const MIN_PAGES = 30;
/** How much of a suggestion the correlations make: the rest is the weights in use. */
export const BLEND = 0.5;
/** The two-sided 95% normal quantile. */
const Z95 = 1.96;

const checkName = z.string().regex(/^[a-z][A-Za-z]{0,39}$/);
const shares = z.record(checkName, z.number().min(0).max(1));

/** One page's row: its profile, its checks' shares by score, its AI citations, its group. */
export const calibrationRow = z.object({
  profile: z.enum(QUALITY_PROFILES),
  checks: z.object({
    eeat: shares.optional(),
    trust: shares.optional(),
    readability: shares.optional(),
  }),
  // Only their ranks count: per day or per prompt is as good as a count.
  citations: z.number().min(0),
  group: z.string().min(1).max(128).optional(),
});

/** The weights in use, as PROFILE_WEIGHTS gives them: profile → score → check → points. */
export const calibrationWeights = z.partialRecord(
  z.enum(QUALITY_PROFILES),
  z.object({
    eeat: z.record(checkName, z.number().int().min(0)),
    trust: z.record(checkName, z.number().int().min(0)),
    readability: z.record(checkName, z.number().int().min(0)),
  }),
);

/** A text without the byte-order mark some editors start a file with. */
export const withoutBom = (text) => String(text).replace(/^\uFEFF/, '');

/**
 * The rows of a JSON-lines text: each line a page's row; a blank line is
 * skipped, and a line that isn't one is counted, never kept or printed.
 */
export function parseRows(text) {
  const rows = [];
  let invalid = 0;
  for (const line of withoutBom(text).split(/\r?\n/)) {
    if (!line.trim()) continue;
    let value;
    try {
      value = JSON.parse(line);
    } catch {
      invalid += 1;
      continue;
    }
    const row = calibrationRow.safeParse(value);
    if (row.success) rows.push(row.data);
    else invalid += 1;
  }
  return { rows, invalid };
}

/** Each value's rank, 1 for the smallest, ties sharing their average rank. */
export function ranks(values) {
  const order = values.map((value, i) => ({ value, i })).sort((a, b) => a.value - b.value);
  const out = new Array(values.length);
  for (let start = 0; start < order.length; ) {
    let end = start;
    while (end + 1 < order.length && order[end + 1].value === order[start].value) end += 1;
    const rank = (start + end) / 2 + 1;
    for (let k = start; k <= end; k += 1) out[order[k].i] = rank;
    start = end + 1;
  }
  return out;
}

/**
 * Spearman's rank correlation of two equal-length lists: -1 to 1, rounded
 * to three places; null below three pairs, or when either list is all one
 * value (it says nothing about the other).
 */
export function spearman(xs, ys) {
  if (xs.length !== ys.length || xs.length < 3) return null;
  const rx = ranks(xs);
  const ry = ranks(ys);
  const mean = (rx.length + 1) / 2;
  let cov = 0;
  let vx = 0;
  let vy = 0;
  for (let i = 0; i < rx.length; i += 1) {
    cov += (rx[i] - mean) * (ry[i] - mean);
    vx += (rx[i] - mean) ** 2;
    vy += (ry[i] - mean) ** 2;
  }
  if (vx === 0 || vy === 0) return null;
  return Math.round((cov / Math.sqrt(vx * vy)) * 1000) / 1000;
}

/**
 * A correlation's 95% interval from `n` pairs (Fisher's z), and whether it
 * leaves 0 out: only then does it say more than noise. Null below four pairs.
 */
export function interval(rho, n) {
  if (rho === null || n < 4) return null;
  const z = Math.atanh(Math.max(-0.999999, Math.min(0.999999, rho)));
  const half = Z95 / Math.sqrt(n - 3);
  const round = (v) => Math.round(Math.tanh(v) * 1000) / 1000;
  const low = round(z - half);
  const high = round(z + half);
  return { low, high, read: low > 0 || high < 0 };
}

/**
 * A correlation between a value and the citations over pages, read within
 * each group where pages have one (each brand's own correlation, weighed by
 * its pages: a big brand's pages, cited more whatever their checks, aren't
 * a good score), else over them all; null where nothing can be read.
 * Returns the pages it was read from too, for the interval.
 */
export function groupedSpearman(pairs) {
  if (!pairs.some((p) => p.group !== undefined)) {
    return {
      rho: spearman(
        pairs.map((p) => p.x),
        pairs.map((p) => p.y),
      ),
      pages: pairs.length,
    };
  }
  const groups = new Map();
  for (const p of pairs) {
    const key = p.group ?? '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }
  let sum = 0;
  let pages = 0;
  for (const members of groups.values()) {
    const rho = spearman(
      members.map((p) => p.x),
      members.map((p) => p.y),
    );
    if (rho === null) continue;
    sum += rho * members.length;
    pages += members.length;
  }
  return { rho: pages ? Math.round((sum / pages) * 1000) / 1000 : null, pages };
}

/** A page's score as the web's weighed() gives it: its checks' shares by their points, 0–100; null with none. */
export function scoreOf(checks, weights) {
  let points = 0;
  let max = 0;
  for (const [check, share] of Object.entries(checks ?? {})) {
    const weight = weights[check] ?? 0;
    if (weight <= 0) continue;
    points += share * weight;
    max += weight;
  }
  return max > 0 ? Math.round((points / max) * 100) : null;
}

/**
 * Integer points that add up to `total`, as near as can be to the values
 * given (the largest remainders round up), none under its floor.
 */
function toPoints(values, total, floors = {}) {
  const keys = Object.keys(values);
  const out = Object.fromEntries(
    keys.map((k) => [k, Math.max(floors[k] ?? 0, Math.floor(values[k]))]),
  );
  let left = total - keys.reduce((s, k) => s + out[k], 0);
  const order = [...keys].sort((a, b) => (values[b] % 1) - (values[a] % 1));
  for (const k of order) {
    if (left <= 0) break;
    out[k] += 1;
    left -= 1;
  }
  // Floors that took more than their share give it back from the largest.
  for (const k of [...keys].sort((a, b) => out[b] - out[a])) {
    while (left < 0 && out[k] > (floors[k] ?? 0)) {
      out[k] -= 1;
      left += 1;
    }
  }
  return out;
}

/**
 * A score's weights as its checks' correlations suggest: the read checks'
 * points (a check read from enough pages, its interval leaving 0 out),
 * half kept as they are, half shared by positive rho; a check not read
 * keeps its points, and none weighed today goes under 1. The score's total
 * stays as it was. With no positive read check, the weights stay as they are.
 */
export function suggestWeights(current, stats, blend = BLEND) {
  const read = Object.keys(current).filter(
    (check) => current[check] > 0 && stats[check]?.interval?.read === true,
  );
  const positive = Object.fromEntries(read.map((c) => [c, Math.max(0, stats[c].rho)]));
  const sum = Object.values(positive).reduce((a, b) => a + b, 0);
  if (!read.length || sum === 0) return { ...current };
  const budget = read.reduce((total, c) => total + current[c], 0);
  const values = Object.fromEntries(
    read.map((c) => [c, (1 - blend) * current[c] + blend * (positive[c] / sum) * budget]),
  );
  const floors = Object.fromEntries(read.map((c) => [c, 1]));
  return { ...current, ...toPoints(values, budget, floors) };
}

/**
 * The calibration: per profile, its pages; per score, its correlation with
 * the citations (with the weights in use and the suggested ones) and per
 * check, the pages with it, its correlation and interval (none when fewer
 * than `minPages` pages had it); with the weights in use, the ones suggested.
 */
export function calibrate(rows, { minPages = MIN_PAGES, weights = null } = {}) {
  const profiles = {};
  for (const profile of QUALITY_PROFILES) {
    const pages = rows.filter((row) => row.profile === profile);
    if (!pages.length) continue;
    const scores = {};
    for (const score of QUALITY_SCORES) {
      const checks = new Set(pages.flatMap((row) => Object.keys(row.checks[score] ?? {})));
      const stats = {};
      for (const check of [...checks].sort()) {
        const pairs = pages.flatMap((row) =>
          row.checks[score]?.[check] !== undefined
            ? [{ x: row.checks[score][check], y: row.citations, group: row.group }]
            : [],
        );
        const read = pairs.length >= minPages ? groupedSpearman(pairs) : null;
        const rho = read ? read.rho : null;
        stats[check] = { pages: pairs.length, rho, interval: interval(rho, read?.pages ?? 0) };
      }
      const current = weights?.[profile]?.[score] ?? null;
      const suggested = current ? suggestWeights(current, stats) : null;
      // The score itself against the citations: the spec's question.
      const scored = (w) => {
        const pairs = pages.flatMap((row) => {
          const value = scoreOf(row.checks[score], w);
          return value === null ? [] : [{ x: value, y: row.citations, group: row.group }];
        });
        return pairs.length >= minPages ? groupedSpearman(pairs).rho : null;
      };
      scores[score] = {
        checks: stats,
        ...(current
          ? { rho: scored(current), suggested, rhoSuggestedInSample: scored(suggested) }
          : {}),
      };
    }
    profiles[profile] = { pages: pages.length, scores };
  }
  return { pages: rows.length, minPages, profiles };
}
