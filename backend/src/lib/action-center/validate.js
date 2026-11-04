/**
 * Did the action help? (Action Center, validation layer — #818 phase 2.)
 *
 * An action closes when someone finishes the work. Whether the work moved
 * anything is a separate question, and until this module existed nothing
 * asked it: `outcome` read `pending_measurement` forever and History's Result
 * column had nothing to show.
 *
 * The answer comes from measuring the action's own success metrics twice —
 * over a window ending before it was raised, and a window after it closed —
 * and comparing. Both reads go through the same daily rollup functions the
 * KPI page uses, so an action's result and the dashboard that summarises the
 * same days cannot disagree.
 *
 * What it deliberately does not do:
 *  - claim causality. The metrics moved; whether this action moved them is
 *    not knowable from a before/after pair, and the UI says "measured after
 *    this action closed" rather than "because of it";
 *  - infer an outcome from task completion. Ticking six boxes is evidence of
 *    effort, not of effect;
 *  - measure what it cannot read. A metric with no data in either window is
 *    reported as unmeasured rather than as zero, because zero is a number
 *    someone will believe.
 */

import supabaseAdmin from '../../config/supabase.js';
import { computeAiVisibilityScore } from '../../config/visibilityScore.js';
import { logger } from '../logger.js';
import { resolve } from '../../config/actionEngine.js';
import {
  BASKET_KPIS,
  basketScope,
  controlScope,
  measureBasket,
  netEffect,
} from './basketMetrics.js';
import { auditOutcome, auditRecheck } from './auditRecheck.js';

const DAY_MS = 86_400_000;

// Windows and the noise floor live in config/actionEngine.js (#818 phase
// 2.5), with every other number the engine judges by.
const { validation } = resolve();

/** Length of each measurement window. Equal on both sides so the comparison
 *  is between like periods. */
export const MEASUREMENT_WINDOW_DAYS = validation.windowDays;

/**
 * How long after closing before an action can be measured.
 *
 * The "after" window runs for MEASUREMENT_WINDOW_DAYS from the day following
 * the close, and it has to be *over* before it means anything: a window still
 * in progress reads low simply because its later days have not happened, and
 * reporting that as a decline would turn every recent action into a failure.
 * The sweep uses this to filter cheaply; validateAction checks the window
 * itself, which is the condition that actually matters.
 */
export const VALIDATION_WAIT_DAYS = MEASUREMENT_WINDOW_DAYS + 1;

/**
 * How much a metric must move to count as movement, as a fraction of its
 * before value. Below this, a difference is indistinguishable from the
 * week-to-week noise every one of these metrics carries.
 */
export const MEANINGFUL_CHANGE_RATIO = validation.meaningfulChangeRatio;

/** The days after closing an action's effect is read on; the last is final (learning B1). */
export const FINAL_READING_DAY = validation.finalReadingDay;
export const READING_DAYS = [
  MEASUREMENT_WINDOW_DAYS,
  2 * MEASUREMENT_WINDOW_DAYS,
  FINAL_READING_DAY,
];

/** The window a reading `day` days after the close covers: the week ending that day. */
export function readingWindow(closedAt, day) {
  return windowStartingAfter(
    new Date(closedAt + (day - MEASUREMENT_WINDOW_DAYS) * DAY_MS),
    MEASUREMENT_WINDOW_DAYS,
  );
}

/** Days a window may lack a tracking run and still be compared (learning A6). */
export const MAX_GAP_DAYS = validation.maxGapDays;

/**
 * Metrics tracking's answers add up night by night: a night without a run
 * reads low in them. The rates (visibility, share of voice, the lead over a
 * competitor) are shares of the answers there were, and don't drift from one.
 */
const COUNT_METRICS = new Set(['mentions', 'citations']);

/** Every metric here reads higher-is-better; a drop is a decline. */
const MEASURABLE_KPIS = {
  ai_visibility: 'percent',
  citations: 'count',
  mentions: 'count',
  share_of_voice: 'percent',
  ai_referral_traffic: 'sessions',
};

