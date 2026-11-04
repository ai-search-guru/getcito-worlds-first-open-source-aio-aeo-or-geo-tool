import { Router } from 'express';
import { z } from 'zod';
import supabaseAdmin from '../config/supabase.js';
import { MANAGER_ROLES, assertBrandAccess, assertRole } from '../lib/access.js';
import { rescoreActionsForSignal } from '../lib/action-center/priorityData.js';
import { PlanLimitError, requireFeature } from '../lib/planGuard.js';
import { loadTask, sendTaskToContent, sendTaskToWebhook } from '../lib/action-center/taskSend.js';
import {
  TaskWriterError,
  isTaskWriterEnabled,
  writeTasksForAction,
} from '../lib/action-center/task-writer/index.js';
import {
  MAX_TRAFFIC_PAGES,
  TRAFFIC_PAGE_REASONS,
  sendTrafficPagesToActionCenter,
} from '../lib/action-center/fromTrafficPages.js';
import { sendContentDraftToActionCenter } from '../lib/action-center/fromContentDraft.js';
import {
  MAX_PROMPTS as MAX_PRODUCT_PROMPTS,
  PRODUCT_WORK_TYPES,
  sendProductActions,
} from '../lib/action-center/fromProducts.js';
import { sendAuditToActionCenter } from '../lib/action-center/fromAudit.js';
import {
  EXECUTION_MODES,
  chatEntitiesSchema,
  chatProposalSchema,
  findCoveringActions,
  sendChatAction,
} from '../lib/action-center/fromChat.js';
import { runTaskCheck } from '../lib/action-center/taskChecks.js';
import { taskCheckLimiter } from '../middleware/rateLimiter.js';

const router = Router();

/**
 * Scores again the active actions a signal supports, after a member moved
 * the signal (AC-007). The dashboard writes the status itself; this keeps the
 * priority in step without waiting for the night. Checked against the
 * caller's organization first, like every route on the admin client.
 *
 * @returns {Promise<{ rescored: number }>}
 */
export async function rescoreForSignal(signalId, userId) {
  const { data: signal } = await supabaseAdmin
    .from('signals')
    .select('id, brand_id')
    .eq('id', signalId)
    .maybeSingle();
  if (!signal) {
    const err = new Error('Signal not found');
    err.status = 404;
    throw err;
  }
  await assertBrandAccess(signal.brand_id, userId);
  return { rescored: await rescoreActionsForSignal(signal.id) };
}

/** Seeded ids (the demo's) aren't RFC 4122 versions, so a plain GUID shape. */
const signalIdSchema = z.guid();

/** POST /api/action-center/signals/:id/rescore */
router.post('/signals/:id/rescore', async (req, res) => {
  const id = signalIdSchema.safeParse(req.params.id);
  if (!id.success) return res.status(400).json({ error: 'Invalid signal id' });
  try {
    return res.json(await rescoreForSignal(id.data, req.user.id));
  } catch (error) {
    req.log.error({ err: error }, 'rescore actions for a signal error');
    return res.status(error.status || 500).json({
      error: error.status ? error.message : 'Failed to update the actions.',
      code: error.status ? error.code : undefined,
    });
  }
});

/** Why a rewrite wrote nothing, for logs and the API; the drawer words the code. */
const NOTHING_WRITTEN = {
  no_targets: 'This action names no page, prompt or domain to write tasks about.',
  no_valid_tasks: "The written tasks didn't pass the quality check.",
};

/**
 * Writes an action's tasks again from its evidence (AC-004), keeping the done,
 * under-way and hand-added ones. Off unless the deployment writes tasks.
 *
 * @returns {Promise<{ written: number, kept: number }>}
 */
