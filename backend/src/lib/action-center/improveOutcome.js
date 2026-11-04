/**
 * Did an Improve action move the prompt's positions? (PROMPT-008)
 *
 * The action's baseline is the prompt's last 7 days per platform when it was
 * sent, fixed at creation. Every day the same 7-day read is taken again and
 * stored next to it as `position_outcome`, which the action's Outcome card,
 * the Positions panel and History show. Both reads use classifyPlatform, the
 * rule the Positions panel and the Improve tab already share, so the numbers
 * agree with the panel for the same days.
 *
 * Tracking runs while the action is open and for 30 days after it is
 * completed; the read at day 30 is final and is recorded in History.
 *
 * Like validate.js, it reports movement, not causality, and a platform with
 * no runs on either side is "not enough data" rather than a delta.
 */

import supabaseAdmin from '../../config/supabase.js';
import { logger } from '../logger.js';
import { classifyPlatform } from '../promptImprove.js';

const DAY_MS = 86_400_000;

/** Each read covers this many days, ending at the moment of the read. */
export const OUTCOME_WINDOW_DAYS = 7;

/** Days a completed action is still tracked; the read on the last one is final. */
export const OUTCOME_TRACKING_DAYS = 30;

/** A mention position must move at least this far to count as a change. */
export const POSITION_CHANGE = 0.5;

const OPEN = ['new', 'in_progress', 'on_hold'];

/** The 7 days ending at `end`. */
export function outcomeWindow(end) {
  const to = new Date(end);
  return {
    from: new Date(to.getTime() - OUTCOME_WINDOW_DAYS * DAY_MS).toISOString(),
    to: to.toISOString(),
  };
}

/** What one read keeps per platform. */
export function platformSnapshot(platform, state) {
  return {
    platform,
    state: state.state,
    runs: state.runs,
    mentionedRuns: state.mentionedRuns,
    citedRuns: state.citedRuns,
    mentionPosition: state.mentionPosition,
    citationRank: state.citationRank,
  };
}

/**
 * One prompt's state per platform over a window, from the same answers and
 * rule as the Positions panel.
 */
export async function readPlatformStates({ promptId, brandId, region, platforms, window }) {
  if (platforms.length === 0) return [];
  let q = supabaseAdmin
    .from('prompt_results')
    .select('platform, mention_count, mention_position, mentioned_entity_count, citations')
    .eq('prompt_id', promptId)
    .eq('brand_id', brandId)
    .in('platform', platforms)
    .gte('created_at', window.from)
    .lte('created_at', window.to);
  if (region) q = q.eq('region', region);
  const [{ data: rows, error }, { data: domainRows }] = await Promise.all([
    q.limit(2000),
    supabaseAdmin.from('brand_domains').select('domain').eq('brand_id', brandId),
  ]);
  if (error) throw new Error(error.message);
  const domains = (domainRows ?? []).map((r) => r.domain);
  return platforms.map((platform) =>
    platformSnapshot(
      platform,
      classifyPlatform(
        (rows ?? []).filter((r) => r.platform === platform),
        domains,
      ),
    ),
  );
}

/**
 * Mentioned or not, by the Improve tab's rule: classifyPlatform already set
 * `state`, and a brand in fewer than MIN_MENTION_RATE of the runs is
 * not_mentioned there, so 1 mention in 10 runs is still not mentioned.
 */
const mentioned = (p) => p.runs > 0 && p.state !== 'no_runs' && p.state !== 'not_mentioned';

/**
 * - not_enough_data  no runs before or after
 * - improved         now mentioned, or named at least POSITION_CHANGE earlier
 * - declined         no longer mentioned, or named at least POSITION_CHANGE later
 * - unchanged        anything smaller
 */
export function platformVerdict(before, after) {
  if (!before?.runs || !after?.runs) return 'not_enough_data';
  if (!mentioned(before) && mentioned(after)) return 'improved';
  if (mentioned(before) && !mentioned(after)) return 'declined';
  if (!mentioned(before)) return 'unchanged';
  const b = before.mentionPosition;
  const a = after.mentionPosition;
  if (b === null || a === null) return 'unchanged';
  if (b - a >= POSITION_CHANGE) return 'improved';
  if (a - b >= POSITION_CHANGE) return 'declined';
  return 'unchanged';
}

