/**
 * "Send action" on an Insights Opportunities topic (VIS-011): a topic's
 * suggested prompts, with their demand, sent as a Growth action.
 *
 * The person picks the topic and its suggestions; which suggestions count is
 * read again here (the brand's, in this topic, relevant, and still open or
 * tracked from the card, not dismissed), so the
 * action states the demand as GetCito has it, not as a client says it is.
 * The work follows a library plan chosen by how far the brand already is in
 * the topic: G16 (create_content_for_topics) when none of its prompts track
 * the topic yet, G05 (expand_topic_visibility) when some do. It is measured
 * afterwards on the topic's prompts (basketMetrics.js).
 */

import supabaseAdmin from '../../config/supabase.js';
import { RELEVANCE_THRESHOLD } from '../suggestionRelevance.js';
import { targetKeys } from '../targetIds.js';
import expandTopicVisibility from './definitions/g05ExpandTopicVisibility.js';
import createContentForTopics from './definitions/g16CreateContentForTopics.js';
import { resolveBrandSources } from './sources.js';
import { planTasks } from './tasks/plan.js';

export const TOPIC_OPPORTUNITY_ACTION_KIND = 'topic_opportunity';

const ACTIVE = ['new', 'in_progress', 'on_hold'];
const KPI_KEYS = ['ai_visibility', 'share_of_voice'];

function httpError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/** G16 for a topic none of the brand's prompts track yet, G05 once some do. */
export function topicOpportunityPlan(trackedPrompts) {
  return trackedPrompts > 0 ? expandTopicVisibility : createContentForTopics;
}

/**
 * How much the demand matters: 10k+ AI searches a month is high, 2k+ medium.
 *
 * The demand is the topic's suggestions' estimated volumes added up, and the
 * model estimates those against the brand's tracked prompts. Those used to
 * sum five keywords' Google volumes at a 15% rate; at their median and 45%
 * (#1103) a brand's average prompt reads about a fifth of what it did, so
 * the old 50k and 10k became five times harder to reach.
 */
export function topicOpportunityImpact(volume) {
  if (volume >= 10_000) return 'high';
  if (volume >= 2_000) return 'medium';
  return 'low';
}

/**
 * Creates the Growth action, or returns the open one if this topic was
 * already sent: one opportunity action per topic at a time.
 *
 * @param {{ id: string, name: string, brand_id: string }} topic - checked against the caller's org
 * @param {{ suggestionIds: string[], userId: string }} opts - the item's suggestions
 * @returns {Promise<{ actionId: string, actionNo: number, created: boolean }>}
 */
export async function sendTopicOpportunityToActionCenter(topic, { suggestionIds, userId }) {
  const brandId = topic.brand_id;

  const dedupKey = `topic_opportunity:${topic.id}`;
  const openAction = async () => {
    const { data } = await supabaseAdmin
      .from('actions')
      .select('id, action_no')
      .eq('brand_id', brandId)
      .eq('dedup_key', dedupKey)
      .in('status', ACTIVE)
      .maybeSingle();
    return data;
  };
  const open = await openAction();
  if (open) return { actionId: open.id, actionNo: Number(open.action_no), created: false };

  // The card's rule, kept here too: in this topic and relevant. Tracked
  // ('added') counts: Track takes the topic off the card, and its toast
  // offers Send action for what it just tracked.
  const { data: rows, error: rowsErr } = await supabaseAdmin
    .from('prompt_suggestions')
    .select('id, suggested_text, est_volume, relevance')
    .in('id', suggestionIds)
    .eq('brand_id', brandId)
    .eq('topic_id', topic.id)
    .in('status', ['new', 'added']);
  if (rowsErr) throw new Error(rowsErr.message);
  const suggestions = (rows || [])
    .filter((r) => r.relevance !== null && Number(r.relevance) >= RELEVANCE_THRESHOLD)
    .sort((a, b) => Number(b.est_volume ?? 0) - Number(a.est_volume ?? 0));
  if (!suggestions.length) throw httpError('No open suggestions for this topic', 409);
  const demand = suggestions.reduce((sum, s) => sum + Number(s.est_volume ?? 0), 0);

  // The topic's tracked prompts, fixed at send time like a topic gap's; a
  // topic with none is measured on the prompts it has later (basketMetrics.js).
  const { data: prompts, error: promptsErr } = await supabaseAdmin
    .from('prompts')
    .select('id, text, prompt_sets!inner(brand_id)')
    .eq('topic_id', topic.id)
    .eq('is_active', true)
    .eq('prompt_sets.brand_id', brandId);
  if (promptsErr) throw new Error(promptsErr.message);
  const tracked = prompts || [];
  const definition = topicOpportunityPlan(tracked.length);
  // What it counts is the suggestions, kept by their text, each once
  // (AC-009): not the topic's tracked prompts, which it measures.
  const keys = targetKeys(suggestions.map((s) => s.suggested_text));
  // None with words: its list would fall back to the tracked prompts.
  if (!keys.length) throw httpError('No open suggestions for this topic', 409);

  const payload = {
    source: TOPIC_OPPORTUNITY_ACTION_KIND,
    topicId: topic.id,
    topicName: topic.name,
    plan: definition.code,
    demand,
    suggestions: suggestions.map((s) => ({
      id: s.id,
      text: s.suggested_text,
      volume: Number(s.est_volume ?? 0),
    })),
    trackedPrompts: tracked.length,
    promptIds: tracked.map((p) => p.id),
    targetEntity: 'prompts',
    targetCount: keys.length,
    targets: suggestions.slice(0, 50).map((s) => s.suggested_text),
    targetIds: keys,
  };

  const { data: action, error } = await supabaseAdmin
    .from('actions')
    .insert({
      brand_id: brandId,
      category: 'growth',
      kind: TOPIC_OPPORTUNITY_ACTION_KIND,
      definition_version: 1,
      impact: topicOpportunityImpact(demand),
      payload,
      kpi_keys: KPI_KEYS,
      baseline: { demand, trackedPrompts: tracked.length },
      dedup_key: dedupKey,
    })
    .select('id, action_no')
    .single();
  if (error) {
    // Two sends at once: the other one opened it (the open-action dedup index, 00084).
    if (error.code === '23505') {
      const winner = await openAction();
      if (winner) {
        return { actionId: winner.id, actionNo: Number(winner.action_no), created: false };
      }
    }
    throw new Error(error.message);
  }

  const sources = await resolveBrandSources(brandId);
  const plan = planTasks(
    { id: TOPIC_OPPORTUNITY_ACTION_KIND, tasks: definition.tasks },
    { sources, payload },
  );
  const { error: tasksErr } = await supabaseAdmin.from('action_tasks').insert(
    plan.map((item) => ({
      action_id: action.id,
      position: item.position,
      task_key: item.taskKey,
      task_version: item.version,
      mode: item.mode,
      permission: item.permission,
      depends_on: item.dependsOn,
      title_params: item.titleParams,
      details: item.details,
      status: 'todo',
    })),
  );
  if (tasksErr) throw new Error(tasksErr.message);

  await supabaseAdmin.from('action_events').insert({
    action_id: action.id,
    event: 'created',
    actor_id: userId,
    data: {
      source: TOPIC_OPPORTUNITY_ACTION_KIND,
      topicId: topic.id,
      plan: definition.code,
      demand,
      taskCount: plan.length,
    },
  });

  return { actionId: action.id, actionNo: Number(action.action_no), created: true };
}