const utcDay = (date) => date.toISOString().slice(0, 10);

/** Inclusive whole-day window of `days` ending the day before `endExclusive`. */
function windowEndingBefore(endExclusive, days) {
  const to = new Date(endExclusive.getTime() - DAY_MS);
  const from = new Date(to.getTime() - (days - 1) * DAY_MS);
  return { from: utcDay(from), to: utcDay(to) };
}

/** Inclusive whole-day window of `days` starting the day after `startExclusive`. */
function windowStartingAfter(startExclusive, days) {
  const from = new Date(startExclusive.getTime() + DAY_MS);
  const to = new Date(from.getTime() + (days - 1) * DAY_MS);
  return { from: utcDay(from), to: utcDay(to) };
}

async function rpc(name, brandId, from, to) {
  const { data, error } = await supabaseAdmin.rpc(name, {
    p_brand_id: brandId,
    p_platform: null,
    p_models: null,
    p_region: null,
    p_day_from: from,
    p_day_to: to,
  });
  if (error) throw new Error(`${name}: ${error.message}`);
  // These functions return a single row; supabase-js hands back the object or
  // a one-element array depending on the declared return type.
  return Array.isArray(data) ? (data[0] ?? null) : data;
}

/**
 * Read the requested metrics over one window.
 *
 * Returns null for a metric the window cannot answer — no tracking ran, or
 * the brand has no analytics connected — which the caller reports as
 * unmeasured rather than as a value.
 */
export async function measureKpis(brandId, kpiKeys, from, to) {
  const wanted = kpiKeys.filter((key) => key in MEASURABLE_KPIS);
  if (wanted.length === 0) return {};

  const needsInsights = wanted.some((k) => k === 'citations' || k === 'mentions');
  const needsVisibility = wanted.includes('ai_visibility');
  const needsSov = wanted.includes('share_of_voice');
  const needsTraffic = wanted.includes('ai_referral_traffic');

  const [insights, visibility, sov, traffic] = await Promise.all([
    needsInsights ? rpc('insights_aggregates_daily', brandId, from, to) : null,
    needsVisibility ? rpc('ai_visibility_aggregates_daily', brandId, from, to) : null,
    needsSov ? rpc('share_of_voice_aggregates_daily', brandId, from, to) : null,
    needsTraffic ? measureTraffic(brandId, from, to) : null,
  ]);

  const values = {};
  for (const key of wanted) {
    switch (key) {
      case 'citations':
        values[key] = insights?.total_citations ?? null;
        break;
      case 'mentions':
        values[key] = insights?.total_mentions ?? null;
        break;
      case 'ai_visibility':
        values[key] = visibility?.answers
          ? computeAiVisibilityScore({
              answers: Number(visibility.answers),
              mentionAnswers: Number(visibility.mention_answers ?? 0),
              citationAnswers: Number(visibility.citation_answers ?? 0),
              positionFactor: visibility.position_factor ?? 0,
            })
          : null;
        break;
      case 'share_of_voice': {
        // The function returns the two mention totals; the percentage is
        // computed the same way the Insights page computes it, so the two
        // agree for the same days.
        const brand = Number(sov?.total_brand_mentions ?? 0);
        const competitors = Number(sov?.total_competitor_mentions ?? 0);
        const all = brand + competitors;
        values[key] = all > 0 ? Math.round((brand / all) * 1000) / 10 : null;
        break;
      }
      case 'ai_referral_traffic':
        values[key] = traffic;
        break;
    }
  }
  return values;
}

/**
 * AI-referred visits over a window.
 *
 * Two sources exist: the tracking snippet, counted one row per visit (a row
 * whose visit_of is null starts a visit, 00172; reloads are further rows of
 * it), and the analytics integration's sessions. Whichever the brand actually
 * has is used — and when it has neither, the metric is unmeasured, not zero.
 */
