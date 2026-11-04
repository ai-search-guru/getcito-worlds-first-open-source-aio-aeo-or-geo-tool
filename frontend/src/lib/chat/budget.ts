import { createTranslator } from 'next-intl';
import messages from '../../../messages/en.json';
import { API_BASE_URL } from '@/config/api';
import { chatAgenticEnabled } from './flag';
import type { ChatKeySource } from './key';

/**
 * A Chat model step on the workspace's one AI budget (CHAT-04 §C items
 * 11–14, CHAT-16 items 26, 29–30), for the Chat engine: before each model
 * step, reserveChatStep holds the step's worst case on the budget, and the
 * step then ends with exactly one of
 *   - charge(usage): it answered; the hold becomes its real cost (1x);
 *   - release(): it failed before the model billed anything; the hold goes;
 *   - keep(): it was sent and then aborted (the run's Stop); the provider
 *     bills it all the same, so the hold stays as its cost.
 * The server keeps the ledger and prices every step (backend/src/lib/
 * chatBudget.js, through /api/internal/chat/budget): dollars never pass
 * through here, and none goes to a browser.
 *
 * Every step writes one usage row, on either key (lib/chat/key.ts): on
 * GetCito's it counts toward the budget, on the workspace's own it is
 * marked and never counts. With CHAT_AGENTIC off for the workspace nothing is
 * held or written: today's Agent Chat runs on the workspace's own key only.
 *
 * Nothing here throws: a step that can't be held comes back as a refusal,
 * with the words to show, and doesn't start; settling one that fails is
 * logged and leaves the hold at the step's worst case (over, never under).
 * Every call to the API has a short time limit, so an API that doesn't
 * answer (a 502 while it restarts) can't hang a run. Server code only
 * (CRON_SECRET).
 */

export const CHAT_BUDGET_FEATURES = ['chat', 'agent', 'schedule', 'image'] as const;
export type ChatBudgetFeature = (typeof CHAT_BUDGET_FEATURES)[number];

/**
 * What a model step used, as the AI SDK reports it: every input token
 * (`inputTokens`, the prompt cache's included), and of those the ones read
 * from and written to the provider's prompt cache. The server prices a cache
 * read below the input price and a write above it (CHAT-04 §D item 28).
 */
export interface ChatStepUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export interface ChatBudgetStep {
  organizationId: string;
  runId: string;
  /** The run's step the call is for, when it has one. */
  stepId?: string | null;
  /** 'chat' unless the step is an agent's, a scheduled run's or an image. */
  feature?: ChatBudgetFeature;
  /** The model's catalog id ("anthropic/claude-sonnet-5.5"), as the server prices it. */
  model: string;
  /**
   * The step's prompt in tokens, counted up rather than down: the hold
   * assumes no prompt-cache hit, so a miss can't pass the budget.
   */
  inputTokens: number;
  /** The step's max output tokens: the most it may write. */
  maxOutputTokens: number;
  /** Whose key the step runs on (resolveChatModelKey). */
  source: ChatKeySource;
  /**
   * The agent run the step's chat is (chat_conversations.agent_run_id): the
   * server holds the step within that run's cap too (CHAT-27 item 21).
   */
  agentRunId?: string | null;
  /**
   * The scheduled job the step's chat is (chat_conversations.schedule_id):
   * its usage row is named with the job (CHAT-12 item 14).
   */
  scheduleId?: string | null;
}

/**
 * What a run's steps are metered as, by whose chat it is: an agent run's
 * as the agent's, within its own cap (CHAT-27 item 21); a scheduled job's
 * as the job's (CHAT-12 item 14); else a person's chat.
 */
export function meteredAs(chat: {
  agentRunId: string | null;
  scheduleId: string | null;
}): Pick<ChatBudgetStep, 'feature' | 'agentRunId' | 'scheduleId'> {
  if (chat.agentRunId) return { feature: 'agent', agentRunId: chat.agentRunId };
  if (chat.scheduleId) return { feature: 'schedule', scheduleId: chat.scheduleId };
  return {};
}

/**
 * Why a step can't start: the budget can't cover it (ai_limit; CHAT-04 item
 * 17's card, the trial's own words in the free trial), an agent run's own
 * cap can't (run_cap; CHAT-27 item 22), no active plan (plan_limit), a run
 * that isn't the workspace's (not_found), Chat off on the server
 * (chat_off), or the API didn't answer in time (unavailable).
 */
export const CHAT_BUDGET_REFUSALS = [
  'ai_limit',
  'run_cap',
  'plan_limit',
  'not_found',
  'chat_off',
  'unavailable',
] as const;
export type ChatBudgetRefusal = (typeof CHAT_BUDGET_REFUSALS)[number];

