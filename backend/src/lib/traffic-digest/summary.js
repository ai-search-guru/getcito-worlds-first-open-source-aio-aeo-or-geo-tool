/**
 * What the AI Traffic weekly digest says (AT-013, spec §3.8): "the summary
 * line and the top three changes". Pure: the engine reads the numbers, the
 * e-mail lays them out.
 *
 * The summary line is the AI Traffic page's (AT-007), with the same rules,
 * written here because the server can't import the web's TypeScript
 * (frontend/src/lib/trafficSummaryLine.ts and its copy in en.json
 * traffic.summaryLine):
 *
 *   - the change on the week before only when both weeks have 30 visits;
 *   - the share of all traffic and the best-converting platform only from
 *     Google Analytics, the latter when two platforms have 30 visits and 5
 *     key events;
 *   - the cited pages nobody clicks, and the Google queries no prompt tracks.
 */

import { createRequire } from 'module';
import { ENGINE_THRESHOLDS } from '../../config/actionEngine.js';

// The AI Traffic page's names (frontend/src/lib/trafficPlatforms.ts); a web test
// keeps the two the same.
const require = createRequire(import.meta.url);
const PLATFORM_NAMES = require('./platform-names.json');

const DAY_MS = 86_400_000;

/** Below this many visits in either week, no % change (the page's Low sample). */
export const LOW_SAMPLE_VISITS = 30;
/** Key events a platform needs before its conversions are compared (§5.4). */
export const MIN_COMPARED_KEY_EVENTS = 5;
/** A platform or page has to move by this many visits to be a change worth naming. */
export const MIN_CHANGE_VISITS = 3;
/** "The top three changes." */
export const TOP_CHANGES = 3;

export const platformName = (key) => PLATFORM_NAMES[key] ?? key;

/**
 * A platform the page can name. The snippet's beacon is public, so a source
 * key can be anything a caller sent; the e-mail names only the platforms it
 * knows (old keys included), never `unknown`.
 */
export const isNamedPlatform = (key) =>
  key !== 'unknown' && Object.hasOwn(PLATFORM_NAMES, String(key ?? ''));

const n = (value) => Number(value) || 0;
const formatNumber = (value) => Math.round(value).toLocaleString('en-US');
const plural = (count, one, other) => (count === 1 ? one : other);

/**
 * The week a digest reports: the last whole Monday-to-Sunday week (UTC)
 * before `now`'s. `end` is the next Monday, excluded.
 */
export function digestWeek(now) {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const sinceMonday = (now.getUTCDay() + 6) % 7;
  const end = new Date(today - sinceMonday * DAY_MS);
  const start = new Date(end.getTime() - 7 * DAY_MS);
  const prevStart = new Date(start.getTime() - 7 * DAY_MS);
  const day = (d) => d.toISOString().slice(0, 10);
  return {
    start: start.toISOString(),
    end: end.toISOString(),
    prevStart: prevStart.toISOString(),
    firstDay: day(start),
    lastDay: day(new Date(end.getTime() - DAY_MS)),
    prevFirstDay: day(prevStart),
    prevLastDay: day(new Date(start.getTime() - DAY_MS)),
  };
}

/** AI visits on each day of the week, Monday first, from ai_traffic_merged's days. */
export function dailyVisits(week, days = []) {
  const totals = new Map();
  for (const d of days) {
    const day = String(d.day).slice(0, 10);
    totals.set(day, (totals.get(day) ?? 0) + n(d.visits));
  }
  return Array.from({ length: 7 }, (_, i) => {
    const day = new Date(Date.parse(week.start) + i * DAY_MS).toISOString().slice(0, 10);
    return { day, visits: totals.get(day) ?? 0 };
  });
}

/** The week's platforms with visits, most first, at most `limit`. */
export function topPlatforms(platforms = [], limit = 5) {
  return platforms
    .map((p) => ({ platform: String(p.platform ?? ''), visits: n(p.visits) }))
    .filter((p) => p.visits > 0 && isNamedPlatform(p.platform))
    .sort((a, b) => b.visits - a.visits || a.platform.localeCompare(b.platform))
    .slice(0, limit);
}

/** The page's change rule (frontend/src/lib/trafficChange.ts): a % only on 30 visits each. */
export function visitChangePct(current, previous) {
  if (previous === 0 || current < LOW_SAMPLE_VISITS || previous < LOW_SAMPLE_VISITS) return null;
  const pct = Math.round(((current - previous) / previous) * 100);
  return pct === 0 ? null : pct;
}