async function measureTraffic(brandId, from, to) {
  const { count, error } = await supabaseAdmin
    .from('ai_traffic_logs')
    .select('id', { count: 'exact', head: true })
    .eq('brand_id', brandId)
    .is('visit_of', null)
    .gte('created_at', `${from}T00:00:00Z`)
    .lte('created_at', `${to}T23:59:59Z`);
  if (error) throw new Error(`ai_traffic_logs: ${error.message}`);
  if (count) return count;

  const { data, error: gaErr } = await supabaseAdmin
    .from('ga_ai_traffic_stats')
    .select('sessions')
    .eq('brand_id', brandId)
    .gte('date', from)
    .lte('date', to);
  if (gaErr) throw new Error(`ga_ai_traffic_stats: ${gaErr.message}`);
  if (!data?.length) return null;
  return data.reduce((sum, row) => sum + Number(row.sessions ?? 0), 0);
}

/**
 * The verdict, from the measured pairs alone (learning A4).
 *
 * A metric counts as moved only past MEANINGFUL_CHANGE_RATIO — these numbers
 * drift week to week on their own, and calling a 1% wobble an improvement
 * would make every outcome meaningless.
 *
 * The action's main metric (`primary`, the one its aim reads in) decides
 * when it was measured: up is improved, down declined, still no meaningful
 * change, whatever the others did beside it, but `mixed` when another moved
 * the other way. Without one measured, every metric counts, and movement
 * both ways is `mixed`: it used to read as improved, which taught that
 * anything moving up was the work paying off.
 *
 * Given `aims` (the success metrics the action names), only those and the
 * main metric count: a basket reads every metric it can, and one the action
 * never aimed at drifting the other way isn't a mixed result. The others
 * stay in `metrics`, to see.
 */
export function deriveOutcome(metrics, primary = null, aims = null) {
  const counted = aims ? new Set([...aims, ...(primary ? [primary] : [])]) : null;
  const measured = metrics.filter(
    (m) => m.before != null && m.after != null && (!counted || counted.has(m.metric)),
  );
  if (measured.length === 0) return 'not_measurable';

  const direction = ({ before, after }) => {
    const floor = Math.abs(before) * MEANINGFUL_CHANGE_RATIO;
    // A metric that was zero before has no ratio to scale by; any real
    // arrival counts as movement.
    const threshold = before === 0 ? Number.EPSILON : floor;
    if (after - before > threshold) return 1;
    if (before - after > threshold) return -1;
    return 0;
  };
  const moves = measured.map((m) => ({ metric: m.metric, dir: direction(m) }));
  const up = moves.some((m) => m.dir > 0);
  const down = moves.some((m) => m.dir < 0);

  const main = primary ? moves.find((m) => m.metric === primary) : null;
  if (main) {
    if (main.dir > 0) return down ? 'mixed' : 'improved';
    if (main.dir < 0) return up ? 'mixed' : 'declined';
    return 'no_meaningful_change';
  }
  if (up && down) return 'mixed';
  if (up) return 'improved';
  if (down) return 'declined';
  return 'no_meaningful_change';
}

/**
 * The days of a window (inclusive, UTC) with no stamped tracking run for the
 * brand (learning A6): a night whose collection failed, or fell short and
 * was discarded, leaves no stamped row.
 */
export async function missingDays(brandId, window) {
  const end = new Date(Date.parse(`${window.to}T00:00:00Z`) + DAY_MS).toISOString();
  const { data, error } = await supabaseAdmin
    .from('tracking_runs')
    .select('completed_at')
    .eq('brand_id', brandId)
    .not('completed_at', 'is', null)
    .gte('completed_at', `${window.from}T00:00:00Z`)
    .lt('completed_at', end)
    .limit(1000);
  if (error) throw new Error(`tracking_runs: ${error.message}`);
  const ran = new Set((data ?? []).map((r) => new Date(r.completed_at).toISOString().slice(0, 10)));
  let missing = 0;
  for (let t = Date.parse(`${window.from}T00:00:00Z`); t < Date.parse(end); t += DAY_MS) {
    if (!ran.has(new Date(t).toISOString().slice(0, 10))) missing += 1;
  }
  return missing;
}