/** A held step, settled once by charge, release or keep. */
export interface ChatStepBudget {
  /** The step answered: its usage, priced on the server, and how long its call took (staff only). */
  charge(usage: ChatStepUsage, latencyMs?: number): Promise<void>;
  /** Nothing was billed: the hold goes. A no-op once charged or kept; call it in a finally. */
  release(): Promise<void>;
  /** A Stop aborted the call the provider still bills: the hold stays as its cost. */
  keep(): void;
}

export type ChatStepReservation =
  | { ok: true; budget: ChatStepBudget }
  | {
      ok: false;
      refusal: ChatBudgetRefusal;
      /** The free trial's budget is the one used up. */
      trial: boolean;
      /** Asking again may help: the API didn't answer, or said it was down. */
      retryable: boolean;
      /** What to tell the person, from messages/en.json (chatBudget). */
      message: string;
    };

/** How long a hold may take before the step is given up: a run waits on it. */
export const RESERVE_TIMEOUT_MS = 5_000;
/** How long settling a step may take, each try. */
export const SETTLE_TIMEOUT_MS = 5_000;
/** The wait before settling once more, after no answer or a 502–504. */
export const SETTLE_RETRY_DELAY_MS = 500;

const t = createTranslator({ locale: 'en', messages, namespace: 'chatBudget' });

/** A refusal, with its words. */
function refused(
  refusal: ChatBudgetRefusal,
  { trial = false, retryable = false }: { trial?: boolean; retryable?: boolean } = {},
): Extract<ChatStepReservation, { ok: false }> {
  const message = refusal === 'ai_limit' && trial ? t('ai_limit_trial') : t(refusal);
  return { ok: false, refusal, trial, retryable, message };
}

/** With Chat off: nothing held, nothing written. */
const UNMETERED: ChatStepBudget = {
  async charge() {},
  async release() {},
  keep() {},
};

type BudgetPath = 'reserve' | 'charge' | 'release' | 'fit';

/** The proxy's answers while the API is down or restarting. */
const isTransient = (status: number) => status === 502 || status === 503 || status === 504;

/**
 * One call to the API's budget endpoint. Null when it didn't answer within
 * `timeoutMs` (a dropped connection, the time limit) or CRON_SECRET isn't
 * set; never throws.
 */
