/**
 * The task writer (AC-004): an action's tasks written from its evidence.
 *
 * A library plan gives "Refresh content for 7 prompts". This reads the
 * pages, prompts, domains and competitors the action's signals name
 * (evidence.js), asks a model for at most six tasks — one per target, each
 * saying where, why, how and when it is done — keeps only the ones that pass
 * the quality rule (quality.js), asks once more for replacements of the rest,
 * and writes them in place of the template tasks.
 *
 * Off unless ACTION_TASKS_AI=true: product reviews a sample of written tasks
 * (scripts/reviewActionTasks.js) before any brand gets them. Metered like
 * the Improve tab, from the same monthly budget. A night that cannot write
 * an action's tasks — the budget is spent, the model failed — leaves its
 * template tasks, and the next sweep tries again.
 */

import { NoObjectGeneratedError, generateObject } from 'ai';
import supabaseAdmin from '../../../config/supabase.js';
import { isCloud } from '../../../config/plans.js';
import { ACTIVE_SUBSCRIPTION_STATUSES } from '../../activeSubscriptions.js';
import { logger } from '../../logger.js';
import { resolveModel } from '../../aiProvider.js';
import { withRetry } from '../../retry.js';
import { generationCostUsd } from '../../improveCost.js';
import { PlanLimitError, reserveAiBudget } from '../../planGuard.js';
import { siteTypeOf } from '../../contentPageTypes.js';
import { loadDefinitions } from '../definitions/index.js';
import { getTask } from '../tasks/registry.js';
import { IMPROVE_ACTION_KIND } from '../fromPromptImprove.js';
import { OPPORTUNITY_ACTION_KIND } from '../fromOpportunity.js';
import { buildEvidence, evidenceForPrompt, hasTargets } from './evidence.js';
import { loadPastRounds } from './history.js';
import {
  MAX_TASKS,
  TASK_CHECKS,
  onlyGaps,
  pageAddress,
  sameTask,
  taskGaps,
  taskProblems,
} from './quality.js';
import { buildRetryPrompt, buildTaskWriterPrompt, taskWriterSchema } from './prompt.js';

/** Whether this deployment writes tasks at all. */
export function isTaskWriterEnabled() {
  return process.env.ACTION_TASKS_AI === 'true';
}

/** The model, as the Improve tab's unless set apart. */
export function taskWriterModelId() {
  return (
    process.env.ACTION_TASKS_MODEL ||
    process.env.IMPROVE_SUGGESTION_MODEL ||
    process.env.DEFAULT_SUGGESTION_MODEL ||
    'google/gemini-3-flash-preview'
  );
}

/** Actions a person sent carry the tasks they were sent with. */
const SENT_KINDS = new Set([IMPROVE_ACTION_KIND, OPPORTUNITY_ACTION_KIND]);
const CLOSED = new Set(['completed', 'dismissed']);

/**
 * How long one model call may take. Two calls (the second for refused
 * tasks), each tried twice, stay inside the dashboard's 200 s wait.
 */
const CALL_TIMEOUT_MS = 40_000;

/** A claim older than this is a writer that died; another may take over. */
const CLAIM_TTL_MS = 5 * 60 * 1000;

/**
 * Analysis the product does itself: what the library plans as system work or
 * names as analysis, legacy keys included. Never kept on a rewrite, done or
 * not — its result is in the Affected tab, not on anyone's list.
 */
const ANALYSIS_KEY =
  /^(?:analy|identify|validate|revalidate|measure|review|compare|diagnose|coverage|map_|cluster|prioritize|define|competitor_pressure|page_readiness)/;

export function isAnalysisTask(row) {
  if (!row.task_key) return false;
  return getTask(row.task_key)?.mode === 'system' || ANALYSIS_KEY.test(row.task_key);
}

/**
 * Whether a rewrite keeps a task: one done or under way, one sent to Content
 * or a webhook, and one a person added — no template, not written by the
 * model. Everything else is replaced.
 */
export function keepsTask(row) {
  if (isAnalysisTask(row)) return false;
  // Sent to Content or a webhook: the work has left the list's hands.
  if (row.details?.sent) return true;
  if (row.status === 'completed' || row.status === 'in_progress') return true;
  return !row.task_key && row.details?.source !== 'ai';
}