/**
 * The counts read over windows tracking missed nights of, each at a full
 * window's worth (learning A6): what the nights that ran read, per night,
 * times the window's nights. Both windows on the same scale, a missed night
 * no longer reads as a decline nobody caused. What was read stays as `raw`.
 */
export function fullWindowCounts(metrics, gaps) {
  if (!metrics || !(gaps.before || gaps.after)) return metrics;
  const full = (value, missing) => {
    if (value == null || !missing) return value;
    const ran = MEASUREMENT_WINDOW_DAYS - missing;
    return ran > 0 ? Math.round(((value * MEASUREMENT_WINDOW_DAYS) / ran) * 10) / 10 : null;
  };
  return metrics.map((m) => {
    if (!COUNT_METRICS.has(m.metric)) return m;
    const before = full(m.before, gaps.before);
    const after = full(m.after, gaps.after);
    if (before === m.before && after === m.after) return m;
    return { ...m, before, after, raw: { before: m.before, after: m.after } };
  });
}

/** A target the night engine names that a basket can be measured on (learning A1). */
const TARGET_BASKETS = new Set(['prompts', 'pages']);
/** A prompt id, as against a key that is a prompt's text (a suggestion's). */
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The brand's primary domain as a host, for a page target written as a path. */
async function primaryHost(brandId, { db = supabaseAdmin } = {}) {
  const { data, error } = await db
    .from('brand_domains')
    .select('domain')
    .eq('brand_id', brandId)
    .order('is_primary', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`brand_domains: ${error.message}`);
  const host = String(data?.domain ?? '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/[/?#].*$/, '');
  return host || null;
}

/**
 * The basket a night-engine action is measured on (learning A1): the
 * prompts or pages its payload names, every one it counts (`targetIds`)
 * when it shows fewer, a page written as a path read on the brand's primary
 * domain. Null for another kind of target, or none: such an action is
 * measured brand-wide, as before.
 */
export async function targetScope(action, { db = supabaseAdmin } = {}) {
  const payload = action.payload ?? {};
  if (!TARGET_BASKETS.has(payload.targetEntity)) return null;
  const listed = Array.isArray(payload.targetIds)
    ? payload.targetIds
    : (Array.isArray(payload.targets) ? payload.targets : []).map((t) => t?.id);
  const keys = [...new Set(listed.filter((k) => typeof k === 'string' && k.trim()))];
  if (payload.targetEntity === 'prompts') {
    const promptIds = keys.filter((k) => UUID.test(k));
    return promptIds.length ? { entity: 'prompts', promptIds, pages: [] } : null;
  }
  const host = keys.some((k) => k.startsWith('/'))
    ? await primaryHost(action.brand_id, { db })
    : null;
  const pages = keys
    .map((k) => (k.startsWith('/') ? (host ? `https://${host}${k}` : null) : k))
    .filter((url) => url && /^https?:\/\//i.test(url));
  return pages.length ? { entity: 'pages', promptIds: [], pages } : null;
}

/**
 * What became of the signals that raised the action, when it is measured
 * (learning A3): how many ended (resolved, the condition gone), turned into
 * another kind of the same subject (resolved with `supersededBy`: still
 * there), were dismissed by a person, or are still open. The closest
 * measure to the action's own aim, and a cheap one. Null for an action no
 * signal raised (one sent from Content, Insights, Mentions…).
 */
export async function signalOutcome(actionId) {
  const { data, error } = await supabaseAdmin
    .from('action_signals')
    .select('signals(status, payload)')
    .eq('action_id', actionId);
  if (error) throw new Error(`action_signals: ${error.message}`);
  const signals = (data ?? []).map((row) => row.signals).filter(Boolean);
  if (!signals.length) return null;
  const counts = { total: signals.length, ended: 0, replaced: 0, dismissed: 0, open: 0 };
  for (const signal of signals) {
    if (signal.status === 'resolved') {
      if (signal.payload?.supersededBy) counts.replaced += 1;
      else counts.ended += 1;
    } else if (signal.status === 'dismissed') counts.dismissed += 1;
    else counts.open += 1;
  }
  return counts;
}

/**
 * Measure one closed action and record the result.
 *
 * Returns the outcome written, or null when the action is not ready — it
 * closed too recently, or its "after" window has not finished yet.
 */
export async function validateAction(action, { now = new Date() } = {}) {
  const closedAt = Date.parse(action.completed_at ?? '') || 0;
  if (!closedAt) return null;

  const beforeWindow = windowEndingBefore(new Date(action.created_at), MEASUREMENT_WINDOW_DAYS);

  // The readings due (learning B1): the days whose week is over, not read
  // yet. A window has to be complete: measuring one whose last days have
  // not happened yet reads low for a reason that has nothing to do with the
  // action, and would file most recent work as a decline.
  const previous = Array.isArray(action.validation?.readings) ? action.validation.readings : [];
  const taken = new Set(previous.map((r) => r.day));
  const due = READING_DAYS.filter(
    (day) => !taken.has(day) && readingWindow(closedAt, day).to < utcDay(now),
  );
  if (due.length === 0) return null;

  // What became of the signals that raised it (A3), and for a Site Audit
  // fix whether its pages pass when audited again (A2), kept beside the
  // metrics. A fix whose pages were audited again is judged by that: the
  // check passing is its aim.
  const [signals, audit] = await Promise.all([signalOutcome(action.id), auditRecheck(action)]);

  // Each reading due, in order; the action keeps the last one's figures and
  // verdict, every reading's verdict and metrics, and whether it's final.
  // The control's prompts and its week before (B2) are the same for each:
  // read for the first, kept for the rest.
  const readings = [...previous];
  const controlReads = {};
  let last = null;
  for (const day of due) {
    last = await measureReading(action, {
      beforeWindow,
      afterWindow: readingWindow(closedAt, day),
      signals,
      audit,
      now,
      controlReads,
    });
    readings.push({
      day,
      outcome: last.verdict,
      ...(last.kept?.afterWindow ? { afterWindow: last.kept.afterWindow } : {}),
      ...(last.kept?.metrics ? { metrics: last.kept.metrics } : {}),
    });
  }
  const final = readings.some((r) => r.day === FINAL_READING_DAY);
  await write(
    action.id,
    {
      measuredAt: now.toISOString(),
      ...(last.kept ?? {}),
      readings,
      ...(final ? { final: true } : {}),
    },
    last.verdict,
    now,
    { day: due[due.length - 1], final },
  );
  return last.verdict;
}

/**
 * A basket's control (learning B2): the brand's prompts it didn't touch,
 * read over the same windows, its values as read. The basket's change net
 * of theirs is taken when the reading finishes, its counts on the same
 * scale as the result's (A6). Kept beside the result, not in its verdict.
 * Null with too few prompts to read, or a read that fails: the result
 * stands as it was. Its prompts and week before, the same for every
 * reading of the action, are read once into `shared`.
 */
async function controlOf(action, promptIds, { beforeWindow, afterWindow }, shared = {}) {
  const brandId = action.brand_id;
  try {
    shared.scope ??= controlScope(brandId, promptIds, beforeWindow.from);
    const scope = await shared.scope;
    if (!scope) return null;
    shared.before ??= measureBasket(brandId, scope, beforeWindow.from, beforeWindow.to);
    const [before, after] = await Promise.all([
      shared.before,
      measureBasket(brandId, scope, afterWindow.from, afterWindow.to),
    ]);
    return { basis: scope.basis, prompts: scope.promptIds.length, before, after };
  } catch (err) {
    logger.warn(
      { err: err.message, brandId, actionId: action.id },
      '[action-validation] control basket not read',
    );
    return null;
  }
}

/** The control's values with its counts at a full window's worth, as the result's are (A6). */
function fullWindowControl({ before, after }, nights) {
  const scaled = fullWindowCounts(
    Object.keys(before).map((metric) => ({ metric, before: before[metric], after: after[metric] })),
    nights,
  );
  return {
    before: Object.fromEntries(scaled.map((m) => [m.metric, m.before])),
    after: Object.fromEntries(scaled.map((m) => [m.metric, m.after])),
  };
}

/**
 * One reading of a closed action (learning B1): what it keeps and its
 * verdict, over the week `afterWindow` against the week before it was raised.
 */
async function measureReading(
  action,
  { beforeWindow, afterWindow, signals, audit, now, controlReads },
) {
  // The verdict from the metrics kept, by its main metric; given `aims`,
  // only the metrics the action names count (see deriveOutcome). Given its
  // `control` (B2), its change net of the control's kept beside.
  const finish = async (validation, aims = null, control = null) => {
    // Nights tracking missed in either window (A6), when a count was read.
    // Up to MAX_GAP_DAYS, its counts are read at a full window's worth; past
    // it, too few nights ran to scale from: the counts stay as read and
    // don't count toward the verdict, and an action whose main metric is a
    // count can't be compared. The rates can.
    const counted = [...(validation?.metrics ?? []), ...(validation?.brandWide ?? [])].some(
      (m) => COUNT_METRICS.has(m.metric) && m.before != null && m.after != null,
    );
    const [gapBefore, gapAfter] = counted
      ? await Promise.all([
          missingDays(action.brand_id, beforeWindow),
          missingDays(action.brand_id, afterWindow),
        ])
      : [0, 0];
    const tooMany = Math.max(gapBefore, gapAfter) > MAX_GAP_DAYS;
    const gaps =
      gapBefore || gapAfter
        ? { gaps: { before: gapBefore, after: gapAfter, ...(tooMany ? { tooMany: true } : {}) } }
        : {};
    const nights = { before: gapBefore, after: gapAfter };
    const read =
      validation && !tooMany
        ? {
            ...validation,
            metrics: fullWindowCounts(validation.metrics, nights),
            ...(validation.brandWide
              ? { brandWide: fullWindowCounts(validation.brandWide, nights) }
              : {}),
          }
        : validation;
    const comparable = tooMany
      ? read?.metrics.filter((m) => !COUNT_METRICS.has(m.metric))
      : read?.metrics;
    // Net of the control (B2) on the result's scale: its counts read at a
    // full week's worth over the same nights, or, past MAX_GAP_DAYS, left
    // out with the result's.
    const net = read && control ? netEffect(comparable, fullWindowControl(control, nights)) : [];
    const measured = net.length
      ? { ...read, control: { basis: control.basis, prompts: control.prompts, net } }
      : read;
    const beside = { ...(signals ? { signals } : {}), ...(audit ? { audit } : {}), ...gaps };
    const kept =
      measured || Object.keys(beside).length
        ? { measuredAt: now.toISOString(), ...(measured ?? {}), ...beside }
        : null;
    const outcome =
      !read || (tooMany && COUNT_METRICS.has(read.primary))
        ? 'not_measurable'
        : deriveOutcome(comparable, read.primary, aims);
    const verdict = (audit && auditOutcome(audit)) ?? outcome;
    return { kept, verdict };
  };

  // An action sent from a content opportunity is measured on its own prompts
  // and pages; the brand-wide numbers would bury a single piece of content.
  // An Improve action (PROMPT-004) likewise, on its one prompt, and a topic
  // gap (VIS-010) or opportunity (VIS-011) sent from Insights on the topic's
  // prompts, answers sent from Mentions (MS-08) on their prompts, and pages
  // sent from AI Traffic (AT-006) on those pages. A draft sent from the
  // Content Editor (CE-015) on its prompts and its page, and a product or
  // category sent from Product Visibility (ECOM-013) on its shopping
  // questions and the product's page. A page sent from a Site Audit report
  // (learning D2) on that page. A finding sent from Chat (CHAT-09 §E) on the
  // prompts and pages it named.
  if (
    action.kind === 'content_opportunity' ||
    action.kind === 'content_draft' ||
    action.kind === 'prompt_improve' ||
    action.kind === 'topic_competitor_gap' ||
    action.kind === 'topic_opportunity' ||
    action.kind === 'mention_review' ||
    action.kind === 'traffic_pages' ||
    action.kind === 'shopping_product' ||
    action.kind === 'shopping_category' ||
    action.kind === 'audit_page' ||
    action.kind === 'chat_finding'
  ) {
    const scope = await basketScope(action);
    const [before, after] = await Promise.all([
      measureBasket(action.brand_id, scope, beforeWindow.from, beforeWindow.to),
      measureBasket(action.brand_id, scope, afterWindow.from, afterWindow.to),
    ]);
    const metrics = Object.entries(BASKET_KPIS).map(([metric, unit]) => ({
      metric,
      unit,
      before: before[metric],
      after: after[metric],
    }));
    // Its aim: the first of its success metrics a basket reads, else its visibility.
    const primary = (action.kpi_keys ?? []).find((key) => key in BASKET_KPIS) ?? 'ai_visibility';
    const control = await controlOf(
      action,
      scope.promptIds,
      { beforeWindow, afterWindow },
      controlReads,
    );
    return finish(
      {
        measuredAt: now.toISOString(),
        beforeWindow,
        afterWindow,
        metrics,
        primary,
        scope: { kind: 'basket', prompts: scope.promptIds.length, pages: scope.pages.length },
      },
      action.kpi_keys ?? [],
      control,
    );
  }

  const kpiKeys = (action.kpi_keys ?? []).filter((key) => key in MEASURABLE_KPIS);

  // A night-engine action that names its prompts or pages is measured on
  // them (learning A1): "recover 6 prompts" moves those 6, which the whole
  // brand's numbers can bury. The brand-wide figures stay as a second line.
  // A basket that measured nothing (no answers, citations of prompts) leaves
  // the action to the brand-wide measure below, and so does one that can't
  // read its main metric (citations of prompts): judged by another, a basket
  // could read "improved" while its aim fell brand-wide.
  let brand = null;
  let fallback = null;
  const targets = await targetScope(action);
  if (targets) {
    const asked = (action.kpi_keys ?? []).filter((key) => key in BASKET_KPIS);
    const keys = asked.length ? asked : Object.keys(BASKET_KPIS);
    // Its aim: the first metric it names, else what its targets read in.
    const primary = asked[0] ?? (targets.entity === 'pages' ? 'citations' : 'ai_visibility');
    const [before, after, brandBefore, brandAfter] = await Promise.all([
      measureBasket(action.brand_id, targets, beforeWindow.from, beforeWindow.to),
      measureBasket(action.brand_id, targets, afterWindow.from, afterWindow.to),
      kpiKeys.length
        ? measureKpis(action.brand_id, kpiKeys, beforeWindow.from, beforeWindow.to)
        : {},
      kpiKeys.length ? measureKpis(action.brand_id, kpiKeys, afterWindow.from, afterWindow.to) : {},
    ]);
    const metrics = keys.map((metric) => ({
      metric,
      unit: BASKET_KPIS[metric],
      before: before[metric] ?? null,
      after: after[metric] ?? null,
    }));
    const read = (m) => m.before != null && m.after != null;
    const named = {
      entity: targets.entity,
      prompts: targets.promptIds.length,
      pages: targets.pages.length,
    };
    if (metrics.some((m) => m.metric === primary && read(m))) {
      const brandWide = kpiKeys.map((metric) => ({
        metric,
        unit: MEASURABLE_KPIS[metric],
        before: brandBefore[metric] ?? null,
        after: brandAfter[metric] ?? null,
      }));
      const control = await controlOf(
        action,
        targets.promptIds,
        { beforeWindow, afterWindow },
        controlReads,
      );
      return finish(
        {
          measuredAt: now.toISOString(),
          beforeWindow,
          afterWindow,
          metrics,
          primary,
          scope: { kind: 'targets', ...named },
          ...(brandWide.length ? { brandWide } : {}),
        },
        asked,
        control,
      );
    }
    // Read already, for the brand-wide measure below.
    if (kpiKeys.length) brand = { before: brandBefore, after: brandAfter };
    if (metrics.some(read)) {
      fallback = { kind: 'brand', reason: 'primary_not_in_basket', ...named };
    }
  }

  // An action with no success metrics has nothing to measure. That is a gap
  // in the rule that produced it, not a failure here — say so plainly rather
  // than inventing a metric it never claimed.
  if (kpiKeys.length === 0) return finish(null);

  const [before, after] = brand
    ? [brand.before, brand.after]
    : await Promise.all([
        measureKpis(action.brand_id, kpiKeys, beforeWindow.from, beforeWindow.to),
        measureKpis(action.brand_id, kpiKeys, afterWindow.from, afterWindow.to),
      ]);

  const metrics = kpiKeys.map((metric) => ({
    metric,
    unit: MEASURABLE_KPIS[metric],
    before: before[metric] ?? null,
    after: after[metric] ?? null,
  }));

  // Its aim: the first success metric its signals name. Measured here for a
  // basket that couldn't read it, the scope says so.
  const primary = kpiKeys[0];
  return finish({
    measuredAt: now.toISOString(),
    beforeWindow,
    afterWindow,
    metrics,
    primary,
    ...(fallback ? { scope: fallback } : {}),
  });
}

async function write(actionId, validation, outcome, now, { day = null, final = false } = {}) {
  const { error } = await supabaseAdmin
    .from('actions')
    .update({ validation, outcome, validated_at: now.toISOString() })
    .eq('id', actionId);
  if (error) throw new Error(error.message);

  // The trail carries the verdict, so the drawer's History tab shows when the
  // measurement happened alongside the work that preceded it.
  await supabaseAdmin.from('action_events').insert({
    action_id: actionId,
    event: 'outcome_measured',
    // Which reading (learning B1), and whether it's the final one.
    data: { outcome, ...(day ? { day } : {}), ...(final ? { final: true } : {}) },
  });
}

/** The actions the sweep reads, and how many at a time. */
export const SWEEP_FILTER =
  'outcome.eq.pending_measurement,and(validation->readings.not.is.null,validation->>final.is.null)';
const SWEEP_PAGE = 500;

/**
 * Nightly sweep: measure every closed action whose settling period has passed.
 *
 * Best-effort per action — one brand's missing rollup must not stop the rest
 * from being measured.
 */
export async function sweepActionValidation({ now = new Date() } = {}) {
  const cutoff = new Date(now.getTime() - VALIDATION_WAIT_DAYS * DAY_MS).toISOString();
  let measured = 0;
  let failed = 0;
  // In pages by id: an action waiting for a later reading stays on the list
  // night after night, and must not crowd out the ones due.
  let afterId = null;
  for (;;) {
    let query = supabaseAdmin
      .from('actions')
      .select(
        'id, brand_id, kind, payload, kpi_keys, created_at, completed_at, validation, brands!inner(is_demo)',
      )
      // A demo brand's actions (00380) are sample data: their outcomes are written with them.
      .eq('brands.is_demo', false)
      .eq('status', 'completed')
      // Never measured, or read but not for the last time yet (learning B1).
      // One measured once before the later readings came keeps its result.
      .or(SWEEP_FILTER)
      .not('completed_at', 'is', null)
      .lte('completed_at', cutoff)
      .order('id')
      .limit(SWEEP_PAGE);
    if (afterId) query = query.gt('id', afterId);
    const { data, error } = await query;
    if (error) {
      logger.error({ err: error }, '[action-validation] could not list pending actions');
      break;
    }

    for (const action of data ?? []) {
      try {
        if (await validateAction(action, { now })) measured += 1;
      } catch (err) {
        failed += 1;
        logger.error({ err, actionId: action.id }, '[action-validation] measurement failed');
      }
    }
    if (!data || data.length < SWEEP_PAGE) break;
    afterId = data[data.length - 1].id;
  }

  logger.info({ measured, failed }, '[action-validation] sweep complete');
  return { measured, failed };
}
