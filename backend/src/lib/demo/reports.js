/**
 * The demo brand's saved reports (demo-workflows): a weekly visibility
 * summary and a competitor benchmark, as the Reports page lists them and
 * the detail page renders them, purely from the stored payload (00023).
 *
 * A report is gathered by the web app (frontend/src/lib/actions/reports.ts) and
 * stored whole, so the server has no builder to call: the payload here
 * follows its ReportPayload shape section by section, with every number
 * counted from the demo's answers over the report's window (stats.js), and
 * a summary written from those numbers where the web asks a model for one.
 */

import supabaseAdmin from '../../config/supabase.js';
import { IMPROVE_PLATFORM_LABELS } from '../promptImprove.js';
import { BRAND, TOPICS } from './brewline.js';
import { demoId } from './random.js';
import { demoWriter } from './write.js';
import * as S from './stats.js';

const TEMPLATE_TITLES = {
  weekly_visibility: 'Weekly Visibility Summary',
  competitor_benchmark: 'Competitor Benchmark',
};

const round1 = (n) => Math.round(n * 10) / 10;
const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
const percentChange = (cur, prev) => (prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null);

/** The answers in [from, to), by their timestamps. */
const within = (results, from, to) =>
  results.filter((r) => r.created_at >= from.toISOString() && r.created_at < to.toISOString());

/** The Insights KPIs over a window and the one before it (getInsightsSummary). */
function insights(cur, prev) {
  const c = S.brandStats(cur);
  const p = S.brandStats(prev);
  const avgVis = (rows) => round1(mean(rows.map((r) => r.visibility_score ?? 0)));
  const positivePct = (b) =>
    b.mentionAnswers ? Math.round((b.positive / b.mentionAnswers) * 100) : 0;
  const rates = (rows, b) => {
    const positions = rows.map((r) => r.mention_position).filter((x) => x > 0);
    return {
      citationRate: b.answers ? round1((b.citationAnswers / b.answers) * 100) : null,
      netSentiment: b.mentionAnswers
        ? round1(((b.positive - b.negative) / b.mentionAnswers) * 100)
        : null,
      avgPosition: positions.length ? round1(mean(positions)) : null,
    };
  };
  const cr = rates(cur, c);
  const pr = rates(prev, p);
  // Changes need answers on both sides, as the Insights page asks.
  const both = cur.length > 0 && prev.length > 0;
  const diff = (a, b) => (!both || a === null || b === null ? null : round1(a - b));
  return {
    avgVisibilityScore: avgVis(cur),
    totalMentions: c.mentions,
    totalCitations: c.citations,
    positiveSentimentPct: positivePct(c),
    totalResults: c.answers,
    lastCheckedAt: cur.at(-1)?.created_at ?? null,
    platformBreakdown: [...S.groupBy(cur, 'model_used')].map(([platform, rows]) => ({
      platform,
      avgScore: Math.round(mean(rows.map((r) => r.visibility_score ?? 0))),
      resultCount: rows.length,
    })),
    visibilityChange: both ? round1(avgVis(cur) - avgVis(prev)) : null,
    mentionsChange: both ? percentChange(c.mentions, p.mentions) : null,
    citationsChange: both ? percentChange(c.citations, p.citations) : null,
    prevMentions: both ? p.mentions : null,
    prevCitations: both ? p.citations : null,
    sentimentChange: both ? positivePct(c) - positivePct(p) : null,
    citationRate: cr.citationRate,
    citationRateChange: diff(cr.citationRate, pr.citationRate),
    negativeSentimentPct: c.mentionAnswers ? Math.round((c.negative / c.mentionAnswers) * 100) : 0,
    netSentiment: cr.netSentiment,
    netSentimentChange: diff(cr.netSentiment, pr.netSentiment),
    avgPosition: cr.avgPosition,
    avgPositionChange: diff(cr.avgPosition, pr.avgPosition),
    mentioningResults: c.mentionAnswers,
    positionedResults: cur.filter((r) => r.mention_position > 0).length,
  };
}

/** The prompt-level Visibility Rate and the AI Visibility Score (getReportVisibilityRate). */
function visibilityRate(rows) {
  const b = S.brandStats(rows);
  const prompts = new Set(rows.map((r) => r.prompt_id));
  const visible = new Set(
    rows.filter((r) => r.mention_count > 0 || r.citation_count > 0).map((r) => r.prompt_id),
  );
  return {
    visiblePrompts: visible.size,
    promptCount: prompts.size,
    ratePct: prompts.size ? round1((visible.size / prompts.size) * 100) : 0,
    score: b.score,
    mentionAnswers: b.mentionAnswers,
    citationAnswers: b.citationAnswers,
    positionFactor: b.positionFactor,
  };
}