/**
 * Why a rewrite was refused or wrote nothing. `code` is what the dashboard
 * words in the reader's language; `message` is for logs and the API.
 */
export class TaskWriterError extends Error {
  constructor(code, message, status = 422) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/** What the writer needs: the action, its brand, its signals. */
async function loadAction(actionId) {
  const { data: action, error } = await supabaseAdmin
    .from('actions')
    .select('id, brand_id, kind, category, status, payload')
    .eq('id', actionId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!action) throw new TaskWriterError('not_found', 'Action not found', 404);

  const [brandRes, domainsRes, signalsRes, definitions] = await Promise.all([
    supabaseAdmin
      .from('brands')
      .select('id, name, description, organization_id, site_type, industry, shopping_mode_enabled')
      .eq('id', action.brand_id)
      .single(),
    supabaseAdmin.from('brand_domains').select('domain').eq('brand_id', action.brand_id),
    supabaseAdmin
      .from('signals')
      .select('id, kind, status, payload, action_id, action_signals!inner(action_id)')
      .eq('brand_id', action.brand_id)
      .eq('action_signals.action_id', actionId),
    loadDefinitions(),
  ]);
  if (brandRes.error) throw new Error(brandRes.error.message);
  if (signalsRes.error) throw new Error(signalsRes.error.message);

  // The signals that support it now (AC-007); all it took once none do.
  const all = signalsRes.data ?? [];
  const supporting = all.filter(
    (s) => ['new', 'acknowledged'].includes(s.status) && s.action_id === actionId,
  );
  const definition = definitions.find((d) => d.id === action.kind);
  return {
    action,
    brand: brandRes.data,
    domains: (domainsRes.data ?? []).map((row) => row.domain),
    signals: supporting.length > 0 ? supporting : all,
    name: definition?.name ?? action.kind,
  };
}

/**
 * One model call, charged at its real cost on every attempt — the ones the
 * retry repeats after a schema miss included — unless it is a dry run.
 */
async function callModel({ modelId, system, prompt, charge }) {
  const { object } = await withRetry(
    async () => {
      try {
        const result = await generateObject({
          model: resolveModel(modelId),
          schema: taskWriterSchema,
          system,
          prompt,
          abortSignal: AbortSignal.timeout(CALL_TIMEOUT_MS),
        });
        await charge(result.usage);
        return result;
      } catch (err) {
        if (NoObjectGeneratedError.isInstance(err) && err.usage) await charge(err.usage);
        throw err;
      }
    },
    { attempts: 2, baseDelayMs: 500, label: 'action-task-writer' },
  );
  return object.tasks ?? [];
}

/** Sorts a batch into the tasks kept and the ones refused, with why. */
function sift(tasks, evidence, kept) {
  const accepted = [...kept];
  const refused = [];
  for (const task of tasks) {
    const problems = taskProblems(task, evidence);
    if (problems.length === 0 && accepted.some((other) => sameTask(other, task))) {
      problems.push('it repeats another task');
    }
    if (problems.length === 0 && accepted.length < MAX_TASKS) accepted.push(task);
    else if (problems.length > 0) refused.push({ task, problems });
  }
  return { accepted: accepted.slice(kept.length), refused };
}

/**
 * Whether anyone has worked on the action's tasks: moved one on, added one,
 * renamed, edited or sent one. The night writes only untouched plans; a
 * person rewrites theirs with "Regenerate tasks". A library task's details
 * from its template (AC-010, tasks/templates.js) aren't anyone's work; an
 * edit in the drawer drops their mark.
 */
export function isTouched(rows) {
  return rows.some(
    (row) =>
      row.status !== 'todo' ||
      (!row.task_key && row.details?.source !== 'ai') ||
      (row.task_key &&
        (row.title || (row.details && (row.details.source !== 'template' || row.details.sent)))),
  );
}

/** Take the action for this writer, or say another writer has it. */
async function claim(actionId, now) {
  const stale = new Date(now.getTime() - CLAIM_TTL_MS).toISOString();
  const { data, error } = await supabaseAdmin
    .from('actions')
    .update({ tasks_writing_since: now.toISOString() })
    .eq('id', actionId)
    .or(`tasks_writing_since.is.null,tasks_writing_since.lt.${stale}`)
    .select('id');
  if (error) throw new Error(error.message);
  if (!data?.length) {
    throw new TaskWriterError('busy', 'Tasks for this action are already being written.', 409);
  }
}

async function release(actionId) {
  const { error } = await supabaseAdmin
    .from('actions')
    .update({ tasks_writing_since: null })
    .eq('id', actionId);
  if (error) logger.error({ err: error, actionId }, '[task-writer] could not release the claim');
}

/**
 * Write an action's tasks from its evidence.
 *
 * @param {string} actionId
 * @param {{ trigger?: 'auto' | 'regenerate' | 'review', userId?: string | null,
 *   dryRun?: boolean, now?: Date }} [options] a dry run writes and charges
 *   nothing: it returns what it would write, for the review script.
 * @returns {Promise<{ status: 'written' | 'skipped' | 'preview', reason?: string,
 *   tasks?: object[], refused?: object[], kept?: number, costUsd: number, evidence?: object }>}
 */
export async function writeTasksForAction(
  actionId,
  { trigger = 'auto', userId = null, dryRun = false, now = new Date() } = {},
) {
  const { action, brand, domains, signals, name } = await loadAction(actionId);
  if (SENT_KINDS.has(action.kind)) {
    throw new TaskWriterError('sent', 'This action carries the tasks it was sent with.');
  }
  if (CLOSED.has(action.status)) throw new TaskWriterError('closed', 'This action is closed.');
  if (dryRun) return compose({ action, brand, domains, signals, name, dryRun, now });

  await claim(actionId, now);
  try {
    return await compose({ action, brand, domains, signals, name, trigger, userId, now });
  } finally {
    await release(actionId);
  }
}

/** The writing itself, once the action is this writer's. */
async function compose({ action, brand, domains, signals, name, trigger, userId, dryRun, now }) {
  const actionId = action.id;
  if (!dryRun && trigger === 'auto') {
    // The night leaves alone a plan someone is already working through.
    const { data: rows, error } = await supabaseAdmin
      .from('action_tasks')
      .select('task_key, title, status, details')
      .eq('action_id', actionId);
    if (error) throw new Error(error.message);
    if (isTouched(rows ?? [])) {
      await markWritten(actionId, now);
      return { status: 'skipped', reason: 'in_use', costUsd: 0 };
    }
  }

  const evidence = buildEvidence(signals, { domains });
  if (!hasTargets(evidence)) {
    if (!dryRun) await markWritten(actionId, now);
    return { status: 'skipped', reason: 'no_targets', costUsd: 0 };
  }

  const modelId = taskWriterModelId();
  // Held on the budget before the first call, so actions written at once
  // (a sweep, a regenerate) can't pass it. A dry run charges nothing.
  const budget = dryRun
    ? null
    : await reserveAiBudget(brand.organization_id, {
        feature: 'action_center',
        modelId,
        actionId,
      });
  try {
    let costUsd = 0;
    const charge = async (usage) => {
      costUsd += generationCostUsd(modelId, usage);
      await budget?.charge(usage);
    };

    const shown = evidenceForPrompt(evidence);
    // Its earlier rounds here (learning B5), the product's own analysis steps
    // left out. Without them it is still written, as before.
    let history = [];
    try {
      history = await loadPastRounds(action, { skip: isAnalysisTask });
    } catch (err) {
      logger.warn({ actionId, err: err.message }, '[task-writer] past rounds unavailable');
    }
    const base = buildTaskWriterPrompt({
      action: { name, category: action.category },
      brand: {
        name: brand.name,
        description: brand.description,
        domains,
        // The kind of site, chosen, detected or guessed: tasks speak its language.
        siteType: siteTypeOf({
          siteType: brand.site_type,
          industry: brand.industry,
          shoppingModeEnabled: brand.shopping_mode_enabled,
        }),
      },
      evidence: shown,
      history,
    });
    const first = sift(await callModel({ modelId, ...base, charge }), evidence, []);
    let tasks = first.accepted;
    let refused = first.refused;
    // The refusals of the last round asked: the first round's were asked for again.
    let lastRefused = first.refused;

    // Refused tasks come back once, with their reasons.
    const missing = Math.min(refused.length, MAX_TASKS - tasks.length);
    if (missing > 0) {
      const retry = buildRetryPrompt({ base, kept: tasks, refused, count: missing });
      const second = sift(await callModel({ modelId, ...retry, charge }), evidence, tasks);
      tasks = [...tasks, ...second.accepted];
      // Both rounds' refusals, so a review sees how often the first answer misses.
      refused = [...refused, ...second.refused];
      lastRefused = second.refused;
    }

    // AC-010: a task the last round refused only for the fields it misses
    // (the exact page, the change, Done when, how it's checked) waits for an
    // admin or a manager to fill them, up to the action's MAX_TASKS.
    const reviews = [];
    for (const { task, problems } of lastRefused) {
      if (tasks.length + reviews.length >= MAX_TASKS) break;
      if (!onlyGaps(problems) || [...tasks, ...reviews].some((t) => sameTask(t, task))) continue;
      reviews.push(task);
    }

    if (dryRun) {
      return { status: 'preview', tasks, reviews, refused, costUsd, evidence: shown, history };
    }
    if (tasks.length === 0 && reviews.length === 0) {
      await markWritten(actionId, now);
      return { status: 'skipped', reason: 'no_valid_tasks', refused, costUsd };
    }

    // The reviews first: a failure there leaves the tasks as they were. None
    // to show yet: the template tasks stay, and the reviews wait.
    await replaceReviews(actionId, reviews);
    const kept = tasks.length > 0 ? await replaceTasks(actionId, tasks, { now }) : null;
    await markWritten(actionId, now, { changed: tasks.length > 0 });
    await supabaseAdmin.from('action_events').insert({
      action_id: actionId,
      event: 'tasks_generated',
      data: { count: tasks.length, kept, trigger, reviews: reviews.length },
      actor_id: userId,
    });
    return { status: 'written', tasks, reviews, refused, kept, costUsd };
  } finally {
    // Nothing charged (the first call failed): the hold goes.
    await budget?.release();
  }
}

const text = (value) => (typeof value === 'string' ? value.trim() : '');

/** A written task's details as stored (AC-004, AC-010); a field it misses is null. */
function detailsOf(task) {
  const after = text(task.change?.after);
  const check = text(task.check).toLowerCase();
  return {
    url: pageAddress(task.url),
    where: text(task.where),
    why: text(task.why),
    change: after ? { before: text(task.change.before) || null, after } : null,
    how: (task.how ?? []).map(text).filter(Boolean),
    doneWhen: text(task.doneWhen) || null,
    check: TASK_CHECKS.includes(check) ? check : null,
    type: task.type,
    effort: text(task.effort),
    role: text(task.role),
    source: 'ai',
    refs: task.refs,
  };
}

/**
 * The action's tasks waiting for review (AC-010, 00293) in place of the ones
 * an earlier writing left: a new writing is the one to review.
 */
async function replaceReviews(actionId, reviews) {
  const { error: deleteError } = await supabaseAdmin
    .from('action_task_reviews')
    .delete()
    .eq('action_id', actionId)
    .eq('source', 'ai');
  if (deleteError) throw new Error(deleteError.message);
  if (reviews.length === 0) return;
  const { error } = await supabaseAdmin.from('action_task_reviews').insert(
    reviews.map((task) => ({
      action_id: actionId,
      title: task.title.trim(),
      details: detailsOf(task),
      missing: taskGaps(task),
      source: 'ai',
    })),
  );
  if (error) throw new Error(error.message);
}

/** Record the writing; the action counts as updated only when its tasks changed. */
async function markWritten(actionId, now, { changed = false } = {}) {
  const { error } = await supabaseAdmin
    .from('actions')
    .update({
      tasks_generated_at: now.toISOString(),
      ...(changed ? { updated_at: now.toISOString() } : {}),
    })
    .eq('id', actionId);
  if (error) throw new Error(error.message);
}

/**
 * Put the written tasks in place of the replaced ones. The new rows go in
 * first, numbered after everything, so a failure halfway leaves the old list
 * whole rather than a gap; then the replaced ones go and the rest are
 * numbered again, kept tasks first in their order.
 *
 * @returns {Promise<number>} how many tasks were kept
 */
export async function replaceTasks(actionId, tasks, { now = new Date() } = {}) {
  const { data: rows, error } = await supabaseAdmin
    .from('action_tasks')
    .select('id, position, task_key, status, details')
    .eq('action_id', actionId)
    .order('position');
  if (error) throw new Error(error.message);
  const existing = rows ?? [];
  const kept = existing.filter(keepsTask);
  const replaced = existing.filter((row) => !keepsTask(row));
  const offset = existing.reduce((max, row) => Math.max(max, row.position), 0);

  const { data: inserted, error: insertError } = await supabaseAdmin
    .from('action_tasks')
    .insert(
      tasks.map((task, i) => ({
        action_id: actionId,
        position: offset + i + 1,
        task_key: null,
        title: task.title.trim(),
        mode: 'human',
        permission: 'read',
        details: detailsOf(task),
      })),
    )
    .select('id, position');
  if (insertError) throw new Error(insertError.message);

  if (replaced.length > 0) {
    const { error: deleteError } = await supabaseAdmin
      .from('action_tasks')
      .delete()
      .in(
        'id',
        replaced.map((row) => row.id),
      );
    if (deleteError) throw new Error(deleteError.message);
  }

  const order = [...kept, ...[...(inserted ?? [])].sort((a, b) => a.position - b.position)];
  for (const [i, row] of order.entries()) {
    if (row.position === i + 1) continue;
    const { error: moveError } = await supabaseAdmin
      .from('action_tasks')
      .update({ position: i + 1, updated_at: now.toISOString() })
      .eq('id', row.id);
    if (moveError) throw new Error(moveError.message);
  }
  return kept.length;
}

/** The nightly sweep's reach: actions raised in the last three days. */
const SWEEP_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
/** Actions one sweep writes, so a night's model spend has a ceiling. */
const SWEEP_LIMIT = 20;

/**
 * Write the tasks of recent actions that have none written yet. Runs after
 * a brand's signal pass and once a day for the ones it missed. An
 * organization whose budget is spent is skipped for the rest of the sweep.
 * On the cloud, only for organizations still on a plan (2026-10-27):
 * filtered in the query, so the actions of one whose plan ended can't take
 * the sweep's places, each one only to be refused its budget.
 *
 * @param {{ brandId?: string, now?: Date, limit?: number }} [options]
 */
export async function sweepActionTasks({ brandId, now = new Date(), limit = SWEEP_LIMIT } = {}) {
  if (!isTaskWriterEnabled()) return { skipped: 'disabled' };
  // Never a demo brand's actions (00380): they are sample data.
  let query = supabaseAdmin.from('actions');
  query = isCloud()
    ? query
        .select(
          'id, brand_id, kind, status, brands!inner(is_demo, organizations!inner(subscription_status))',
        )
        .in('brands.organizations.subscription_status', ACTIVE_SUBSCRIPTION_STATUSES)
    : query.select('id, brand_id, kind, status, brands!inner(is_demo)');
  query = query
    .eq('brands.is_demo', false)
    .is('tasks_generated_at', null)
    .gte('created_at', new Date(now.getTime() - SWEEP_WINDOW_MS).toISOString())
    .not('status', 'in', '("completed","dismissed")')
    .not('kind', 'in', `("${IMPROVE_ACTION_KIND}","${OPPORTUNITY_ACTION_KIND}")`)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (brandId) query = query.eq('brand_id', brandId);
  const { data: actions, error } = await query;
  if (error) throw new Error(error.message);

  const spent = new Set();
  const outcome = { written: 0, skipped: 0, failed: 0 };
  for (const action of actions ?? []) {
    if (spent.has(action.brand_id)) continue;
    try {
      const result = await writeTasksForAction(action.id, { trigger: 'auto', now });
      if (result.status === 'written') outcome.written += 1;
      else outcome.skipped += 1;
    } catch (err) {
      if (err instanceof PlanLimitError) {
        spent.add(action.brand_id);
      } else if (err instanceof TaskWriterError && err.code === 'busy') {
        // Another writer has it — a person's Regenerate, most likely.
      } else {
        logger.warn({ err, actionId: action.id }, '[task-writer] could not write tasks');
      }
      outcome.failed += 1;
    }
  }
  logger.info({ brandId, ...outcome }, '[task-writer] sweep');
  return outcome;
}