async function post(
  path: BudgetPath,
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<{ status: number; body: Record<string, unknown> | null } | null> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error('[chat/budget] CRON_SECRET must be configured for Chat');
    return null;
  }
  try {
    const res = await fetch(`${API_BASE_URL}/api/internal/chat/budget/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    });
    return {
      status: res.status,
      body: (await res.json().catch(() => null)) as Record<string, unknown> | null,
    };
  } catch (err) {
    console.error(`[chat/budget] ${path} got no answer:`, (err as Error)?.name ?? err);
    return null;
  }
}

/**
 * Settles a held step: once more after a short wait when the API didn't
 * answer or said it was down (both are safe to repeat: a charge sets the
 * row, a release deletes it). A failure is logged and leaves the hold.
 */
async function settle(path: 'charge' | 'release', body: Record<string, unknown>) {
  let res = await post(path, body, SETTLE_TIMEOUT_MS);
  if (!res || isTransient(res.status)) {
    await new Promise((resolve) => setTimeout(resolve, SETTLE_RETRY_DELAY_MS));
    res = await post(path, body, SETTLE_TIMEOUT_MS);
  }
  if (res?.status !== 200) {
    console.error(
      `[chat/budget] ${path} failed`,
      res?.status ?? 'no answer',
      res?.body?.error ?? '',
    );
  }
}

/**
 * Holds a model step on the workspace's AI budget before it starts. The step
 * runs only on `ok: true`; a refusal says why, in words to show (the run
 * then pauses at the cap, CHAT-04 item 17, or stops). Asked once, within
 * RESERVE_TIMEOUT_MS: a hold isn't safe to repeat blindly (one taken whose
 * answer was lost would hold twice), so an API that doesn't answer is a
 * refusal marked retryable, and the step doesn't run unheld.
 */
export async function reserveChatStep(step: ChatBudgetStep): Promise<ChatStepReservation> {
  if (!chatAgenticEnabled(step.organizationId)) return { ok: true, budget: UNMETERED };

  const reserved = await post(
    'reserve',
    {
      orgId: step.organizationId,
      runId: step.runId,
      stepId: step.stepId ?? null,
      feature: step.feature ?? 'chat',
      model: step.model,
      inputTokens: Math.max(0, Math.ceil(step.inputTokens)),
      maxOutputTokens: Math.max(1, Math.ceil(step.maxOutputTokens)),
      ownKey: step.source === 'own',
      ...(step.agentRunId ? { agentRunId: step.agentRunId } : {}),
      ...(step.scheduleId ? { scheduleId: step.scheduleId } : {}),
    },
    RESERVE_TIMEOUT_MS,
  );
  if (!reserved) return refused('unavailable', { retryable: true });
  const usageId = reserved.body?.usageId;
  if (reserved.status !== 201 || typeof usageId !== 'string') {
    const code = reserved.body?.error;
    if (typeof code === 'string' && (CHAT_BUDGET_REFUSALS as readonly string[]).includes(code)) {
      return refused(code as ChatBudgetRefusal, { trial: reserved.body?.trial === true });
    }
    // A 502 while the API restarts, or an answer it shouldn't give.
    return refused('unavailable', { retryable: isTransient(reserved.status) });
  }

  // A step that called the model again (a retry) is charged what it used in
  // all. Counts the provider didn't report stay out: with none, the server
  // keeps the hold as the step's cost.
  const used: ChatStepUsage = {};
  const add = (key: keyof ChatStepUsage, n: number | undefined) => {
    if (typeof n === 'number' && Number.isFinite(n)) used[key] = (used[key] ?? 0) + Math.max(0, n);
  };
  let settled = false;
  let took = 0;
  const budget: ChatStepBudget = {
    async charge(usage, latencyMs) {
      settled = true;
      add('inputTokens', usage?.inputTokens);
      add('outputTokens', usage?.outputTokens);
      add('cacheReadTokens', usage?.cacheReadTokens);
      add('cacheWriteTokens', usage?.cacheWriteTokens);
      if (typeof latencyMs === 'number' && Number.isFinite(latencyMs)) {
        took += Math.max(0, Math.round(latencyMs));
      }
      await settle('charge', {
        orgId: step.organizationId,
        usageId,
        model: step.model,
        usage: { ...used },
        ...(took > 0 ? { latencyMs: took } : {}),
      });
    },
    async release() {
      if (settled) return;
      settled = true;
      await settle('release', { orgId: step.organizationId, usageId });
    },
    keep() {
      settled = true;
    },
  };
  return { ok: true, budget };
}

/** The most like parts one check sizes, as the server takes them (MAX_FIT_UNITS). */
export const MAX_FIT_UNITS = 100;

/** A job in like parts, each one model step at worst: what fitChatUnits checks. */
export interface ChatFitJob {
  organizationId: string;
  /** The model a part's step runs on, as the server prices it. */
  model: string;
  /** One part's step: its prompt in tokens (counted up) and the most it may write. */
  perUnit: { inputTokens: number; maxOutputTokens: number };
  /** How many parts the job has. */
  units: number;
  source: ChatKeySource;
  /** The agent run the chat is: its own cap counts too (CHAT-27 item 21). */
  agentRunId?: string | null;
}

/**
 * How many of a job's parts the AI limit left covers, before the job starts
 * (CHAT-04 item 17a): a count, never dollars (the server works it out,
 * backend/src/lib/chatBudget.js fitChatUnits). Every part fits on the
 * workspace's own key, which isn't checked, and while the new Chat is off.
 * `limit` says which limit binds: the agent run's own cap ('run') or the
 * month's AI limit.
 * Holds nothing: each step is still held on its own. Never throws: an API
 * that doesn't answer, or refuses, comes back as `ok: false`, and the job
 * goes on with each step held as before.
 */
export async function fitChatUnits(
  job: ChatFitJob,
): Promise<
  { ok: true; fits: number; limit: 'run' | 'month' } | { ok: false; refusal: ChatBudgetRefusal }
> {
  const units = Math.max(1, Math.min(MAX_FIT_UNITS, Math.floor(job.units)));
  if (job.source === 'own' || !chatAgenticEnabled(job.organizationId)) {
    return { ok: true, fits: units, limit: 'month' };
  }
  const res = await post(
    'fit',
    {
      orgId: job.organizationId,
      model: job.model,
      perUnit: {
        inputTokens: Math.max(0, Math.ceil(job.perUnit.inputTokens)),
        maxOutputTokens: Math.max(1, Math.ceil(job.perUnit.maxOutputTokens)),
      },
      units,
      ...(job.agentRunId ? { agentRunId: job.agentRunId } : {}),
    },
    RESERVE_TIMEOUT_MS,
  );
  const fits = res?.body?.fits;
  if (res?.status === 200 && typeof fits === 'number' && Number.isInteger(fits) && fits >= 0) {
    // The agent run's own cap, when it is the limit that binds; else the month's.
    const limit = res.body?.limit === 'run' ? 'run' : 'month';
    return { ok: true, fits: Math.min(fits, units), limit };
  }
  const code = res?.body?.error;
  return {
    ok: false,
    refusal:
      typeof code === 'string' && (CHAT_BUDGET_REFUSALS as readonly string[]).includes(code)
        ? (code as ChatBudgetRefusal)
        : 'unavailable',
  };
}
