/**
 * "Send to Action Center" from the Mentions tab (MS-08): one or more AI
 * answers that name the brand, sent as one action to change how AI
 * describes it.
 *
 * The person picks the answers; what they say is read again here from
 * prompt_results, so the action states the platforms, prompts and sentiment
 * as tracking stored them, not as a client says they are. Only the excerpts
 * come from the caller (the web cuts them from the same answers). The work
 * is F08's plan (fix_brand_inconsistency), the one written for how AI
 * describes a brand, measured afterwards on the answers' prompts like any
 * person-sent action (basketMetrics.js).
 */

import { createHash } from 'node:crypto';
import supabaseAdmin from '../../config/supabase.js';
import { resolveBrandSources } from './sources.js';
import { planTasks } from './tasks/plan.js';

export const MENTION_ACTION_KIND = 'mention_review';

const ACTIVE = ['new', 'in_progress', 'on_hold'];
const KPI_KEYS = ['mentions', 'ai_visibility', 'positive_sentiment'];

/**
 * Its success metrics, its aim first (validate.js judges it by the first):
 * answers sent with negative ones in them are Protect work, to turn how the
 * brand is spoken of (learning D1); others, to be named more.
 */
export function mentionKpiKeys(negative) {
  return negative > 0 ? ['positive_sentiment', 'mentions', 'ai_visibility'] : KPI_KEYS;
}
/** At most a page of the Mentions table at once. */
export const MAX_MENTIONS = 100;
/** The answers quoted on the action. */
const EVIDENCE = 10;
const EXCERPT_MAX = 400;

/** F08's plan, without its entity-signal audit: the answers themselves are the evidence. */
export const MENTION_REVIEW_TASKS = [
  'analyze_mention_context',
  'analyze_citations',
  'identify_target_pages',
  'strengthen_entity_content',
  'publish_content',
  'validate_mentions',
  'measure_action_outcome',
];

function httpError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/** One action per set of answers: the same answers sent again find it. */
export function mentionDedupKey(resultIds) {
  const digest = createHash('sha1')
    .update([...new Set(resultIds)].sort().join(','))
    .digest('hex');
  return `mentions:${digest.slice(0, 20)}`;
}

/** Negative answers make it Protect work; how many of them, how urgent. */
export function mentionActionWeight(answers) {
  const negative = answers.filter((a) => a.sentiment === 'negative').length;
  const share = answers.length > 0 ? negative / answers.length : 0;
  return {
    negative,
    category: negative > 0 ? 'protect' : 'growth',
    impact: share >= 0.5 ? 'high' : negative > 0 ? 'medium' : 'low',
  };
}

/**
 * The sentiment of the answers sent, as the action's baseline: positive and
 * negative counts and the net (%positive − %negative), neutral being the rest.
 */
export function mentionBaseline(answers) {
  const positive = answers.filter((a) => a.sentiment === 'positive').length;
  const negative = answers.filter((a) => a.sentiment === 'negative').length;
  const mentions = answers.length;
  return {
    mentions,
    positive,
    negative,
    netSentiment: mentions > 0 ? Math.round(((positive - negative) * 100) / mentions) : null,
  };
}

/**
 * Creates the action, or returns the open one if these answers were already
 * sent.
 *
 * @param {string} brandId - checked against the caller's org by the route
 * @param {{ resultIds: string[], excerpts?: Record<string, string>, userId: string }} opts
 * @returns {Promise<{ actionId: string, actionNo: number, created: boolean }>}
 */
export async function sendMentionsToActionCenter(brandId, { resultIds, excerpts = {}, userId }) {
  const ids = [...new Set(resultIds)].slice(0, MAX_MENTIONS);

  // The brand's own answers that name it; anything else sent is ignored.
  const { data: rows, error: rowsErr } = await supabaseAdmin
    .from('prompt_results')
    .select('id, prompt_id, platform, region, sentiment, mention_count, created_at, prompts(text)')
    .eq('brand_id', brandId)
    .in('id', ids);
  if (rowsErr) throw new Error(rowsErr.message);
  const answers = (rows || [])
    .filter((r) => Number(r.mention_count) > 0 && r.prompt_id)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  if (!answers.length) throw httpError('No answers naming the brand were found', 404);

  // Keyed on the answers found, so ids that aren't the brand's mentions
  // can't open a second action for the same answers.
  const dedupKey = mentionDedupKey(answers.map((a) => a.id));
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

  const prompts = new Map();
  for (const a of answers) {
    if (!prompts.has(a.prompt_id)) prompts.set(a.prompt_id, a.prompts?.text ?? '');
  }
  const promptIds = [...prompts.keys()];
  const { negative, category, impact } = mentionActionWeight(answers);
  const excerptOf = (id) => {
    const text = typeof excerpts[id] === 'string' ? excerpts[id].trim() : '';
    return text.length > EXCERPT_MAX ? `${text.slice(0, EXCERPT_MAX - 1)}…` : text;
  };

  const payload = {
    source: MENTION_ACTION_KIND,
    mentionCount: answers.length,
    negativeCount: negative,
    promptCount: promptIds.length,
    // The title names the prompt when there is one.
    promptText: prompts.get(promptIds[0]) ?? '',
    platforms: [...new Set(answers.map((a) => a.platform))],
    resultIds: answers.map((a) => a.id),
    evidence: answers.slice(0, EVIDENCE).map((a) => ({
      resultId: a.id,
      promptText: prompts.get(a.prompt_id) ?? '',
      platform: a.platform,
      region: a.region ?? null,
      sentiment: a.sentiment ?? null,
      createdAt: a.created_at,
      excerpt: excerptOf(a.id),
    })),
    // Measured on these prompts once done (basketMetrics.js).
    promptIds,
    targetEntity: 'prompts',
    targetCount: promptIds.length,
    targets: [...prompts.values()].slice(0, 50),
  };

  const { data: action, error } = await supabaseAdmin
    .from('actions')
    .insert({
      brand_id: brandId,
      category,
      kind: MENTION_ACTION_KIND,
      definition_version: 1,
      impact,
      payload,
      kpi_keys: mentionKpiKeys(negative),
      baseline: mentionBaseline(answers),
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
    { id: MENTION_ACTION_KIND, tasks: MENTION_REVIEW_TASKS },
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
      source: MENTION_ACTION_KIND,
      mentions: answers.length,
      prompts: promptIds.length,
      taskCount: plan.length,
    },
  });

  return { actionId: action.id, actionNo: Number(action.action_no), created: true };
}