/** "0.8%" of all traffic, as the page's KPI writes it. */
export function formatShare(part, whole) {
  if (whole <= 0) return null;
  const pct = (part / whole) * 100;
  if (pct > 0 && pct < 0.1) return '<0.1%';
  const rounded = pct < 10 ? Math.round(pct * 10) / 10 : Math.round(pct);
  return `${rounded.toLocaleString('en-US')}%`;
}

/** The platform whose visitors convert best, when two or more can be compared. */
export function bestConvertingPlatform(value = []) {
  const compared = value.flatMap((p) => {
    const sessions = n(p.sessions);
    if (sessions < LOW_SAMPLE_VISITS || n(p.key_events) < MIN_COMPARED_KEY_EVENTS) return [];
    if (n(p.key_event_sessions) <= 0) return [];
    return [{ platform: p.platform, rate: n(p.key_event_sessions) / sessions }];
  });
  if (compared.length < 2) return null;
  const best = compared.reduce((a, b) => (b.rate > a.rate ? b : a));
  return { platform: best.platform, rate: Math.round(best.rate * 1000) / 10 };
}

/**
 * The summary line's sentences, in the page's words.
 *
 * @param {{ visits: number, prevVisits: number, platforms: {platform: string, visits: number}[],
 *   gaSessions: number | null, platformValue: object[] | null, citedNotClicked: number,
 *   untrackedQueries: number }} input
 */
export function summarySentences(input) {
  const visits = n(input.visits);
  if (visits === 0) return ['Last week: no AI-referred visits.'];

  const sentences = [];
  const first = [
    `Last week: ${formatNumber(visits)} ${plural(visits, 'AI-referred visit', 'AI-referred visits')}`,
  ];
  const share = input.gaSessions !== null ? formatShare(visits, n(input.gaSessions)) : null;
  if (share) first.push(`${share} of all traffic`);
  const change = visitChangePct(visits, n(input.prevVisits));
  if (change !== null) {
    first.push(`${change > 0 ? 'up' : 'down'} ${Math.abs(change)}% on the week before`);
  }
  sentences.push(`${first.join(', ')}.`);

  const top = [...(input.platforms ?? [])]
    .filter((p) => n(p.visits) > 0 && isNamedPlatform(p.platform))
    .sort((a, b) => n(b.visits) - n(a.visits))[0];
  const best = input.gaSessions !== null ? bestConvertingPlatform(input.platformValue ?? []) : null;
  const rate = best ? `${best.rate.toLocaleString('en-US')}%` : '';
  if (top && best && best.platform === top.platform) {
    sentences.push(
      `${platformName(top.platform)} sent the most (${formatNumber(n(top.visits))}), and its visitors convert best (${rate} of their visits had a key event).`,
    );
  } else {
    const second = [];
    if (top)
      second.push(`${platformName(top.platform)} sent the most (${formatNumber(n(top.visits))})`);
    if (best) {
      second.push(
        `${platformName(best.platform)} visitors convert best (${rate} of their visits had a key event)`,
      );
    }
    if (second.length) sentences.push(`${second.join('; ')}.`);
  }

  const cited = n(input.citedNotClicked);
  if (cited > 0) {
    sentences.push(
      cited === 1
        ? '1 page is cited in AI answers but gets no clicks.'
        : `${formatNumber(cited)} pages are cited in AI answers but get no clicks.`,
    );
  }
  const untracked = n(input.untrackedQueries);
  if (untracked > 0) {
    sentences.push(
      `${formatNumber(untracked)} Google ${plural(untracked, 'query', 'queries')} with clicks ${plural(untracked, "isn't", "aren't")} tracked as prompts.`,
    );
  }
  return sentences;
}

function movers(cur = [], prev = [], keyOf, type, accept) {
  const before = new Map();
  const now = new Map();
  const names = new Map();
  for (const [list, into] of [
    [prev, before],
    [cur, now],
  ]) {
    for (const row of list) {
      const raw = keyOf(row);
      if (!raw || raw === 'unknown') continue;
      const key = type === 'page' ? raw.toLowerCase() : raw;
      if (accept && !accept(key)) continue;
      if (!names.has(key)) names.set(key, raw);
      into.set(key, (into.get(key) ?? 0) + n(row.visits));
    }
  }
  return [...names.entries()].map(([key, name]) => ({
    type,
    name,
    before: before.get(key) ?? 0,
    now: now.get(key) ?? 0,
  }));
}

