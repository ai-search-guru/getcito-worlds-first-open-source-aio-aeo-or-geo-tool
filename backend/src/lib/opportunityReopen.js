/**
 * "New signal detected": re-opening finished opportunities (#857, Phase 4).
 *
 * The signals under an opportunity keep moving after its work is done. When
 * a completed, measured opportunity has a reason to be worked on again, it
 * goes back to New — the same row, with what changed recorded on it — rather
 * than a near-copy being generated beside it. Two reasons count:
 *
 * - its cluster's score rose by SCORE_RISE points since it was scored: more
 *   demand, or competitors further ahead (the spec's "strengthens");
 * - the gain its work measured was lost: the basket's visibility fell below
 *   GAIN_LOST_RATIO of the "after" value its action measured.
 *
 * An opportunity is only considered once all its actions are completed and
 * measured, so nothing re-opens in the weeks before its result is known.
 */

import supabaseAdmin from '../config/supabase.js';
import { logger } from './logger.js';

export const SCORE_RISE = 10;
export const GAIN_LOST_RATIO = 0.5;

/**
 * Why a finished opportunity should be worked on again, or null.
 *
 * @param {{ score: number, visibility: number }} now - the cluster's current figures
 * @param {{ previousScore: number, visibilityAfter: number|null }} then
 */
export function reopenReason(now, { previousScore, visibilityAfter }) {
  if (now.score - previousScore >= SCORE_RISE) return 'score_rose';
  if (visibilityAfter > 0 && now.visibility < visibilityAfter * GAIN_LOST_RATIO) return 'gain_lost';
  return null;
}

/**
 * The basket visibility an opportunity's work was measured at afterwards,
 * or undefined while any of its actions is open or unmeasured. Null when it
 * is measured but has no basket visibility to compare against.
 */
export function measuredAfter(actions) {
  if (!actions.length) return undefined;
  if (actions.some((a) => a.status !== 'completed' || a.outcome === 'pending_measurement')) {
    return undefined;
  }
  const values = actions
    .filter((a) => a.validation?.scope?.kind === 'basket')
    .flatMap((a) => a.validation.metrics || [])
    .filter((m) => m.metric === 'ai_visibility' && m.after != null)
    .map((m) => Number(m.after));
  return values.length ? Math.max(...values) : null;
}

/**
 * Re-opens the brand's done opportunities that have a reason to be worked on
 * again. `measure(clusterIds)` scores clusters as generation does; `skip`
 * keeps one closed, as when another open opportunity answers its question.
 *
 * @returns {Promise<number>} how many were re-opened
 */
export async function reopenStrengthened(brandId, opportunities, measure, { skip } = {}) {
  const done = opportunities.filter((o) => o.status === 'done' && o.cluster_id && !skip?.(o));
  if (!done.length) return 0;

  const { data: actions, error } = await supabaseAdmin
    .from('actions')
    .select('status, outcome, validation, opportunityId:payload->>opportunityId')
    .eq('brand_id', brandId)
    .eq('kind', 'content_opportunity')
    .in(
      'payload->>opportunityId',
      done.map((o) => o.id),
    );
  if (error) throw new Error(error.message);

  let reopened = 0;
  for (const opp of done) {
    const visibilityAfter = measuredAfter(
      (actions || []).filter((a) => a.opportunityId === opp.id),
    );
    if (visibilityAfter === undefined) continue;

    const current = measure([opp.cluster_id, ...(opp.related_cluster_ids || [])]);
    const previousScore = Number(opp.opportunity_score) || 0;
    const reason = reopenReason(
      { score: current.score, visibility: current.metrics.visibility },
      { previousScore, visibilityAfter },
    );
    if (!reason) continue;

    const { data: row, error: readErr } = await supabaseAdmin
      .from('content_opportunities')
      .select('source_data')
      .eq('id', opp.id)
      .single();
    if (readErr) throw new Error(readErr.message);
    const sd = row.source_data || {};

    const { error: writeErr } = await supabaseAdmin
      .from('content_opportunities')
      .update({
        status: 'new',
        opportunity_score: current.score,
        source_data: {
          ...sd,
          estAiVolume: current.metrics.demand,
          visibilityScore: current.metrics.visibility,
          topCompetitorVisibility: current.metrics.topCompetitorVisibility,
          competitorGap: current.metrics.competitorGap,
          scoreComponents: current.components,
          // The finished work stays visible; new work can be sent.
          actions: {},
          pastActions: [...(sd.pastActions || []), ...Object.values(sd.actions || {})],
          reopened: {
            at: new Date().toISOString(),
            reason,
            previousScore,
            score: current.score,
            visibilityAfter,
            visibility: current.metrics.visibility,
          },
        },
        updated_at: new Date().toISOString(),
      })
      .eq('id', opp.id)
      .eq('status', 'done');
    if (writeErr) throw new Error(writeErr.message);
    reopened += 1;
    logger.info(
      { brandId, opportunityId: opp.id, reason, previousScore, score: current.score },
      '[opportunities] new signal detected, re-opened',
    );
  }
  return reopened;
}
