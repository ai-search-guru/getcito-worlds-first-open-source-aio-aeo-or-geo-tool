/**
 * Chat's model steps on the AI budget (lib/chatBudget.js), for the web's
 * Chat engine (frontend/src/lib/chat/budget.ts). Server to server: CRON_SECRET
 * auth, as the other internal endpoints; the web passes the workspace it
 * checked the person against.
 *
 * POST /api/internal/chat/budget/reserve
 *   { orgId, runId, stepId?, feature?, model, inputTokens, maxOutputTokens, ownKey?, agentRunId?,
 *     scheduleId? }
 *   → 201 { usageId }: the step's row, its worst case held (on GetCito's key),
 *     named with the chat's agent run and scheduled job (reserve_chat_ai_usage
 *     finds both from the run's chat, and refuses a scheduleId or an
 *     agentRunId that isn't the chat's).
 *   → 429 ai_limit { trial }: the budget can't cover the step; it doesn't start.
 *   → 429 run_cap: the chat's agent run (agentRunId) can't take the step
 *     within its own cap (CHAT-27 item 21); it doesn't start.
 *   → 402 plan_limit: no active plan. 404 not_found: the run isn't the
 *     workspace's. 403 chat_off: Chat is off for the workspace.
 * POST /api/internal/chat/budget/charge
 *   { orgId, usageId, model, usage: { inputTokens, outputTokens, cacheReadTokens?,
 *     cacheWriteTokens? }, latencyMs? }
 *   → 200: the row holds the step's real cost, its prompt cache's reads and
 *     writes priced at their own rates. 404 when it is gone.
 * POST /api/internal/chat/budget/release { orgId, usageId }
 *   → 200: the hold went (nothing was billed). Safe to repeat.
 * POST /api/internal/chat/budget/fit
 *   { orgId, model, perUnit: { inputTokens, maxOutputTokens }, units, ownKey?, agentRunId? }
 *   → 200 { fits, limit }: how many of the job's `units` like parts (1–100)
 *     the AI budget left covers, each one model step's worst case, before the
 *     job starts (CHAT-04 item 17a); all of them on the workspace's own key.
 *     `limit` is the one that binds: 'run' (the agent run's cap) or 'month'.
 *     Holds nothing. 402 plan_limit, 403 chat_off, 404 not_found (an agent
 *     run that isn't the workspace's).
 * A step a Stop aborted calls neither: its hold stays as its cost.
 * GET /api/internal/chat/budget/agent-shares?orgId=&days=
 *   → 200 { unlimited, since, shares: [{ agentId, share, ownKeyShare, runs }] }:
 *     each agent's share of the AI limit this period, or over the last
 *     `days` (1–90), for the Agents list and detail (CHAT-27 items 24–30).
 *   → 402 plan_limit: no active plan. 403 chat_off.
 * GET /api/internal/chat/budget/run-estimate?orgId=
 *   → 200 { unlimited, share, runs }: about how much of the AI limit one Chat
 *     run uses, from the last 30 days' runs (null with none), for the
 *     schedule card (CHAT-12 item 7).
 *   → 402 plan_limit: no active plan. 403 chat_off.
 * GET /api/internal/chat/budget/own-key?orgId=
 *   → 200 { reached, usedUsd, capUsd, since, renewsAt }: the key guard
 *     (AGENT-OWN-KEY §4.2): what all agents spent on the workspace's own key
 *     this AI period against the Admin's monthly limit. 403 chat_off.
 *     Each read also warns the Admins at 80% and at the limit, once each
 *     a period (lib/chat-notices/ownKeyLimit.js), off the answer's path.
 *
 * Dollars leave the server only in the own-key answer, for the Admins'
 * settings card (AGENT-OWN-KEY §11 Q1): the agent checks read `reached`. Calls with the
 * secret aren't counted by the API's per-IP limiter (isInternalChatBudgetCall
 * in middleware/rateLimiter.js): each step makes two, from the web's few
 * shared addresses.
 */

import { Router } from 'express';
import { z } from 'zod';
import {
  CHAT_BUDGET_FEATURES,
  ChatBudgetError,
  MAX_FIT_UNITS,
  agentUsageShares,
  chargeChatStep,
  chatRunEstimate,
  fitChatUnits,
  ownKeyAgentSpend,
  releaseChatStep,
  reserveChatStep,
} from '../lib/chatBudget.js';
import { warnOwnKeyLimit } from '../lib/chat-notices/ownKeyLimit.js';
import { PlanLimitError } from '../lib/planGuard.js';
import { webhookSecretsMatch } from '../lib/webhookSecret.js';

const router = Router();

// The secret is compared in constant time (webhookSecretsMatch), as the rate limiter does.
router.use((req, res, next) => {
  const auth = req.headers.authorization;
  const secret = typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!webhookSecretsMatch(process.env.CRON_SECRET, secret)) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
  return next();
});

/** Token counts as the AI SDK reports them, capped well past any model's window. */
const tokens = z.number().int().min(0).max(10_000_000);
const model = z.string().trim().min(1).max(200);

const reserveSchema = z.strictObject({
  orgId: z.guid(),
  runId: z.guid(),
  stepId: z.guid().nullish(),
  feature: z.enum(CHAT_BUDGET_FEATURES).default('chat'),
  model,
  inputTokens: tokens,
  maxOutputTokens: tokens.min(1),
  ownKey: z.boolean().default(false),
  // The chat's agent run: the step is held within its cap too (CHAT-27 item 21).
  agentRunId: z.guid().nullish(),
  // The chat's scheduled job (CHAT-12 item 14): its row is named with the job.
  scheduleId: z.guid().nullish(),
});