/**
 * The pages whose AI visits moved by MIN_CHANGE_VISITS or more, keyed as the
 * Pages section keys them: the ones the digest asks ai_traffic_known_pages
 * (00194) about before it may name them.
 */
export function pageCandidates({ cur, prev }) {
  return movers(cur?.pages, prev?.pages, (r) => r.page, 'page')
    .filter((m) => Math.abs(m.now - m.before) >= MIN_CHANGE_VISITS)
    .map((m) => m.name.toLowerCase())
    .sort();
}

/**
 * The missing pages worth a line, as the broken_citation_target signal reads
 * them (#1228): one AI answers cite from its first visit, any other from
 * brokenLinkMinVisits. The beacon is public, so one stray or made-up 404
 * visit doesn't reach the e-mail.
 */
export function brokenRows(broken) {
  const rows = Array.isArray(broken?.rows) ? broken.rows : [];
  return rows.filter(
    (r) => n(r.citations) > 0 || n(r.visits) >= ENGINE_THRESHOLDS.library.brokenLinkMinVisits,
  );
}

/**
 * The broken link the e-mail would name and its redirect, keyed as
 * pageCandidates are: they go to ai_traffic_known_pages too, since both can
 * come from the beacon (00186 picks redirects among the pages it logged).
 */
export function brokenCandidates(broken) {
  const [top] = brokenRows(broken);
  if (!top) return [];
  return [top.page, top.target].filter(Boolean).map((p) => String(p).toLowerCase());
}

/**
 * The week's top changes: broken AI links first — visitors are landing on
 * missing pages every day until someone adds a redirect — then the platforms
 * and pages whose AI visits moved most, by at least MIN_CHANGE_VISITS. Only
 * platforms the page can name, and pages a source other than the public
 * beacon knows (`knownPages`, from ai_traffic_known_pages); without it, no
 * page. A broken link is named when AI answers cite it or it's known, and
 * its redirect when that's known; otherwise the line gives only the count.
 */
export function topChanges({ cur, prev, broken, knownPages }, limit = TOP_CHANGES) {
  const changes = [];
  const known = knownPages ?? new Set();
  const isKnown = (page) => !!page && known.has(String(page).toLowerCase());
  const rows = brokenRows(broken);
  if (rows.length > 0) {
    const [top] = rows;
    const named = n(top.citations) > 0 || isKnown(top.page);
    changes.push({
      type: 'broken',
      count: rows.length,
      page: named ? top.page : null,
      target: named && isKnown(top.target) ? top.target : null,
    });
  }
  const moved = [
    ...movers(cur?.platforms, prev?.platforms, (r) => r.platform, 'platform', isNamedPlatform),
    ...movers(
      cur?.pages,
      prev?.pages,
      (r) => r.page,
      'page',
      (key) => known.has(key),
    ),
  ]
    .filter((m) => Math.abs(m.now - m.before) >= MIN_CHANGE_VISITS)
    .sort(
      (a, b) =>
        Math.abs(b.now - b.before) - Math.abs(a.now - a.before) ||
        b.now - a.now ||
        a.name.localeCompare(b.name),
    );
  return [...changes, ...moved].slice(0, limit);
}

/** One change as the e-mail says it. */
export function changeText(change) {
  if (change.type === 'broken') {
    const pages =
      change.count === 1
        ? '1 page AI visitors landed on doesn’t exist'
        : `${formatNumber(change.count)} pages AI visitors landed on don’t exist`;
    if (!change.page) return `${pages}.`;
    const redirect = change.target ? `, redirect to ${change.target}` : '';
    return `${pages}: ${change.page}${redirect}.`;
  }
  const subject = change.type === 'platform' ? platformName(change.name) : change.name;
  const verb = change.type === 'platform' ? 'sent' : 'got';
  if (change.before === 0) {
    // Not "its first": a page or platform may be coming back after a quiet week.
    return `${subject} ${verb} ${formatNumber(change.now)} AI ${plural(change.now, 'visit', 'visits')}, none the week before.`;
  }
  const direction = change.now > change.before ? 'up' : 'down';
  return `${subject} ${verb} ${formatNumber(change.now)} AI ${plural(change.now, 'visit', 'visits')}, ${direction} from ${formatNumber(change.before)}.`;
}
