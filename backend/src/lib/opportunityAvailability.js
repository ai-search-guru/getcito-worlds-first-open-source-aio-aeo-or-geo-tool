/**
 * What "+ New" (CONTENT-003) can still write for, read when its dialog opens.
 *
 * A need (prompt cluster) gets one opportunity (coveredClusterIds), and only
 * a need with tracked answers in the window has anything to write from. The
 * dialog shows, per topic and in all, how many needs are still open, so a
 * request that would write nothing isn't sent; and which prompts' needs have
 * an open opportunity, so it can offer that one instead. The run's own
 * duplicate checks (CONTENT-004, same question) may still take a few more.
 */

import supabaseAdmin from '../config/supabase.js';
import { loadClusterOpportunities } from './openOpportunities.js';
import { loadClusters } from './promptClusters.js';
import {
  OPPORTUNITY_WINDOW_DAYS,
  coveredClusterIds,
  openOpportunityOn,
} from './opportunityLimits.js';

/** The no-topic scope's key in `topics`. */
export const NO_TOPIC = 'none';

/**
 * @param {{
 *   clusters: { id: string, topic_id: string | null, prompt_ids: string[] }[],
 *   opportunities: { id: string, status: string, cluster_id: string, related_cluster_ids?: string[] }[],
 *   testedPromptIds: Set<string>,
 * }} input
 * @returns {{
 *   needs: number, open: number, covered: number, noAnswers: number,
 *   topics: Record<string, { open: number, covered: number, noAnswers: number }>,
 *   promptOpportunity: Record<string, string>,
 * }}
 */
export function needAvailability({ clusters, opportunities, testedPromptIds }) {
  const covered = coveredClusterIds(opportunities);
  const total = { open: 0, covered: 0, noAnswers: 0 };
  const topics = {};
  const promptOpportunity = {};
  for (const c of clusters) {
    const topic = (topics[c.topic_id ?? NO_TOPIC] ??= { open: 0, covered: 0, noAnswers: 0 });
    let state = 'noAnswers';
    if (covered.has(c.id)) {
      state = 'covered';
      const id = openOpportunityOn(opportunities, c.id);
      if (id) for (const p of c.prompt_ids) promptOpportunity[p] = id;
    } else if (c.prompt_ids.some((p) => testedPromptIds.has(p))) {
      state = 'open';
    }
    topic[state] += 1;
    total[state] += 1;
  }
  return { needs: clusters.length, ...total, topics, promptOpportunity };
}

/** A brand's needAvailability, from its clusters, opportunities and tracked answers. */
export async function loadNeedAvailability(brandId) {
  const since = new Date(Date.now() - OPPORTUNITY_WINDOW_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const [clusters, opportunities, metrics] = await Promise.all([
    loadClusters(brandId),
    loadClusterOpportunities(brandId),
    supabaseAdmin.rpc('brand_prompt_opportunity_metrics', {
      p_brand_id: brandId,
      p_since: since,
    }),
  ]);
  if (metrics.error) throw new Error(metrics.error.message);
  const testedPromptIds = new Set(
    (metrics.data || []).filter((m) => m.cells > 0).map((m) => m.prompt_id),
  );
  return needAvailability({ clusters, opportunities, testedPromptIds });
}
