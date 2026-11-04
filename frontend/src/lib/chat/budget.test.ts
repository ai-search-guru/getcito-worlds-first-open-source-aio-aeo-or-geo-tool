import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RESERVE_TIMEOUT_MS,
  fitChatUnits,
  meteredAs,
  reserveChatStep,
  type ChatBudgetStep,
  type ChatStepBudget,
  type ChatStepReservation,
} from './budget';

/**
 * The Chat engine's side of the AI budget: a hold before each model step,
 * then exactly one of charge, release or keep, through the API's internal
 * endpoints. Nothing throws; a step that can't be held doesn't start, and
 * says why. With Chat off nothing is asked.
 */

const ORG = '22222222-2222-4222-8222-222222222222';
const RUN = '0b6c2f2e-6a43-4c55-9f0e-3f4f1d2a7c01';
const STEP = '0b6c2f2e-6a43-4c55-9f0e-3f4f1d2a7c02';
const USAGE = '0b6c2f2e-6a43-4c55-9f0e-3f4f1d2a7c03';

type Call = { path: string; body: Record<string, unknown>; auth: string | null; timed: boolean };
let calls: Call[];
/** What each call answers, in order; a function throws (no answer). */
let answers: ({ status: number; body: unknown } | (() => never))[];

beforeEach(() => {
  vi.stubEnv('CHAT_AGENTIC', 'true');
  vi.stubEnv('CHAT_AGENTIC_ORGS', '');
  vi.stubEnv('CRON_SECRET', 'shh');
  calls = [];
  answers = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({
        path: url.replace(/^.*\/api\/internal\/chat\/budget\//, ''),
        body: JSON.parse(String(init.body)),
        auth: (init.headers as Record<string, string>).Authorization ?? null,
        timed: init.signal instanceof AbortSignal,
      });
      const next = answers.shift() ?? { status: 200, body: { success: true } };
      if (typeof next === 'function') next();
      const { status, body } = next as { status: number; body: unknown };
      return new Response(JSON.stringify(body), { status });
    }),
  );
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const step = (over: Partial<ChatBudgetStep> = {}): ChatBudgetStep => ({
  organizationId: ORG,
  runId: RUN,
  stepId: STEP,
  model: 'anthropic/claude-sonnet-5.5',
  inputTokens: 4199.2,
  maxOutputTokens: 2000,
  source: 'getcito',
  ...over,
});

const held = () => {
  answers.push({ status: 201, body: { success: true, usageId: USAGE } });
};

function budgetOf(r: ChatStepReservation): ChatStepBudget {
  if (!r.ok) throw new Error(`refused: ${r.refusal}`);
  return r.budget;
}