export async function regenerateTasks(actionId, userId) {
  if (!isTaskWriterEnabled()) {
    throw new TaskWriterError('disabled', 'Writing tasks is not turned on.', 404);
  }
  const { data: action } = await supabaseAdmin
    .from('actions')
    .select('id, brand_id')
    .eq('id', actionId)
    .maybeSingle();
  if (!action) throw new TaskWriterError('not_found', 'Action not found', 404);
  await assertBrandAccess(action.brand_id, userId);

  let result;
  try {
    result = await writeTasksForAction(actionId, { trigger: 'regenerate', userId });
  } catch (err) {
    if (err instanceof PlanLimitError) {
      // No plan (the trial ended, or it was cancelled): one to choose, not a
      // budget to wait for.
      if (err.statusCode === 402) throw new TaskWriterError('plan_limit', err.message, 402);
      // The month's AI budget, shared with the Improve tab, is spent.
      throw new TaskWriterError('budget', err.message, 429);
    }
    throw err;
  }
  if (result.status !== 'written') {
    throw new TaskWriterError(result.reason, NOTHING_WRITTEN[result.reason]);
  }
  // Tasks missing an AC-010 field wait in Needs review (00293).
  return { written: result.tasks.length, kept: result.kept ?? 0, reviews: result.reviews.length };
}

/** POST /api/action-center/actions/:id/tasks/regenerate */
router.post('/actions/:id/tasks/regenerate', async (req, res) => {
  const id = signalIdSchema.safeParse(req.params.id);
  if (!id.success) return res.status(400).json({ error: 'Invalid action id' });
  try {
    return res.json(await regenerateTasks(id.data, req.user.id));
  } catch (error) {
    const status = error.status;
    if (!status) req.log.error({ err: error }, 'regenerate action tasks error');
    return res.status(status || 500).json({
      error: status ? error.message : 'Failed to write the tasks.',
      code: error.code ?? null,
    });
  }
});

/** Roles that may delete an action, as for other destructive changes. */
const DELETE_ROLES = ['admin', 'manager'];

/**
 * Deletes an action from its row menu: hidden, not removed. It becomes
 * dismissed and gets deleted_at (00168), so the lists, the API and the
 * exports leave it out, while the nightly generator still reads a dismissed
 * action and keeps its rest window: a condition that is still firing
 * doesn't bring it back the next night. Admins and managers only.
 *
 * @returns {Promise<{ deleted: true }>}
 */
export async function deleteAction(actionId, userId) {
  const { data: action } = await supabaseAdmin
    .from('actions')
    .select('id, brand_id, status, deleted_at')
    .eq('id', actionId)
    .maybeSingle();
  if (!action || action.deleted_at) {
    const err = new Error('Action not found');
    err.status = 404;
    throw err;
  }
  await assertBrandAccess(action.brand_id, userId);

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .maybeSingle();
  if (!DELETE_ROLES.includes(profile?.role)) {
    const err = new Error('Only admins and managers can delete actions.');
    err.status = 403;
    throw err;
  }

  const now = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from('actions')
    .update({ status: 'dismissed', deleted_at: now, completed_at: null, updated_at: now })
    .eq('id', actionId)
    .is('deleted_at', null);
  if (error) throw new Error(error.message);

  // The trail keeps who deleted it and from where, though nobody reads it now.
  const { error: eventErr } = await supabaseAdmin.from('action_events').insert({
    action_id: actionId,
    event: 'deleted',
    data: { from: action.status },
    actor_id: userId,
  });
  if (eventErr) throw new Error(eventErr.message);
  return { deleted: true };
}

/** DELETE /api/action-center/actions/:id */
router.delete('/actions/:id', async (req, res) => {
  const id = signalIdSchema.safeParse(req.params.id);
  if (!id.success) return res.status(400).json({ error: 'Invalid action id' });
  try {
    return res.json(await deleteAction(id.data, req.user.id));
  } catch (error) {
    if (!error.status) req.log.error({ err: error }, 'delete action error');
    return res.status(error.status || 500).json({
      error: error.status ? error.message : 'Failed to delete the action.',
      code: error.status ? error.code : undefined,
    });
  }
});

