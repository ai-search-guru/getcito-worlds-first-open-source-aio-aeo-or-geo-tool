/**
 * "Team" in the Content Editor's Start (CE-015, spec §5, §15): a draft sent
 * to the Action Center as an action, for someone on the team to write.
 *
 * The draft is already started (its page type, prompts, the page it
 * optimizes, any text brought in); the action carries the work: the same
 * library tasks a content opportunity's page gets (fromOpportunity.js),
 * a new page's or an existing page's. It is measured afterwards on the
 * draft's prompts and page like any person-sent action (basketMetrics.js),
 * and the draft records the action (content_drafts.action_id, 00208).
 */

import supabaseAdmin from '../../config/supabase.js';
import { assetTasks } from './fromOpportunity.js';
import { priorityOnCreate } from './priorityData.js';
import { resolveBrandSources } from './sources.js';
import { planTasks } from './tasks/plan.js';

export const CONTENT_DRAFT_ACTION_KIND = 'content_draft';

const ACTIVE = ['new', 'in_progress', 'on_hold'];
const KPI_KEYS = ['ai_visibility', 'citations', 'mentions'];
/** Prompts the action lists by name; it is measured on all of them. */
const MAX_TARGETS = 50;

function httpError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/** One action per draft: sending it again finds the one still open. */
export function contentDraftDedupKey(draftId) {
  return `${CONTENT_DRAFT_ACTION_KIND}:${draftId}`;
}

/** The work a draft needs: a new page's, or an existing page's. */
export function contentDraftTasks(method) {
  return assetTasks({ channel: 'owned', decision: method === 'create' ? 'create' : 'optimize' });
}

/**
 * Creates the action, or returns the open one if the draft was already sent.
 *
 * @param {string} brandId - checked against the caller's org by the route
 * @param {{ draftId: string, userId: string }} opts
 * @returns {Promise<{ actionId: string, actionNo: number, created: boolean }>}
 */
export async function sendContentDraftToActionCenter(brandId, { draftId, userId }) {
  const { data: draft, error: draftErr } = await supabaseAdmin
    .from('content_drafts')
    .select('id, brand_id, title, method, page_type, prompt_ids, source_url, opportunity_id')
    .eq('id', draftId)
    .eq('brand_id', brandId)
    .maybeSingle();
  if (draftErr) throw new Error(draftErr.message);
  if (!draft) throw httpError('Draft not found', 404);

  const dedupKey = contentDraftDedupKey(draft.id);
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

  const promptIds = [...new Set(draft.prompt_ids ?? [])];
  const { data: prompts, error: promptsErr } = promptIds.length
    ? await supabaseAdmin
        .from('prompts')
        .select('id, text')
        .in('id', promptIds.slice(0, MAX_TARGETS))
    : { data: [], error: null };
  if (promptsErr) throw new Error(promptsErr.message);

  const payload = {
    source: CONTENT_DRAFT_ACTION_KIND,
    draftId: draft.id,
    opportunityId: draft.opportunity_id ?? null,
    title: draft.title || null,
    method: draft.method,
    pageType: draft.page_type ?? null,
    // Measured on the draft's page once published (basketMetrics.js); a
    // new page has its address only then.
    pages: draft.source_url ? [draft.source_url] : [],
    promptIds,
    targetEntity: 'prompts',
    targetCount: promptIds.length,
    targets: (prompts ?? []).map((p) => ({ id: p.id, label: p.text })),
    contentExists: draft.method === 'optimize',
  };

  const category = 'growth';
  const impact = 'medium';
  const { data: action, error } = await supabaseAdmin
    .from('actions')
    .insert({
      brand_id: brandId,
      category,
      kind: CONTENT_DRAFT_ACTION_KIND,
      definition_version: 1,
      impact,
      payload,
      kpi_keys: KPI_KEYS,
      baseline: {},
      dedup_key: dedupKey,
      ...(await priorityOnCreate({
        brand_id: brandId,
        kind: CONTENT_DRAFT_ACTION_KIND,
        category,
        impact,
        payload,
      })),
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
    { id: CONTENT_DRAFT_ACTION_KIND, tasks: contentDraftTasks(draft.method) },
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
      source: CONTENT_DRAFT_ACTION_KIND,
      draftId: draft.id,
      method: draft.method,
      taskCount: plan.length,
    },
  });

  // The draft remembers its action (00208), for the editor and the Library.
  const { error: linkErr } = await supabaseAdmin
    .from('content_drafts')
    .update({ action_id: action.id })
    .eq('id', draft.id);
  if (linkErr) throw new Error(linkErr.message);

  return { actionId: action.id, actionNo: Number(action.action_no), created: true };
}
