/**
 * "Suggest content" from a prompt's row (PROMPT-006): one content opportunity
 * for that prompt, unless it already has an open one.
 *
 * A prompt is answered by its cluster's opportunity, or, for older ones, by an
 * opportunity written for the prompt itself, so both count as its own. Only
 * an open one stops a new suggestion: a dismissed or finished one doesn't,
 * since the user is asking again on purpose.
 */

import supabaseAdmin from '../config/supabase.js';
import { OPEN_OPPORTUNITY_STATUSES } from './opportunityLimits.js';

/** How long a queued or running job holds back a suggestion for its prompt. */
const RUNNING_WINDOW_MS = 10 * 60 * 1000;

/** The cluster the prompt is in today, or null before it's grouped. */
export async function promptClusterId(promptId) {
  const { data, error } = await supabaseAdmin
    .from('prompt_cluster_members')
    .select('cluster_id')
    .eq('prompt_id', promptId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.cluster_id ?? null;
}

/**
 * The newest open opportunity that answers this prompt: its cluster's own
 * or merged one, or one written for the prompt itself. Null when none is open.
 */
export async function openOpportunityForPrompt(brandId, promptId) {
  const clusterId = await promptClusterId(promptId);
  let query = supabaseAdmin
    .from('content_opportunities')
    .select('id')
    .eq('brand_id', brandId)
    .in('status', OPEN_OPPORTUNITY_STATUSES);
  query = clusterId
    ? query.or(
        `prompt_id.eq.${promptId},cluster_id.eq.${clusterId},related_cluster_ids.cs.{${clusterId}}`,
      )
    : query.eq('prompt_id', promptId);
  const { data, error } = await query.order('created_at', { ascending: false }).limit(1);
  if (error) throw new Error(error.message);
  return data?.[0]?.id ?? null;
}

/**
 * A content job for this prompt that is still queued or running: an earlier
 * suggestion, or "+ New" focused on the prompt. Asking again (after the page
 * stopped waiting, or from another tab) follows it instead of writing the
 * same opportunity twice; a job focused on one prompt writes at most one, for
 * the prompt's cluster. Null when there is none.
 */
export async function runningSuggestionJob(brandId, promptId) {
  const since = new Date(Date.now() - RUNNING_WINDOW_MS).toISOString();
  const { data, error } = await supabaseAdmin
    .from('jobs')
    .select('id')
    .eq('type', 'content')
    .eq('brand_id', brandId)
    .in('status', ['waiting', 'active'])
    .eq('data->request->>promptId', promptId)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  return data?.[0]?.id ?? null;
}

/**
 * The content job request for one suggestion: exactly one, for the prompt's
 * cluster even if an earlier opportunity there was dismissed, tagged prompt.
 */
export function promptSuggestionRequest(promptId, idempotencyKey) {
  return { count: 1, promptId, explicit: true, source: 'prompt', idempotencyKey };
}