/**
 * Sends a task onward (AC-004): to Content as an opportunity, or to the
 * brand's webhook. `title` is the task's text as the dashboard shows it, for
 * a library task whose text only the dashboard renders.
 */
export async function sendTask(taskId, { to, title }, userId) {
  const loaded = await loadTask(taskId);
  await assertBrandAccess(loaded.action.brand_id, userId);
  return to === 'content'
    ? sendTaskToContent({ taskId, title, userId, loaded })
    : sendTaskToWebhook({ taskId, title, userId, loaded });
}

const sendTaskSchema = z.object({
  to: z.enum(['content', 'webhook']),
  title: z.string().max(200).optional(),
});

/** POST /api/action-center/tasks/:id/send */
router.post('/tasks/:id/send', async (req, res) => {
  const id = signalIdSchema.safeParse(req.params.id);
  const body = sendTaskSchema.safeParse(req.body ?? {});
  if (!id.success || !body.success) return res.status(400).json({ error: 'Invalid request' });
  try {
    return res.json(await sendTask(id.data, body.data, req.user.id));
  } catch (error) {
    const status = error.status;
    if (!status) req.log.error({ err: error }, 'send action task error');
    return res.status(status || 500).json({
      error: status ? error.message : 'Failed to send the task.',
      code: status ? (error.code ?? null) : null,
    });
  }
});

/**
 * Checks a task now (AC-010), as the nightly sweep does: its page fetched
 * again by what the task changes. Returns the check kept on the task, or
 * `checked: null` with why nothing was checked (runTaskCheck's reasons, and
 * 'closed' for a closed or deleted action).
 */
export async function checkTaskNow(taskId, userId) {
  const { task, action } = await loadTask(taskId);
  await assertBrandAccess(action.brand_id, userId);
  if (action.deleted_at || ['completed', 'dismissed'].includes(action.status)) {
    return { checked: null, reason: 'closed' };
  }
  const result = await runTaskCheck(task, action);
  return { checked: result.autoCheck ?? null, reason: result.reason ?? null };
}

/** POST /api/action-center/tasks/:id/check */
router.post('/tasks/:id/check', taskCheckLimiter, async (req, res) => {
  const id = signalIdSchema.safeParse(req.params.id);
  if (!id.success) return res.status(400).json({ error: 'Invalid task id' });
  try {
    return res.json(await checkTaskNow(id.data, req.user.id));
  } catch (error) {
    const status = error.status;
    if (!status) req.log.error({ err: error }, 'check action task error');
    return res.status(status || 500).json({
      error: status ? error.message : 'Failed to check the task.',
      code: status ? (error.code ?? null) : null,
    });
  }
});

const trafficPagesSchema = z.object({
  // guid, not uuid: seeded ids aren't RFC 4122 versions.
  brandId: z.guid(),
  // Paths, as the Pages section lists them.
  pages: z.array(z.string().min(1).max(2048).startsWith('/')).min(1).max(MAX_TRAFFIC_PAGES),
  reason: z.enum(TRAFFIC_PAGE_REASONS),
  // The page's range, as its loaders take it: a timestamp, or a day from a
  // custom range; absent for all time.
  from: z.union([z.iso.datetime({ offset: true }), z.iso.date()]).optional(),
  to: z.union([z.iso.datetime({ offset: true }), z.iso.date()]).optional(),
});

/**
 * POST /api/action-center/pages
 * Body: { brandId, pages, reason, from?, to? }
 *
 * "Send to Action Center" on the AI Traffic page's Pages section (AT-006):
 * pages from the Cited, not clicked or No AI traffic list as one action.
 * Sending the same pages from the same list again returns the action
 * already open.
 */
router.post('/pages', async (req, res) => {
  try {
    const parsed = trafficPagesSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.message });
    }
    const { brandId, pages, reason, from, to } = parsed.data;
    await assertBrandAccess(brandId, req.user.id);

    const result = await sendTrafficPagesToActionCenter(brandId, {
      pages,
      reason,
      from,
      to,
      userId: req.user.id,
    });
    return res.status(result.created ? 201 : 200).json(result);
  } catch (error) {
    const status = error.status || 500;
    req.log.error({ err: error }, 'traffic pages action error');
    return res.status(status).json({
      error: 'Failed to send to the Action Center',
      details: error.message,
      ...(error.code ? { code: error.code } : {}),
    });
  }
});

