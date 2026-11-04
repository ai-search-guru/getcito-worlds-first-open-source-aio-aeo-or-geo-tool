/**
 * "Send biggest gap to Actions" (VIS-010): the Insights heat map's topic
 * where a competitor leads you most, sent as a Compete action.
 *
 * The person picks the topic and the competitor; the scores are worked out
 * again here from the same rollups the heat map reads (00137), so the action
 * states the gap as GetCito measures it, not as a client says it is. The
 * work is C04's (close_topic_coverage_gap) plan, measured afterwards on the
 * topic's prompts like a content opportunity (basketMetrics.js).
 */

import supabaseAdmin from '../../config/supabase.js';
import { computeAiVisibilityScore } from '../../config/visibilityScore.js';
import { targetKeys } from '../targetIds.js';
import { resolveBrandSources } from './sources.js';
import { planTasks } from './tasks/plan.js';

export const TOPIC_GAP_ACTION_KIND = 'topic_competitor_gap';

const ACTIVE = ['new', 'in_progress', 'on_hold'];
/** Under this many answers a topic shows "Low sample" on the heat map, and isn't sent. */
const LOW_SAMPLE_ANSWERS = 20;
const KPI_KEYS = ['ai_visibility', 'share_of_voice'];

/** C04's plan: the same work, sent by a person instead of raised by a signal. */
export const TOPIC_GAP_TASKS = [
  'analyze_topic_gap',
  'analyze_competitor_visibility',
  'analyze_competitor_content',
  'cluster_prompts',
  'map_prompts_to_content',
  'identify_content_gaps',
  { branch: [['optimize_content'], ['create_content_brief', 'create_content_draft']] },
  'validate_topic_sov',
  'measure_action_outcome',
];

function httpError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

const num = (v) => Number(v ?? 0);

/** An entity's Visibility in a topic, over the brand's answers there (as the heat map scores it). */
function score(answers, components) {
  const positions = num(components?.position_count);
  return (
    computeAiVisibilityScore({
      answers,
      mentionAnswers: num(components?.mention_answers),
      citationAnswers: num(components?.citation_answers),
      positionFactor: positions > 0 ? num(components?.sum_inv_position) / positions : null,
    }) ?? 0
  );
}

/**
 * Your score, the competitor's and the gap between them in one topic of an
 * insights_topic_competitors_daily payload. A competitor never named in the
 * topic scores 0.
 */
export function topicGapScores(topic, competitorId) {
  const answers = num(topic.answers);
  const competitor = (topic.competitors || []).find((c) => c.competitor_id === competitorId);
  const you = score(answers, topic);
  const them = score(answers, competitor);
  return { answers, you, them, gap: Math.round((them - you) * 10) / 10 };
}

/** How much a gap matters: 20+ points is high, 10+ medium. */
export function topicGapImpact(gap) {
  if (gap >= 20) return 'high';
  if (gap >= 10) return 'medium';
  return 'low';
}

/**
 * Creates the Compete action, or returns the open one if this topic was
 * already sent: one gap action per topic at a time, even if another
 * competitor has taken the lead since.
 *
 * @param {{ id: string, name: string, brand_id: string }} topic - checked against the caller's org
 * @param {{ competitorId: string, dayFrom?: string, dayTo?: string, models?: string[],
 *   region?: string, userId: string }} opts - the heat map's window and filters
 * @returns {Promise<{ actionId: string, actionNo: number, created: boolean }>}
 */
export async function sendTopicGapToActionCenter(
  topic,
  { competitorId, dayFrom, dayTo, models, region, userId },
) {
  const brandId = topic.brand_id;

  const { data: competitor } = await supabaseAdmin
    .from('competitors')
    .select('id, name')
    .eq('id', competitorId)
    .eq('brand_id', brandId)
    .maybeSingle();
  if (!competitor) throw httpError('Competitor not found', 404);

  const dedupKey = `topic_gap:${topic.id}`;
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

  const { data: map, error: mapErr } = await supabaseAdmin.rpc('insights_topic_competitors_daily', {
    p_brand_id: brandId,
    p_day_from: dayFrom ?? null,
    p_day_to: dayTo ?? null,
    p_models: models?.length ? models : null,
    p_region: region || null,
  });
  if (mapErr) throw new Error(mapErr.message);
  const row = map?.complete ? (map.topics || []).find((t) => t.topic_id === topic.id) : null;
  if (!row) throw httpError('No answers for this topic in the selected range', 409);
  const { answers, you, them, gap } = topicGapScores(row, competitor.id);
  // The heat map's rule, kept here too: the server decides what is sent.
  if (answers < LOW_SAMPLE_ANSWERS) {
    throw httpError('Too few answers in this topic to measure a gap', 409);
  }
  if (gap <= 0) throw httpError('The competitor does not lead this topic', 409);

  // The prompts it is measured on (basketMetrics.js), fixed at send time so
  // moving a prompt to another topic later doesn't change what it's judged by.
  const { data: prompts, error: promptsErr } = await supabaseAdmin
    .from('prompts')
    .select('id, text, prompt_sets!inner(brand_id)')
    .eq('topic_id', topic.id)
    .eq('prompt_sets.brand_id', brandId);
  if (promptsErr) throw new Error(promptsErr.message);

  const payload = {
    source: TOPIC_GAP_ACTION_KIND,
    topicId: topic.id,
    topicName: topic.name,
    competitorId: competitor.id,
    competitorName: competitor.name,
    // Library task titles name the competitor from this list (tasks/plan.js).
    competitorNames: [competitor.name],
    yourScore: you,
    competitorScore: them,
    gap,
    window: { dayFrom: dayFrom ?? null, dayTo: dayTo ?? null },
    promptIds: (prompts || []).map((p) => p.id),
    targetEntity: 'prompts',
    // As many as the action keeps of them (AC-009).
    targetCount: targetKeys((prompts || []).map((p) => p.id)).length,
    targets: (prompts || []).slice(0, 50).map((p) => p.text),
  };

  const { data: action, error } = await supabaseAdmin
    .from('actions')
    .insert({
      brand_id: brandId,
      category: 'compete',
      kind: TOPIC_GAP_ACTION_KIND,
      definition_version: 1,
      impact: topicGapImpact(gap),
      payload,
      kpi_keys: KPI_KEYS,
      baseline: { yourScore: you, competitorScore: them, gap },
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
    { id: TOPIC_GAP_ACTION_KIND, tasks: TOPIC_GAP_TASKS },
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
      source: TOPIC_GAP_ACTION_KIND,
      topicId: topic.id,
      competitorId: competitor.id,
      gap,
      taskCount: plan.length,
    },
  });

  return { actionId: action.id, actionNo: Number(action.action_no), created: true };
}
