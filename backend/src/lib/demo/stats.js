/**
 * The demo's own numbers, read from its core rows in memory: what the
 * Action Center, Content and Reports modules say about Brewline Coffee
 * (a signal's "from 34% to 27%", an opportunity's visibility, a report's
 * KPIs) is counted from the same answers the pages read, the way the daily
 * rollups count them (insights_brand_daily, 00164): an answer is mentioning
 * when its mention_count > 0, citing when its citation_count > 0, and its
 * position factor is the mean of 1 / mention_position.
 */

import { computeAiVisibilityScore } from '../../config/visibilityScore.js';
import { PROMPTS } from './brewline.js';
import { coreRows, latestRunStart, RUN_EVERY_DAYS, RUNS } from './core.js';

export const DAY_MS = 24 * 60 * 60 * 1000;
export const HOUR_MS = 60 * 60 * 1000;

const round1 = (n) => Math.round(n * 10) / 10;

let cached = null;

/**
 * The core rows a module builds on, with the lookups every module needs.
 * Built once per demo build (same brand, same moment), not once per module.
 *
 * @param {string} brandId
 * @param {Date} now
 */
export function demoContext(brandId, now) {
  if (cached && cached.brandId === brandId && cached.at === now.getTime()) return cached.ctx;
  const rows = coreRows({ brandId, now });
  const promptIds = new Map(PROMPTS.map((p, i) => [p.key, rows.prompts[i].id]));
  const keys = new Map(PROMPTS.map((p, i) => [rows.prompts[i].id, p.key]));
  const volumes = new Map(rows.volumes.map((v) => [v.prompt_id, v]));
  const ctx = {
    brandId,
    now,
    rows,
    starts: runStarts(now),
    /** A prompt's id from its key in brewline.js. */
    promptId: (key) => promptIds.get(key),
    /** A prompt's key from its id. */
    promptKey: (id) => keys.get(id),
    /** A prompt's text from its id. */
    promptText: (id) => rows.prompts.find((p) => p.id === id)?.text ?? '',
    /** A prompt's prompt_volumes row. */
    volume: (id) => volumes.get(id) ?? null,
    competitorId: (name) => rows.competitors.find((c) => c.name === name)?.id ?? null,
  };
  cached = { brandId, at: now.getTime(), ctx };
  return ctx;
}

/** `YYYY-MM-DD` of a date or an ISO string. */
export function utcDay(value) {
  return (typeof value === 'string' ? value : value.toISOString()).slice(0, 10);
}

/** When each of the demo's runs started, oldest first (core's dates). */
export function runStarts(now) {
  const latest = latestRunStart(now);
  return Array.from(
    { length: RUNS },
    (_, i) => new Date(latest.getTime() - (RUNS - 1 - i) * RUN_EVERY_DAYS * DAY_MS),
  );
}

/**
 * A moment counted from one run's start: `afterRun(starts, 7, 2)` is two
 * hours after the eighth run began, when the nightly engine has read it.
 */
export function afterRun(starts, run, hours = 1) {
  return new Date(starts[run].getTime() + hours * HOUR_MS);
}

/** The answers of the given runs (core writes 72 a run, in run order). */
export function runResults(results, runs) {
  const perRun = results.length / RUNS;
  return runs.flatMap((run) => results.slice(run * perRun, (run + 1) * perRun));
}

/** The answers whose day falls in [from, to], both `YYYY-MM-DD`. */
export function between(results, from, to) {
  return results.filter((r) => {
    const day = utcDay(r.created_at);
    return day >= from && day <= to;
  });
}

/** The `days` whole days before `date`'s day (validate.js windowEndingBefore). */
export function windowBefore(date, days) {
  const to = new Date(date.getTime() - DAY_MS);
  return { from: utcDay(new Date(to.getTime() - (days - 1) * DAY_MS)), to: utcDay(to) };
}