const auditPageSchema = z.object({
  // guid, not uuid: seeded ids aren't RFC 4122 versions.
  brandId: z.guid(),
  auditId: z.guid(),
});

/**
 * POST /api/action-center/audits
 * Body: { brandId, auditId }
 *
 * "Send to Action Center" on a Site Audit report (learning D2): the page and
 * the checks it fails as one Fix action. Sending the page again returns the
 * action already open for it; sending an older report of a page audited since
 * is refused (409 newer_audit, with latestAuditId).
 */
router.post('/audits', async (req, res) => {
  try {
    const parsed = auditPageSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.message });
    }
    const { brandId, auditId } = parsed.data;
    await assertBrandAccess(brandId, req.user.id);

    const result = await sendAuditToActionCenter(brandId, { auditId, userId: req.user.id });
    return res.status(result.created ? 201 : 200).json(result);
  } catch (error) {
    const status = error.status || 500;
    if (status >= 500) req.log.error({ err: error }, 'audit page action error');
    return res.status(status).json({
      error: 'Failed to send to the Action Center',
      details: error.message,
      ...(error.code ? { code: error.code } : {}),
      // newer_audit: the page's latest audit, to open instead.
      ...(error.extra ?? {}),
    });
  }
});

const contentDraftSchema = z.object({
  // guid, not uuid: seeded ids aren't RFC 4122 versions.
  brandId: z.guid(),
  draftId: z.guid(),
});

/**
 * POST /api/action-center/content-drafts
 * Body: { brandId, draftId }
 *
 * "Team" in the Content Editor's Start (CE-015): the draft sent as an action
 * for someone on the team to write. Sending it again returns the action
 * already open.
 */
router.post('/content-drafts', async (req, res) => {
  try {
    const parsed = contentDraftSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.message });
    }
    const { brandId, draftId } = parsed.data;
    await assertBrandAccess(brandId, req.user.id);
    const result = await sendContentDraftToActionCenter(brandId, {
      draftId,
      userId: req.user.id,
    });
    return res.status(result.created ? 201 : 200).json(result);
  } catch (error) {
    const status = error.status || 500;
    req.log.error({ err: error }, 'content draft action error');
    return res.status(status).json({
      error: 'Failed to send to the Action Center',
      details: error.message,
      ...(error.code ? { code: error.code } : {}),
    });
  }
});

const productActionsSchema = z.object({
  // guid, not uuid: seeded ids aren't RFC 4122 versions.
  brandId: z.guid(),
  target: z.object({ type: z.enum(['product', 'category']), id: z.guid() }),
  work: z
    .array(
      z.object({
        type: z.enum(PRODUCT_WORK_TYPES),
        who: z.enum(['me', 'agent']),
        why: z.string().trim().max(500).optional(),
      }),
    )
    .min(1)
    .max(PRODUCT_WORK_TYPES.length * 2),
  promptIds: z.array(z.guid()).max(MAX_PRODUCT_PROMPTS).default([]),
});

/**
 * POST /api/action-center/products
 * Body: { brandId, target: { type, id }, work: [{ type, who, why? }], promptIds }
 *
 * "Send to Action Center" on Product Visibility (ECOM-013): a product, or a
 * category, with the work that gets it on the AI shelf. Sending the same
 * product or category again returns the action already open. Product
 * Visibility's plans only (shopping_analytics), as its page.
 */