/** One point a tracked day: the brand's score and its rivals' average. */
function trend(rows) {
  return [
    ...S.groupBy(
      rows.map((r) => ({ ...r, day: S.utcDay(r.created_at) })),
      'day',
    ),
  ]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, dayRows]) => {
      const rivals = [...S.competitorStats(dayRows).values()].map((c) => c.score);
      return {
        date,
        score: S.brandStats(dayRows).score ?? 0,
        competitors: rivals.length ? round1(mean(rivals)) : null,
      };
    });
}

/** Share of voice, overall and by engine, against the window before. */
function shareOfVoice(cur, prev) {
  const overall = S.shareOfVoice(cur) ?? 0;
  const before = S.shareOfVoice(prev);
  return {
    overallSov: overall,
    overallSovChange: before === null ? null : round1(overall - before),
    byPlatform: [...S.groupBy(cur, 'platform')].map(([provider, rows]) => {
      const brandMentions = S.brandStats(rows).mentionAnswers;
      const competitorMentions = [...S.competitorStats(rows).values()].reduce(
        (s, c) => s + c.mentionAnswers,
        0,
      );
      return {
        provider,
        brandMentions,
        competitorMentions,
        sov: S.shareOfVoice(rows) ?? 0,
      };
    }),
  };
}

/** The brand beside each rival (getCompetitorComparison). */
function competitors(cur, prev) {
  const promptCount = new Set(cur.map((r) => r.prompt_id)).size;
  const visiblePrompts = (rows, named) => new Set(rows.filter(named).map((r) => r.prompt_id)).size;
  const rate = (n) => (promptCount ? round1((n / promptCount) * 100) : 0);

  const b = S.brandStats(cur);
  const pb = S.brandStats(prev);
  const ownVisible = visiblePrompts(cur, (r) => r.mention_count > 0);
  const ownPrevVisible = visiblePrompts(prev, (r) => r.mention_count > 0);
  const own = {
    name: BRAND.name,
    avgVisibilityScore: round1(mean(cur.map((r) => r.visibility_score ?? 0))),
    visibilityRate: rate(ownVisible),
    visiblePrompts: ownVisible,
    promptCount,
    change: prev.length ? round1(rate(ownVisible) - rate(ownPrevVisible)) : null,
    score: b.score,
    scoreChange: pb.score === null ? null : round1(b.score - pb.score),
    mentionAnswers: b.mentionAnswers,
    citationAnswers: b.citationAnswers,
    positionFactor: b.positionFactor,
    totalMentions: b.mentions,
    totalCitations: b.citations,
    resultCount: b.answers,
    isOwnBrand: true,
  };

  const before = S.competitorStats(prev);
  const rivals = [...S.competitorStats(cur).values()].map((c) => {
    const named = (r) =>
      (r.competitor_mentions ?? []).some((m) => m.name === c.name && m.mention_count > 0);
    const visible = visiblePrompts(cur, named);
    const prevVisible = visiblePrompts(prev, named);
    const p = before.get(c.name);
    const scores = cur.flatMap((r) =>
      (r.competitor_mentions ?? [])
        .filter((m) => m.name === c.name)
        .map((m) => m.visibility_score ?? 0),
    );
    return {
      name: c.name,
      avgVisibilityScore: round1(mean(scores)),
      visibilityRate: rate(visible),
      visiblePrompts: visible,
      promptCount,
      change: prev.length ? round1(rate(visible) - rate(prevVisible)) : null,
      score: c.score,
      scoreChange: p?.score == null ? null : round1(c.score - p.score),
      mentionAnswers: c.mentionAnswers,
      citationAnswers: c.citationAnswers,
      positionFactor: Math.round(c.positionFactor * 1000) / 1000,
      totalMentions: c.mentions,
      totalCitations: cur.reduce(
        (s, r) =>
          s +
          (r.competitor_mentions ?? [])
            .filter((m) => m.name === c.name)
            .reduce((n, m) => n + (m.citation_count ?? 0), 0),
        0,
      ),
      resultCount: cur.length,
      isOwnBrand: false,
      competitorId: c.id,
    };
  });
  return [own, ...rivals.sort((a, b2) => b2.score - a.score)];
}

/** Each topic's visibility against the window before (getTopicPerformance). */
function topicPerformance(ctx, cur, prev) {
  return TOPICS.map((t) => {
    const ids = new Set(
      ctx.rows.prompts
        .filter((p) => p.topic_id === demoId(ctx.brandId, `topic:${t.key}`))
        .map((p) => p.id),
    );
    const rows = cur.filter((r) => ids.has(r.prompt_id));
    const before = prev.filter((r) => ids.has(r.prompt_id));
    const b = S.brandStats(rows);
    const pb = S.brandStats(before);
    return {
      name: t.name,
      avgVisibility: round1(mean(rows.map((r) => r.visibility_score ?? 0))),
      visibilityRate: b.answers ? round1((b.visibleAnswers / b.answers) * 100) : 0,
      score: b.score,
      change: pb.score === null || b.score === null ? null : round1(b.score - pb.score),
      results: b.answers,
    };
  });
}