describe('reserveChatStep', () => {
  it('holds the step, then charges the same row with its usage: one row a step', async () => {
    held();
    const budget = budgetOf(await reserveChatStep(step()));
    expect(calls[0]).toEqual({
      path: 'reserve',
      auth: 'Bearer shh',
      timed: true,
      body: {
        orgId: ORG,
        runId: RUN,
        stepId: STEP,
        feature: 'chat',
        model: 'anthropic/claude-sonnet-5.5',
        // Counted up, never down.
        inputTokens: 4200,
        maxOutputTokens: 2000,
        ownKey: false,
      },
    });
    // No cost goes from here: the server prices the step.
    expect(JSON.stringify(calls[0].body)).not.toMatch(/cost|usd/i);

    await budget.charge({ inputTokens: 4000, outputTokens: 700 });
    await budget.release();
    expect(calls.slice(1)).toEqual([
      {
        path: 'charge',
        auth: 'Bearer shh',
        timed: true,
        body: {
          orgId: ORG,
          usageId: USAGE,
          model: 'anthropic/claude-sonnet-5.5',
          usage: { inputTokens: 4000, outputTokens: 700 },
        },
      },
    ]);
  });

  it('charges a step that called the model again with what it used in all', async () => {
    held();
    const budget = budgetOf(await reserveChatStep(step()));
    await budget.charge({ inputTokens: 1000, outputTokens: 100 });
    await budget.charge({ inputTokens: 1200, outputTokens: 300 });
    expect(calls[2].body.usage).toEqual({ inputTokens: 2200, outputTokens: 400 });
  });

  it("sends the prompt cache's reads and writes, and how long the call took, never a cost", async () => {
    held();
    const budget = budgetOf(await reserveChatStep(step()));
    await budget.charge(
      { inputTokens: 4000, outputTokens: 700, cacheReadTokens: 3000, cacheWriteTokens: 400 },
      1830,
    );
    expect(calls[1].body).toEqual({
      orgId: ORG,
      usageId: USAGE,
      model: 'anthropic/claude-sonnet-5.5',
      usage: { inputTokens: 4000, outputTokens: 700, cacheReadTokens: 3000, cacheWriteTokens: 400 },
      latencyMs: 1830,
    });
    expect(JSON.stringify(calls[1].body)).not.toMatch(/cost|usd/i);
  });

  it('sends no counts the provider didn’t report, so the hold stays as the cost', async () => {
    held();
    const budget = budgetOf(await reserveChatStep(step()));
    await budget.charge({});
    expect(calls[1].body.usage).toEqual({});
  });

  it('lets the hold go when the step failed before the model billed anything', async () => {
    held();
    const budget = budgetOf(await reserveChatStep(step()));
    await budget.release();
    await budget.release();
    expect(calls.map((c) => c.path)).toEqual(['reserve', 'release']);
    expect(calls[1].body).toEqual({ orgId: ORG, usageId: USAGE });
  });

  it('keeps the hold as the cost of a call a Stop aborted: nothing is let go', async () => {
    held();
    const budget = budgetOf(await reserveChatStep(step()));
    budget.keep();
    await budget.release();
    expect(calls.map((c) => c.path)).toEqual(['reserve']);
  });

  it('marks a step on the workspace’s own key, still writing its row', async () => {
    held();
    budgetOf(await reserveChatStep(step({ source: 'own', feature: 'image', stepId: null })));
    expect(calls[0].body).toMatchObject({ ownKey: true, feature: 'image', stepId: null });
  });

  it('names an agent run’s step with its run, and says when the run reached its own cap', async () => {
    const AGENT_RUN = '0b6c2f2e-6a43-4c55-9f0e-3f4f1d2a7c09';
    held();
    budgetOf(await reserveChatStep(step({ feature: 'agent', agentRunId: AGENT_RUN })));
    expect(calls[0].body).toMatchObject({ feature: 'agent', agentRunId: AGENT_RUN });
    // A person's own chat sends no agent run.
    held();
    budgetOf(await reserveChatStep(step()));
    expect(calls[1].body).not.toHaveProperty('agentRunId');

    answers.push({ status: 429, body: { success: false, error: 'run_cap' } });
    expect(await reserveChatStep(step({ agentRunId: AGENT_RUN }))).toEqual({
      ok: false,
      refusal: 'run_cap',
      trial: false,
      retryable: false,
      message: "This run reached its limit, so Chat stopped here. What's done so far is kept.",
    });
  });

  it('names a scheduled job’s step with its job, as its chat’s feature says (CHAT-12 item 14)', async () => {
    const JOB = '0b6c2f2e-6a43-4c55-9f0e-3f4f1d2a7c0a';
    const AGENT_RUN = '0b6c2f2e-6a43-4c55-9f0e-3f4f1d2a7c09';
    expect(meteredAs({ agentRunId: null, scheduleId: JOB })).toEqual({
      feature: 'schedule',
      scheduleId: JOB,
    });
    // An agent run's chat is metered as the agent's, within its cap; a person's chat as chat.
    expect(meteredAs({ agentRunId: AGENT_RUN, scheduleId: null })).toEqual({
      feature: 'agent',
      agentRunId: AGENT_RUN,
    });
    expect(meteredAs({ agentRunId: null, scheduleId: null })).toEqual({});

    held();
    budgetOf(await reserveChatStep(step(meteredAs({ agentRunId: null, scheduleId: JOB }))));
    expect(calls[0].body).toMatchObject({ feature: 'schedule', scheduleId: JOB });
    expect(calls[0].body).not.toHaveProperty('agentRunId');
    held();
    budgetOf(await reserveChatStep(step()));
    expect(calls[1].body).not.toHaveProperty('scheduleId');
  });

  it('says the AI limit is used up, in the trial’s words in the free trial, and starts nothing', async () => {
    answers.push({ status: 429, body: { success: false, error: 'ai_limit', trial: false } });
    expect(await reserveChatStep(step())).toEqual({
      ok: false,
      refusal: 'ai_limit',
      trial: false,
      retryable: false,
      message:
        "You've used this month's AI limit, so Chat stopped here. What's done so far is kept.",
    });
    answers.push({ status: 429, body: { success: false, error: 'ai_limit', trial: true } });
    expect(await reserveChatStep(step())).toMatchObject({
      refusal: 'ai_limit',
      trial: true,
      message: "Your trial AI limit is used up, so Chat stopped here. What's done so far is kept.",
    });
    answers.push({ status: 402, body: { success: false, error: 'plan_limit' } });
    expect(await reserveChatStep(step())).toMatchObject({ ok: false, refusal: 'plan_limit' });
  });

  it('starts nothing when the API doesn’t answer in time or answers 502, and says to try again', async () => {
    answers.push(() => {
      throw new DOMException('The operation timed out.', 'TimeoutError');
    });
    const timedOut = await reserveChatStep(step());
    expect(timedOut).toEqual({
      ok: false,
      refusal: 'unavailable',
      trial: false,
      retryable: true,
      message:
        "Chat couldn't check your AI usage just now, so it didn't start this step. Try again in a moment.",
    });
    // Asked once: a hold whose answer was lost would hold twice.
    expect(calls).toHaveLength(1);

    answers.push({ status: 502, body: null });
    expect(await reserveChatStep(step())).toMatchObject({
      ok: false,
      refusal: 'unavailable',
      retryable: true,
    });
    answers.push({ status: 500, body: { success: false, message: 'Internal error' } });
    expect(await reserveChatStep(step())).toMatchObject({
      refusal: 'unavailable',
      retryable: false,
    });
    expect(RESERVE_TIMEOUT_MS).toBeLessThanOrEqual(5_000);
  });

  it('starts nothing, and doesn’t throw, without CRON_SECRET', async () => {
    vi.stubEnv('CRON_SECRET', '');
    expect(await reserveChatStep(step())).toMatchObject({ ok: false, refusal: 'unavailable' });
    expect(calls).toEqual([]);
  });

  it('settles once more after a 502, and never throws when it can’t', async () => {
    held();
    const budget = budgetOf(await reserveChatStep(step()));
    answers.push({ status: 502, body: null }, { status: 200, body: { success: true } });
    await budget.charge({ inputTokens: 10, outputTokens: 10 });
    expect(calls.map((c) => c.path)).toEqual(['reserve', 'charge', 'charge']);

    held();
    const other = budgetOf(await reserveChatStep(step()));
    answers.push(
      () => {
        throw new TypeError('fetch failed');
      },
      () => {
        throw new TypeError('fetch failed');
      },
    );
    await expect(other.release()).resolves.toBeUndefined();
    expect(calls.map((c) => c.path).slice(3)).toEqual(['reserve', 'release', 'release']);
  });

  it('holds nothing and writes nothing while Chat is off: today’s Agent Chat', async () => {
    vi.stubEnv('CHAT_AGENTIC', 'false');
    const budget = budgetOf(await reserveChatStep(step()));
    await budget.charge({ inputTokens: 10, outputTokens: 10 });
    budget.keep();
    await budget.release();
    expect(calls).toEqual([]);
  });
});