router.post('/products', requireFeature('shopping_analytics'), async (req, res) => {
  try {
    const parsed = productActionsSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.message });
    }
    const { brandId, target, work, promptIds } = parsed.data;
    await assertBrandAccess(brandId, req.user.id);
    const result = await sendProductActions(brandId, {
      target,
      work,
      promptIds,
      userId: req.user.id,
    });
    return res.status(result.created ? 201 : 200).json(result);
  } catch (error) {
    const status = error.status || 500;
    req.log.error({ err: error }, 'product actions error');
    return res.status(status).json({
      error: 'Failed to send to the Action Center',
      details: error.message,
      ...(error.code ? { code: error.code } : {}),
    });
  }
});

/** Who may send a finding from Chat: the roles that write Action Center (CHAT-20 §9 row 43). */
const CHAT_ACTION_REFUSAL = 'Only admins and managers can send findings to the Action Center.';

const chatCheckSchema = z.object({
  // guid, not uuid: seeded ids aren't RFC 4122 versions.
  brandId: z.guid(),
  entities: chatEntitiesSchema,
  category: chatProposalSchema.shape.category.optional(),
});

/**
 * POST /api/action-center/chat-actions/check
 * Body: { brandId, entities: { prompts, pages, competitors, platforms }, category? }
 *
 * Chat's duplicate check (CHAT-09 §E 18a, Data and API notes): the brand's
 * active actions that already cover these prompts, pages or competitors,
 * the closest first, before Chat shows a Send to Action Center card.
 * Reads only.
 */
router.post('/chat-actions/check', async (req, res) => {
  try {
    const parsed = chatCheckSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: 'Invalid request', details: parsed.error.message, code: 'invalid' });
    }
    const { brandId, entities, category } = parsed.data;
    await assertBrandAccess(brandId, req.user.id);
    await assertRole(req.user.id, MANAGER_ROLES, CHAT_ACTION_REFUSAL);
    const { covering } = await findCoveringActions(brandId, entities, { category });
    return res.json({ covering });
  } catch (error) {
    const status = error.status || 500;
    if (status >= 500) req.log.error({ err: error }, 'chat action check error');
    return res.status(status).json({
      error: 'Failed to check the Action Center',
      details: error.message,
      ...(error.code ? { code: error.code } : {}),
    });
  }
});

const chatActionSchema = z.object({
  brandId: z.guid(),
  proposal: chatProposalSchema,
  conversationId: z.guid().nullable().optional(),
  runId: z.guid().nullable().optional(),
  // Read again on the server (fromChat.js verifiedPlace): a caller's word is never recorded.
  executionMode: z.enum(EXECUTION_MODES).nullable().default(null),
  idempotencyKey: z.string().trim().min(8).max(200),
  createAnyway: z.boolean().default(false),
});

/**
 * POST /api/action-center/chat-actions
 * Body: { brandId, proposal, conversationId?, runId?, executionMode?, idempotencyKey, createAnyway? }
 *
 * Send to Action Center from Chat (CHAT-09 §E, CHAT-20 §12): the action the
 * person approved, with source `chat`, frozen targets and baseline, and the
 * engine's Priority Score. An active action that covers it answers 409
 * `duplicate` with that action and whether Create anyway may still go
 * (entities differ); the same idempotency key again returns what it made.
 */
router.post('/chat-actions', async (req, res) => {
  try {
    const parsed = chatActionSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: 'Invalid request', details: parsed.error.message, code: 'invalid' });
    }
    const { brandId, ...opts } = parsed.data;
    await assertBrandAccess(brandId, req.user.id);
    await assertRole(req.user.id, MANAGER_ROLES, CHAT_ACTION_REFUSAL);
    const result = await sendChatAction(brandId, { ...opts, userId: req.user.id });
    return res.status(result.created ? 201 : 200).json(result);
  } catch (error) {
    const status = error.status || 500;
    if (status >= 500) req.log.error({ err: error }, 'chat action error');
    return res.status(status).json({
      error: 'Failed to send to the Action Center',
      details: error.message,
      ...(error.code ? { code: error.code } : {}),
      // duplicate: the action that covers it, and whether Create anyway may go.
      ...(error.extra ?? {}),
    });
  }
});

export default router;