const chargeSchema = z.strictObject({
  orgId: z.guid(),
  usageId: z.guid(),
  model,
  usage: z.strictObject({
    inputTokens: tokens.optional(),
    outputTokens: tokens.optional(),
    // Of the input tokens, those read from and written to the prompt cache.
    cacheReadTokens: tokens.optional(),
    cacheWriteTokens: tokens.optional(),
  }),
  // How long the model call took, for staff; an hour at most.
  latencyMs: z.number().int().min(0).max(3_600_000).optional(),
});

const releaseSchema = z.strictObject({ orgId: z.guid(), usageId: z.guid() });

const fitSchema = z.strictObject({
  orgId: z.guid(),
  model,
  // One part's model step: its prompt and the most it may write.
  perUnit: z.strictObject({ inputTokens: tokens, maxOutputTokens: tokens.min(1) }),
  units: z.number().int().min(1).max(MAX_FIT_UNITS),
  ownKey: z.boolean().default(false),
  agentRunId: z.guid().nullish(),
});

const sharesSchema = z.strictObject({
  orgId: z.guid(),
  days: z.coerce.number().int().min(1).max(90).optional(),
});

const estimateSchema = z.strictObject({ orgId: z.guid() });
const ownKeySchema = z.strictObject({ orgId: z.guid() });

/** The body as `schema` reads it, or null once a 400 is sent. */
function parse(schema, req, res) {
  const parsed = schema.safeParse(req.body ?? {});
  if (parsed.success) return parsed.data;
  res.status(400).json({ success: false, error: 'invalid_request', message: 'Invalid request' });
  return null;
}

function fail(err, req, res, what) {
  if (err instanceof ChatBudgetError) {
    return res
      .status(err.statusCode)
      .json({ success: false, error: err.code, message: err.message });
  }
  if (err instanceof PlanLimitError) {
    // 429: the budget is used up (in the free trial, the trial's); 402: no active plan.
    return err.statusCode === 429
      ? res.status(429).json({
          success: false,
          error: 'ai_limit',
          trial: err.trial === true,
          message: err.message,
        })
      : res
          .status(err.statusCode)
          .json({ success: false, error: 'plan_limit', message: err.message });
  }
  req.log.error({ err }, `internal chat budget ${what} error`);
  return res.status(500).json({ success: false, message: 'Internal error' });
}

router.post('/reserve', async (req, res) => {
  const body = parse(reserveSchema, req, res);
  if (!body) return undefined;
  try {
    const usageId = await reserveChatStep(body.orgId, {
      feature: body.feature,
      modelId: body.model,
      inputTokens: body.inputTokens,
      maxOutputTokens: body.maxOutputTokens,
      runId: body.runId,
      stepId: body.stepId ?? null,
      ownKey: body.ownKey,
      agentRunId: body.agentRunId ?? null,
      scheduleId: body.scheduleId ?? null,
    });
    return res.status(201).json({ success: true, usageId });
  } catch (err) {
    return fail(err, req, res, 'reserve');
  }
});

router.post('/charge', async (req, res) => {
  const body = parse(chargeSchema, req, res);
  if (!body) return undefined;
  try {
    await chargeChatStep(body.orgId, body.usageId, {
      modelId: body.model,
      usage: body.usage,
      latencyMs: body.latencyMs,
    });
    return res.json({ success: true });
  } catch (err) {
    return fail(err, req, res, 'charge');
  }
});

router.post('/release', async (req, res) => {
  const body = parse(releaseSchema, req, res);
  if (!body) return undefined;
  try {
    await releaseChatStep(body.orgId, body.usageId);
    return res.json({ success: true });
  } catch (err) {
    return fail(err, req, res, 'release');
  }
});

router.post('/fit', async (req, res) => {
  const body = parse(fitSchema, req, res);
  if (!body) return undefined;
  try {
    const { fits, limit } = await fitChatUnits(body.orgId, {
      modelId: body.model,
      perUnit: body.perUnit,
      units: body.units,
      ownKey: body.ownKey,
      agentRunId: body.agentRunId ?? null,
    });
    return res.json({ success: true, fits, limit });
  } catch (err) {
    return fail(err, req, res, 'fit');
  }
});

router.get('/agent-shares', async (req, res) => {
  const query = sharesSchema.safeParse(req.query ?? {});
  if (!query.success) {
    return res
      .status(400)
      .json({ success: false, error: 'invalid_request', message: 'Invalid request' });
  }
  try {
    const shares = await agentUsageShares(query.data.orgId, { days: query.data.days ?? null });
    return res.json({ success: true, ...shares });
  } catch (err) {
    return fail(err, req, res, 'agent shares');
  }
});

router.get('/run-estimate', async (req, res) => {
  const query = estimateSchema.safeParse(req.query ?? {});
  if (!query.success) {
    return res
      .status(400)
      .json({ success: false, error: 'invalid_request', message: 'Invalid request' });
  }
  try {
    const estimate = await chatRunEstimate(query.data.orgId);
    return res.json({ success: true, ...estimate });
  } catch (err) {
    return fail(err, req, res, 'run estimate');
  }
});

router.get('/own-key', async (req, res) => {
  const query = ownKeySchema.safeParse(req.query ?? {});
  if (!query.success) {
    return res
      .status(400)
      .json({ success: false, error: 'invalid_request', message: 'Invalid request' });
  }
  try {
    const spend = await ownKeyAgentSpend(query.data.orgId);
    warnOwnKeyLimit(query.data.orgId, spend).catch((err) =>
      req.log.error({ err }, 'own key limit warning failed'),
    );
    return res.json({ success: true, ...spend });
  } catch (err) {
    return fail(err, req, res, 'own key spend');
  }
});

export default router;