describe('fitChatUnits (CHAT-04 item 17a)', () => {
  const AGENT_RUN = '0b6c2f2e-6a43-4c55-9f0e-3f4f1d2a7c0a';
  const job = (over: Partial<Parameters<typeof fitChatUnits>[0]> = {}) => ({
    organizationId: ORG,
    model: 'anthropic/claude-sonnet-5.5',
    perUnit: { inputTokens: 1234.5, maxOutputTokens: 16000 },
    units: 4,
    source: 'getcito' as const,
    ...over,
  });

  it('asks the server how many parts fit, with the secret and a time limit: a count, no dollar', async () => {
    answers.push({ status: 200, body: { success: true, fits: 2, limit: 'run' } });
    expect(await fitChatUnits(job({ agentRunId: AGENT_RUN }))).toEqual({
      ok: true,
      fits: 2,
      limit: 'run',
    });
    expect(calls).toEqual([
      {
        path: 'fit',
        body: {
          orgId: ORG,
          model: 'anthropic/claude-sonnet-5.5',
          perUnit: { inputTokens: 1235, maxOutputTokens: 16000 },
          units: 4,
          agentRunId: AGENT_RUN,
        },
        auth: 'Bearer shh',
        timed: true,
      },
    ]);
  });

  it('reads the month’s AI limit as the one that binds unless the server names the run’s cap', async () => {
    answers.push({ status: 200, body: { success: true, fits: 1, limit: 'month' } });
    expect(await fitChatUnits(job())).toEqual({ ok: true, fits: 1, limit: 'month' });
    answers.push({ status: 200, body: { success: true, fits: 1 } });
    expect(await fitChatUnits(job())).toEqual({ ok: true, fits: 1, limit: 'month' });
  });

  it('asks nothing on the workspace’s own key, or with the new Chat off: every part fits', async () => {
    expect(await fitChatUnits(job({ source: 'own' }))).toEqual({
      ok: true,
      fits: 4,
      limit: 'month',
    });
    vi.stubEnv('CHAT_AGENTIC', 'false');
    expect(await fitChatUnits(job())).toEqual({ ok: true, fits: 4, limit: 'month' });
    expect(calls).toEqual([]);
  });

  it('never throws: a refusal or no answer comes back as one', async () => {
    answers.push({ status: 402, body: { success: false, error: 'plan_limit' } });
    expect(await fitChatUnits(job())).toEqual({ ok: false, refusal: 'plan_limit' });
    answers.push(() => {
      throw new Error('socket hang up');
    });
    expect(await fitChatUnits(job())).toEqual({ ok: false, refusal: 'unavailable' });
    answers.push({ status: 200, body: { success: true, fits: 'many' } });
    expect(await fitChatUnits(job())).toEqual({ ok: false, refusal: 'unavailable' });
  });
});