const signed = (n, unit = '') => `${n > 0 ? '+' : ''}${n}${unit}`;

/** The prose the summary model writes, from the same numbers. */
function weeklySummary(payload) {
  const { insights: i, visibilityRate: v, shareOfVoice: sov } = payload;
  const best = [...sov.byPlatform].sort((a, b) => b.sov - a.sov)[0];
  return [
    `${BRAND.name} appeared in answers to ${v.visiblePrompts} of its ${v.promptCount} tracked prompts this week, with an AI Visibility Score of ${v.score}.`,
    `Mentions ${i.mentionsChange === null ? 'held steady' : `moved ${signed(i.mentionsChange, '%')}`} against the week before, and ${i.positiveSentimentPct}% of the answers naming the brand were positive.`,
    `Share of voice stands at ${sov.overallSov}%${sov.overallSovChange === null ? '' : ` (${signed(sov.overallSovChange, ' pts')})`}, strongest on ${IMPROVE_PLATFORM_LABELS[best.provider] ?? best.provider}.`,
  ].join(' ');
}

function benchmarkSummary(payload) {
  const [own, ...rivals] = payload.competitors;
  const leader = rivals[0];
  const topics = [...payload.topicPerformance].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  return [
    `${leader.name} leads the tracked set with a score of ${leader.score}, against ${own.score} for ${BRAND.name}.`,
    `${BRAND.name} is visible on ${own.visiblePrompts} of ${own.promptCount} prompts and holds ${payload.shareOfVoice.overallSov}% share of voice.`,
    `By topic it scores highest in ${topics[0].name} (${topics[0].score}) and lowest in ${topics.at(-1).name} (${topics.at(-1).score}).`,
  ].join(' ');
}

/**
 * The demo's saved reports, built in memory.
 *
 * @param {{ brandId: string, now: Date }} args
 */
export function reportRows({ brandId, now }) {
  const ctx = S.demoContext(brandId, now);
  const latest = ctx.starts.length - 1;
  const results = ctx.rows.results;

  const make = (template, key, to, days, build) => {
    const from = new Date(to.getTime() - days * S.DAY_MS);
    const prevFrom = new Date(from.getTime() - days * S.DAY_MS);
    const cur = within(results, from, to);
    const prev = within(results, prevFrom, from);
    const payload = build(cur, prev);
    return {
      id: demoId(brandId, `report:${key}`),
      brand_id: brandId,
      title: `${BRAND.name} — ${TEMPLATE_TITLES[template]} (${S.utcDay(from)} → ${S.utcDay(to)})`,
      template,
      date_from: from.toISOString(),
      date_to: to.toISOString(),
      payload,
      created_by: null,
      created_at: to.toISOString(),
    };
  };

  const weekly = make(
    'weekly_visibility',
    'weekly',
    // Made before the morning's run, so the week compares two runs with two.
    S.afterRun(ctx.starts, latest, -1),
    7,
    (cur, prev) => {
      const payload = {
        brandName: BRAND.name,
        insights: insights(cur, prev),
        visibilityRate: visibilityRate(cur),
        visibilityTrend: trend(cur),
        shareOfVoice: shareOfVoice(cur, prev),
      };
      return { ...payload, summaryText: weeklySummary(payload) };
    },
  );

  const benchmark = make(
    'competitor_benchmark',
    'benchmark',
    S.afterRun(ctx.starts, latest - 1, 3),
    30,
    (cur, prev) => {
      const payload = {
        brandName: BRAND.name,
        insights: insights(cur, prev),
        visibilityRate: visibilityRate(cur),
        shareOfVoice: shareOfVoice(cur, prev),
        competitors: competitors(cur, prev),
        topicPerformance: topicPerformance(ctx, cur, prev),
      };
      return { ...payload, summaryText: benchmarkSummary(payload) };
    },
  );

  return [benchmark, weekly];
}

/** The reports module. */
export const reports = {
  name: 'reports',
  // Rebuilt in place (write.js): written over, what isn't written again deleted after.
  inPlace: true,
  tables: ['reports'],

  /**
   * Through the build's writer (a writer over `db` for a first build without one).
   *
   * @param {{ brandId: string, now: Date, db?: object, rebuild?: boolean, write?: Function }} ctx
   */
  async build({
    brandId,
    now,
    db = supabaseAdmin,
    rebuild = false,
    write = demoWriter({ db, brandId, rebuild }).write,
  }) {
    const rows = reportRows({ brandId, now });
    await write('reports', rows);
    return { reports: rows.length };
  },
};