/** The `days` whole days after `date`'s day (validate.js windowStartingAfter). */
export function windowAfter(date, days) {
  const from = new Date(date.getTime() + DAY_MS);
  return { from: utcDay(from), to: utcDay(new Date(from.getTime() + (days - 1) * DAY_MS)) };
}

/**
 * What a set of answers says about the brand, as the rollups count it, and
 * its AI Visibility Score (config/visibilityScore.js).
 */
export function brandStats(results) {
  const answers = results.length;
  const mentioning = results.filter((r) => r.mention_count > 0);
  const citationAnswers = results.filter((r) => r.citation_count > 0).length;
  const visibleAnswers = results.filter((r) => r.mention_count > 0 || r.citation_count > 0).length;
  const positions = mentioning.map((r) => r.mention_position).filter((p) => p > 0);
  const positionFactor = positions.length
    ? positions.reduce((sum, p) => sum + 1 / p, 0) / positions.length
    : 0;
  return {
    answers,
    mentionAnswers: mentioning.length,
    mentions: mentioning.reduce((sum, r) => sum + r.mention_count, 0),
    citationAnswers,
    citations: results.reduce((sum, r) => sum + (r.citation_count ?? 0), 0),
    visibleAnswers,
    positionFactor: Math.round(positionFactor * 1000) / 1000,
    positive: mentioning.filter((r) => r.sentiment === 'positive').length,
    negative: mentioning.filter((r) => r.sentiment === 'negative').length,
    score: answers
      ? computeAiVisibilityScore({
          answers,
          mentionAnswers: mentioning.length,
          citationAnswers,
          positionFactor,
        })
      : null,
    /** Share of answers naming the brand, in percent. */
    mentionRate: answers ? round1((mentioning.length / answers) * 100) : null,
  };
}

/** The same for each tracked competitor, by name, from the answers' competitor_mentions. */
export function competitorStats(results) {
  const byName = new Map();
  for (const r of results) {
    for (const c of r.competitor_mentions ?? []) {
      const s = byName.get(c.name) ?? {
        id: c.competitor_id,
        name: c.name,
        mentionAnswers: 0,
        mentions: 0,
        citationAnswers: 0,
        inverse: 0,
        positioned: 0,
      };
      if (c.mention_count > 0) {
        s.mentionAnswers += 1;
        s.mentions += c.mention_count;
      }
      if (c.citation_count > 0) s.citationAnswers += 1;
      if (c.mention_position > 0) {
        s.inverse += 1 / c.mention_position;
        s.positioned += 1;
      }
      byName.set(c.name, s);
    }
  }
  const answers = results.length;
  return new Map(
    [...byName].map(([name, s]) => {
      const positionFactor = s.positioned ? s.inverse / s.positioned : 0;
      return [
        name,
        {
          id: s.id,
          name,
          mentionAnswers: s.mentionAnswers,
          mentions: s.mentions,
          citationAnswers: s.citationAnswers,
          positionFactor,
          score: answers
            ? computeAiVisibilityScore({
                answers,
                mentionAnswers: s.mentionAnswers,
                citationAnswers: s.citationAnswers,
                positionFactor,
              })
            : null,
          mentionRate: answers ? round1((s.mentionAnswers / answers) * 100) : null,
        },
      ];
    }),
  );
}

/** Answers grouped by a key of theirs (`prompt_id`, `platform`). */
export function groupBy(results, key) {
  const groups = new Map();
  for (const r of results) {
    if (!groups.has(r[key])) groups.set(r[key], []);
    groups.get(r[key]).push(r);
  }
  return groups;
}

/** Share of voice in percent: the brand's mentioning answers against all named. */
export function shareOfVoice(results) {
  const brand = brandStats(results).mentionAnswers;
  const rivals = [...competitorStats(results).values()].reduce((s, c) => s + c.mentionAnswers, 0);
  return brand + rivals > 0 ? round1((brand / (brand + rivals)) * 100) : null;
}
