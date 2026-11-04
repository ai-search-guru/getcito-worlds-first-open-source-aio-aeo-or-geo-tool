/**
 * The one-off merge of open opportunities made before one open opportunity
 * stood for one question (opportunitySameQuestion.js).
 *
 * Per brand, each group of open opportunities on one question keeps one: the
 * one furthest along, then the one with work on it, then the higher score.
 * It takes in the others' prompts, AI searches and sources, and records them
 * (`merged`); the others are archived, pointing at it (`mergedInto`), and can
 * be restored from the Archived filter. Drafts stay with the opportunity they
 * were written for.
 *
 * Dry by default: it returns what it would do. Run it with
 * scripts/mergeSameQuestionOpportunities.js.
 */

import supabaseAdmin from '../config/supabase.js';
import { selectInChunks } from './chunkedIn.js';
import { OPEN_OPPORTUNITY_STATUSES } from './opportunityLimits.js';
import { planSameQuestionMerges } from './opportunitySameQuestion.js';

const PAGE = 1000;

async function loadOpen(brandId) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from('content_opportunities')
      .select(
        'id, brand_id, title, status, source, created_at, updated_at, prompt_id, cluster_id, related_cluster_ids, opportunity_score, impact, brief, webhook_sent_at, source_data',
      )
      .eq('brand_id', brandId)
      .in('status', OPEN_OPPORTUNITY_STATUSES)
      .order('id')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data || []));
    if (!data || data.length < PAGE) return rows;
  }
}

async function loadWithDrafts(ids) {
  if (!ids.length) return new Set();
  const { data, error } = await selectInChunks(ids, (chunk) =>
    supabaseAdmin.from('content_drafts').select('opportunity_id').in('opportunity_id', chunk),
  );
  if (error) throw new Error(error.message);
  return new Set((data || []).map((d) => d.opportunity_id));
}

/**
 * Merges one brand's open opportunities on the same question.
 *
 * @param {string} brandId
 * @param {{ apply?: boolean }} [opts] - writes only with `apply`
 * @returns {Promise<{ groups: { keep: object, merge: object[], skipped?: string }[], merged: number }>}
 *   `skipped` says why a group wasn't written: one of its rows changed meanwhile.
 */
export async function mergeBrandSameQuestion(brandId, { apply = false } = {}) {
  const rows = await loadOpen(brandId);
  const withDrafts = await loadWithDrafts(rows.map((r) => r.id));
  const plans = planSameQuestionMerges(rows, { withDrafts });
  const summary = (r) => ({
    id: r.id,
    title: r.title,
    status: r.status,
    source: r.source,
    score: Number(r.opportunity_score) || 0,
    hasDraft: withDrafts.has(r.id),
  });
  const groups = [];
  let merged = 0;
  for (const plan of plans) {
    const group = { keep: summary(plan.keep), merge: plan.merge.map(summary) };
    groups.push(group);
    if (!apply) continue;

    const now = new Date().toISOString();
    // The one kept first: if archiving fails after, a re-run merges again
    // without counting anything twice.
    const { data: kept, error } = await supabaseAdmin
      .from('content_opportunities')
      .update({ ...plan.update, updated_at: now })
      .eq('id', plan.keep.id)
      .eq('updated_at', plan.keep.updated_at)
      .select('id');
    if (error) throw new Error(error.message);
    if (!kept?.length) {
      group.skipped = 'changed';
      continue;
    }
    for (const row of plan.merge) {
      const { data: archived, error: archiveError } = await supabaseAdmin
        .from('content_opportunities')
        .update({
          status: 'archived',
          source_data: { ...(row.source_data || {}), mergedInto: plan.keep.id },
          updated_at: now,
        })
        .eq('id', row.id)
        .eq('updated_at', row.updated_at)
        .select('id');
      if (archiveError) throw new Error(archiveError.message);
      if (archived?.length) merged += 1;
      else group.skipped = 'changed';
    }
  }
  return { groups, merged };
}