const round1 = (n) => Math.round(n * 10) / 10;

/** Baseline next to the latest read, per platform, with the counts History reports. */
export function compareOutcome(baselinePlatforms, currentPlatforms) {
  const platforms = baselinePlatforms.map((before) => {
    const after = currentPlatforms.find((p) => p.platform === before.platform) ?? null;
    return { platform: before.platform, before, after, verdict: platformVerdict(before, after) };
  });
  const count = (v) => platforms.filter((p) => p.verdict === v).length;
  // The panel's one-line delta: the mean position over the platforms mentioned
  // and ranked on both sides, so a not-mentioned side's stray position is left out.
  const ranked = platforms.filter(
    (p) =>
      p.verdict !== 'not_enough_data' &&
      mentioned(p.before) &&
      mentioned(p.after) &&
      p.before.mentionPosition !== null &&
      p.after.mentionPosition != null,
  );
  const mean = (xs) => (xs.length ? round1(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
  return {
    platforms,
    summary: {
      total: platforms.length,
      measurable: platforms.length - count('not_enough_data'),
      improved: count('improved'),
      declined: count('declined'),
      avgBefore: mean(ranked.map((p) => p.before.mentionPosition)),
      avgAfter: mean(ranked.map((p) => p.after.mentionPosition)),
    },
  };
}

/** When a completed action's tracking ends; null while it is open. */
export function trackingEndsAt(action) {
  if (action.status !== 'completed' || !action.completed_at) return null;
  return new Date(Date.parse(action.completed_at) + OUTCOME_TRACKING_DAYS * DAY_MS);
}

/**
 * Take today's read for one action and store it. A completed action past its
 * 30 days gets its final read, over the 7 days ending on day 30, and a
 * History event.
 */
export async function refreshImproveOutcome(action, { now = new Date() } = {}) {
  const baseline = action.baseline?.platforms ?? [];
  if (baseline.length === 0 || !action.payload?.promptId) return null;
  if (action.position_outcome?.final) return action.position_outcome;

  const ends = trackingEndsAt(action);
  const final = !!ends && ends <= now;
  const window = outcomeWindow(final ? ends : now);
  const current = await readPlatformStates({
    promptId: action.payload.promptId,
    brandId: action.brand_id,
    region: action.payload.region ?? null,
    platforms: baseline.map((p) => p.platform),
    window,
  });
  const outcome = {
    measuredAt: now.toISOString(),
    window,
    final,
    ...compareOutcome(baseline, current),
  };

  const { error } = await supabaseAdmin
    .from('actions')
    .update({ position_outcome: outcome })
    .eq('id', action.id);
  if (error) throw new Error(error.message);

  if (final) {
    await supabaseAdmin.from('action_events').insert({
      action_id: action.id,
      event: 'position_outcome_recorded',
      actor_id: null,
      data: {
        improved: outcome.summary.improved,
        declined: outcome.summary.declined,
        measurable: outcome.summary.measurable,
        total: outcome.summary.total,
      },
    });
  }
  return outcome;
}

/**
 * The daily refresh: every Improve action still open, and every completed one
 * whose final read hasn't been recorded. Dismissed actions are not tracked.
 * Final reads are left out by the query itself: they pile up over time and
 * would otherwise fill the limit before the actions still being tracked.
 */
export async function sweepImproveOutcomes({ now = new Date() } = {}) {
  const { data: actions, error } = await supabaseAdmin
    .from('actions')
    .select(
      'id, brand_id, status, payload, baseline, completed_at, position_outcome, brands!inner(is_demo)',
    )
    // A demo brand's actions (00380) are sample data, measured as written.
    .eq('brands.is_demo', false)
    .eq('kind', 'prompt_improve')
    .in('status', [...OPEN, 'completed'])
    .or('position_outcome.is.null,position_outcome->>final.neq.true')
    .limit(1000);
  if (error) throw new Error(error.message);

  let refreshed = 0;
  for (const action of actions ?? []) {
    try {
      await refreshImproveOutcome(action, { now });
      refreshed += 1;
    } catch (err) {
      logger.warn({ err, actionId: action.id }, 'improve outcome refresh failed');
    }
  }
  logger.info({ refreshed }, 'improve outcomes refreshed');
  return { refreshed };
}
