/**
 * Turning a content opportunity, or one of its assets, into an Action Center
 * action (#857, Phase 2).
 *
 * Signal-driven actions come from the nightly engine (generate.js). These are
 * created by a person instead, so they skip the definitions and the candidate
 * queue, and plan their tasks from the asset itself: what kind of work it is
 * (owned or earned) and what the opportunity decided to do with the brand's
 * page. The tasks are the library's own, so they render, run and get
 * measured like any other action's.
 */

import { targetKeys } from '../targetIds.js';
import supabaseAdmin from '../../config/supabase.js';
import { resolveBrandSources } from './sources.js';
import { planTasks } from './tasks/plan.js';
import { priorityOnCreate } from './priorityData.js';

export const OPPORTUNITY_ACTION_KIND = 'content_opportunity';

/** What a completed opportunity action is measured on (validate.js). */
const KPI_KEYS = ['ai_visibility', 'citations', 'mentions'];

/** The key an opportunity sent as a whole is recorded under. */
export const WHOLE = 'all';

const OWNED_WORK = {
  create: ['create_content_brief', 'create_content_draft', 'add_internal_links'],
  refresh: ['refresh_content'],
  // optimize, expand, consolidate and defend all work on an existing page.
  default: ['optimize_content', 'add_internal_links'],
};

const EARNED_WORK = {
  third_party_article: ['identify_target_sources', 'prepare_contribution', 'execute_outreach'],
  backlink: ['identify_target_sources', 'prepare_outreach', 'execute_outreach'],
};

/** The library tasks one asset needs, in order. */
export function assetTasks(asset) {
  if (asset.channel === 'earned') {
    const work = EARNED_WORK[asset.type] || EARNED_WORK.third_party_article;
    return [
      ...work,
      'track_third_party_status',
      asset.type === 'backlink' ? 'validate_third_party_citation' : 'validate_third_party_presence',
    ];
  }
  return [
    ...(OWNED_WORK[asset.decision] || OWNED_WORK.default),
    'publish_content',
    'validate_ai_visibility',
  ];
}

/**
 * The tasks for several assets as one plan: each task once, the work first,
 * then every check, then the outcome measurement last.
 */
export function combinedTasks(assets) {
  const all = [...new Set(assets.flatMap(assetTasks))];
  const isCheck = (id) => id.startsWith('validate_');
  return [...all.filter((id) => !isCheck(id)), ...all.filter(isCheck), 'measure_action_outcome'];
}

/**
 * An opportunity's assets. Opportunities written before assets existed get
 * one, from their own type and decision.
 */
export function opportunityAssets(opportunity) {
  const assets = opportunity.source_data?.assets;
  if (Array.isArray(assets) && assets.length) return assets;
  return [
    {
      key: 'a1',
      type: null,
      channel: opportunity.type === 'earned' ? 'earned' : 'owned',
      decision: opportunity.decision || 'create',
      title: opportunity.title,
      pages: opportunity.source_data?.targetPages || [],
    },
  ];
}

const ACTIVE = ['new', 'in_progress', 'on_hold'];

/**
 * What the action is measured on and shows as its targets: the prompts of
 * the opportunity's clusters, or, without any (the older per-prompt
 * generator, or clusters a re-clustering removed), the one prompt it was
 * written for. The targets always name what is measured.
 */
export function actionPromptScope(opportunity, memberPromptIds) {
  const sd = opportunity.source_data || {};
  if (memberPromptIds.length || !opportunity.prompt_id) {
    return { promptIds: memberPromptIds, prompts: sd.prompts || [] };
  }
  return { promptIds: [opportunity.prompt_id], prompts: sd.promptText ? [sd.promptText] : [] };
}

/**
 * The count and keys an opportunity's action keeps (AC-009): the prompts it
 * is scoped to when it has them, else the ones the opportunity names (by
 * id, or by text), each once (targetKeys). The first 50 named are shown as
 * before.
 */
export function actionTargets(promptIds, prompts) {
  const keyOf = (p) => (typeof p === 'string' ? p : String(p?.id ?? p?.text ?? p?.label ?? ''));
  const keys = targetKeys(promptIds.length ? promptIds : prompts.map(keyOf));
  return {
    targetCount: keys.length,
    targets: prompts.slice(0, 50),
    ...(keys.length ? { targetIds: keys } : {}),
  };
}

/**
 * A task's status when the action opens. The brief task starts completed when
 * the opportunity already has a brief: the work is done, and the brief is
 * shown on the action. Every row states its status: a bulk insert sends the
 * union of the rows' keys, so a row without one would send null.
 */
export function initialTaskStatus(taskKey, opportunity) {
  return taskKey === 'create_content_brief' && opportunity.brief ? 'completed' : 'todo';
}

/**
 * Creates the action, or returns the open one if this opportunity or asset
 * was already sent, and records the action on the opportunity.
 *
 * @param {object} opportunity - the content_opportunities row
 * @param {{ assetKey?: string|null, userId: string, readable?: object }} opts - `readable`:
 *   the same row with its text cleaned for reading (opportunityText.js); the
 *   action shows that text, while the row written back keeps its own.
 * @returns {Promise<{ actionId: string, created: boolean }>}
 */
export async function sendToActionCenter(
  opportunity,
  { assetKey = null, userId, readable = opportunity },
) {
  // An opportunity a task was sent as (AC-004) is that action's work already:
  // it opens the action rather than starting a second one for the same thing.
  const from = opportunity.source_data?.fromAction?.actionId;
  if (opportunity.source === 'action' && from) return { actionId: from, created: false };

  const assets = opportunityAssets(readable);
  const chosen = assetKey ? assets.filter((a) => a.key === assetKey) : assets;
  if (!chosen.length) {
    const err = new Error('Asset not found');
    err.status = 404;
    throw err;
  }

  const key = assetKey || WHOLE;
  const dedupKey = `opportunity:${opportunity.id}:${key}`;
  const { data: open } = await supabaseAdmin
    .from('actions')
    .select('id')
    .eq('brand_id', opportunity.brand_id)
    .eq('dedup_key', dedupKey)
    .in('status', ACTIVE)
    .maybeSingle();
  if (open) return { actionId: open.id, created: false };

  const sd = opportunity.source_data || {};
  // The prompts the action is measured on (basketMetrics.js), fixed at send
  // time so a later re-clustering does not change what it is judged by.
  const clusterIds = [opportunity.cluster_id, ...(opportunity.related_cluster_ids || [])].filter(
    Boolean,
  );
  const { data: members, error: membersErr } = clusterIds.length
    ? await supabaseAdmin
        .from('prompt_cluster_members')
        .select('prompt_id')
        .in('cluster_id', clusterIds)
    : { data: [], error: null };
  if (membersErr) throw new Error(membersErr.message);
  const { promptIds, prompts } = actionPromptScope(
    opportunity,
    (members || []).map((m) => m.prompt_id),
  );
  const payload = {
    source: OPPORTUNITY_ACTION_KIND,
    opportunityId: opportunity.id,
    assetKey,
    title: assetKey ? chosen[0].title : readable.title,
    decision: chosen[0].decision,
    assets: chosen.map(({ key: k, type, channel, decision, title }) => ({
      key: k,
      type,
      channel,
      decision,
      title,
    })),
    pages: [...new Set(chosen.flatMap((a) => (a.pages || []).map((p) => p.url)))],
    promptIds,
    targetEntity: 'prompts',
    // What the action counts is the list it keeps (AC-009): its prompts when
    // it has them, else the prompts the opportunity names.
    ...actionTargets(promptIds, prompts),
    contentExists: chosen.some((a) => a.decision !== 'create'),
  };

  const { data: action, error } = await supabaseAdmin
    .from('actions')
    .insert({
      brand_id: opportunity.brand_id,
      category: 'growth',
      kind: OPPORTUNITY_ACTION_KIND,
      definition_version: 1,
      impact: opportunity.impact,
      payload,
      kpi_keys: KPI_KEYS,
      baseline: {},
      dedup_key: dedupKey,
      ...(await priorityOnCreate({
        brand_id: opportunity.brand_id,
        kind: OPPORTUNITY_ACTION_KIND,
        category: 'growth',
        impact: opportunity.impact,
        payload,
      })),
    })
    .select('id')
    .single();
  if (error) throw new Error(error.message);

  const sources = await resolveBrandSources(opportunity.brand_id);
  const plan = planTasks(
    { id: OPPORTUNITY_ACTION_KIND, tasks: combinedTasks(chosen) },
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
      status: initialTaskStatus(item.taskKey, opportunity),
    })),
  );
  if (tasksErr) throw new Error(tasksErr.message);

  await supabaseAdmin.from('action_events').insert({
    action_id: action.id,
    event: 'created',
    actor_id: userId,
    data: {
      source: OPPORTUNITY_ACTION_KIND,
      opportunityId: opportunity.id,
      assetKey,
      impact: opportunity.impact,
      taskCount: plan.length,
    },
  });

  const { error: oppErr } = await supabaseAdmin
    .from('content_opportunities')
    .update({
      // Status follows the action through a trigger (00106).
      source_data: { ...sd, actions: { ...(sd.actions || {}), [key]: action.id } },
      updated_at: new Date().toISOString(),
    })
    .eq('id', opportunity.id);
  if (oppErr) throw new Error(oppErr.message);

  return { actionId: action.id, created: true };
}
