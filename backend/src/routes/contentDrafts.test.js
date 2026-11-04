import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

/**
 * POST /api/content-drafts/:draftId/brief (CE-007): Rebuild outline;
 * POST /api/content-drafts/:draftId/suggestions (CE-018): Fix open rules with agent; and
 * POST /api/content-drafts/:draftId/write (CE-015): Start's Agent.
 * POST /api/content-drafts/:draftId/rewrite: Rewrite the page to these rules.
 * POST /api/content-drafts/:draftId/stop (v1.1 CE-027): Stop the agent's run.
 */

const BRAND = '33333333-3333-3333-3333-333333333333';
const DRAFT = '77777777-7777-7777-7777-777777777777';

const rebuildDraftBrief = vi.fn();
const startDraftWriting = vi.fn();
const fixDraftRules = vi.fn();
const assertBrandAccess = vi.fn();
const stopDraftRun = vi.fn();
const buildShoppingPath = vi.fn();
/** A Start's claim on the draft (its agent_state_at), as its run carries it. */
const CLAIM = '2026-10-23T10:00:00.000+00:00';
/** The draft Stop reads, to check it is the brand's. */
let stopDraft;

// The route's modules read the Supabase client; CI has no credentials for it.
/** The drafts Stop lets go of. */
let letGo;
vi.mock('../config/supabase.js', () => ({
  default: {
    from: () => {
      const filters = [];
      const chain = {
        select: () => chain,
        eq: (col, v) => (filters.push([col, v]), chain),
        update: (value) => (letGo.push({ value, filters }), chain),
        maybeSingle: async () => ({ data: stopDraft, error: null }),
        then: (resolve) => resolve({ error: null }),
      };
      return chain;
    },
  },
}));
vi.mock('../lib/contentRuns.js', async (importOriginal) => ({
  ...(await importOriginal()),
  stopDraftRun: (...args) => stopDraftRun(...args),
}));
vi.mock('../lib/contentBrief.js', async (importOriginal) => ({
  ...(await importOriginal()),
  rebuildDraftBrief: (...args) => rebuildDraftBrief(...args),
}));
vi.mock('../lib/contentWriter.js', async (importOriginal) => ({
  ...(await importOriginal()),
  startDraftWriting: (...args) => startDraftWriting(...args),
}));
vi.mock('../lib/contentAgent.js', async (importOriginal) => ({
  ...(await importOriginal()),
  fixDraftRules: (...args) => fixDraftRules(...args),
}));
vi.mock('../lib/shoppingPath.js', async (importOriginal) => ({
  ...(await importOriginal()),
  buildShoppingPath: (...args) => buildShoppingPath(...args),
}));
vi.mock('../lib/access.js', () => ({ assertBrandAccess: (...args) => assertBrandAccess(...args) }));
/** Whether the shopping path's bucket is spent: its limiter answers as express-rate-limit does then. */
let shoppingPathSpent = false;
vi.mock('../middleware/rateLimiter.js', async (importOriginal) => ({
  ...(await importOriginal()),
  shoppingPathLimiter: (_req, res, next) =>
    shoppingPathSpent
      ? res
          .status(429)
          .json({ success: false, message: 'Too many requests, please try again later.' })
      : next(),
}));

const { default: router } = await import('./contentDrafts.js');
const { PlanLimitError } = await import('../lib/planGuard.js');
const { RunStoppedError } = await import('../lib/contentRuns.js');
const { NoShoppingPath } = await import('../lib/shoppingPath.js');

let server;
let baseUrl;

beforeEach(async () => {
  rebuildDraftBrief.mockReset().mockResolvedValue({ goal: 'g', outline: [] });
  startDraftWriting.mockReset().mockResolvedValue({ started: true });
  fixDraftRules.mockReset().mockResolvedValue({ count: 2, batchId: 'b1' });
  assertBrandAccess.mockReset().mockResolvedValue({});
  stopDraftRun.mockReset().mockResolvedValue([{ id: 'run-1', claimed_at: CLAIM }]);
  buildShoppingPath.mockReset().mockResolvedValue({ version: 1, products: [] });
  shoppingPathSpent = false;
  stopDraft = { brand_id: BRAND };
  letGo = [];
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'u1' };
    req.log = { error: vi.fn() };
    next();
  });
  app.use('/api/content-drafts', router);
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/content-drafts`;
});

afterEach(() => new Promise((resolve) => server.close(resolve)));

const sources = {
  promptIds: [],
  fanouts: [{ query: 'espresso', platforms: ['copilot-web'] }],
  pages: [],
  queries: [],
  headings: [],
  length: 3000,
};

const rebuild = (body, draftId = DRAFT) =>
  fetch(`${baseUrl}/${draftId}/brief`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('POST /api/content-drafts/:draftId/brief', () => {
  it('rebuilds the brief for a member of the brand', async () => {
    const res = await rebuild({ brandId: BRAND, sources });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ brief: { goal: 'g', outline: [] } });
    expect(assertBrandAccess).toHaveBeenCalledWith(BRAND, 'u1');
    expect(rebuildDraftBrief).toHaveBeenCalledWith({ draftId: DRAFT, brandId: BRAND, sources });
  });

  it('passes the rules in effect on, cut to fit', async () => {
    const rules = [
      { key: 'faq', name: 'F'.repeat(250), detail: 'aim: 5 questions' },
      { key: 'h1', name: 'H1' },
    ];
    const res = await rebuild({ brandId: BRAND, sources, rules });
    expect(res.status).toBe(200);
    expect(rebuildDraftBrief).toHaveBeenCalledWith({
      draftId: DRAFT,
      brandId: BRAND,
      sources,
      rules: [
        { ...rules[0], name: 'F'.repeat(200) },
        { ...rules[1], detail: '' },
      ],
    });
  });

  it('refuses a malformed draft, brand or source list', async () => {
    for (const [body, draftId] of [
      [{ brandId: BRAND, sources }, 'd1'],
      [{ brandId: 'b1', sources }, DRAFT],
      [{ brandId: BRAND, sources: { ...sources, promptIds: ['p1'] } }, DRAFT],
      [{ brandId: BRAND, sources, rules: Array(61).fill({ key: 'faq', name: 'FAQ' }) }, DRAFT],
    ]) {
      const res = await rebuild(body, draftId);
      expect(res.status).toBe(400);
    }
    expect(rebuildDraftBrief).not.toHaveBeenCalled();
  });

  it('says why it didn’t rebuild', async () => {
    assertBrandAccess.mockRejectedValueOnce(Object.assign(new Error('Forbidden'), { status: 403 }));
    let res = await rebuild({ brandId: BRAND, sources });
    expect(res.status).toBe(403);

    rebuildDraftBrief.mockRejectedValueOnce(new PlanLimitError('used up', 429));
    res = await rebuild({ brandId: BRAND, sources });
    expect(res.status).toBe(429);
    await expect(res.json()).resolves.toMatchObject({ code: 'ai_budget' });

    // No active subscription is its own case, not a spent budget.
    rebuildDraftBrief.mockRejectedValueOnce(new PlanLimitError('no subscription', 402));
    res = await rebuild({ brandId: BRAND, sources });
    expect(res.status).toBe(402);
    await expect(res.json()).resolves.toMatchObject({ code: 'no_subscription' });

    rebuildDraftBrief.mockRejectedValueOnce(
      Object.assign(new Error('none'), { status: 422, code: 'no_sources' }),
    );
    res = await rebuild({ brandId: BRAND, sources });
    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toMatchObject({ code: 'no_sources' });

    rebuildDraftBrief.mockRejectedValueOnce(new Error('model down'));
    res = await rebuild({ brandId: BRAND, sources });
    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toMatchObject({ code: 'failed' });
  });
});

describe('POST /api/content-drafts/:draftId/write', () => {
  const write = (body, draftId = DRAFT) =>
    fetch(`${baseUrl}/${draftId}/write`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  const rules = [{ key: 'faq', name: 'FAQ with 5 questions', detail: 'aim: 5' }];

  it('starts the agent and answers at once', async () => {
    const res = await write({ brandId: BRAND, sources, rules, textRules: ['Say we'] });
    expect(res.status).toBe(202);
    await expect(res.json()).resolves.toEqual({ started: true });
    expect(assertBrandAccess).toHaveBeenCalledWith(BRAND, 'u1');
    expect(startDraftWriting).toHaveBeenCalledWith({
      draftId: DRAFT,
      brandId: BRAND,
      input: { sources, rules, textRules: ['Say we'], locked: [] },
    });
  });

  it('refuses a malformed request, and says why it didn’t start', async () => {
    // A length out of range is brought into it (rebuildSources); a malformed prompt id isn't.
    let res = await write({ brandId: BRAND, sources: { ...sources, promptIds: ['p1'] } });
    expect(res.status).toBe(400);
    expect(startDraftWriting).not.toHaveBeenCalled();

    startDraftWriting.mockRejectedValueOnce(
      Object.assign(new Error('busy'), { status: 409, code: 'writing' }),
    );
    res = await write({ brandId: BRAND, sources });
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ code: 'writing' });

    startDraftWriting.mockRejectedValueOnce(new PlanLimitError('used up', 429));
    res = await write({ brandId: BRAND, sources });
    expect(res.status).toBe(429);
    await expect(res.json()).resolves.toMatchObject({ code: 'ai_budget' });

    startDraftWriting.mockRejectedValueOnce(new Error('db down'));
    res = await write({ brandId: BRAND, sources });
    expect(res.status).toBe(502);
  });
});

describe('POST /api/content-drafts/:draftId/rewrite', () => {
  const rewrite = (body) =>
    fetch(`${baseUrl}/${DRAFT}/rewrite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('starts a whole-page rewrite and answers at once', async () => {
    const res = await rewrite({ brandId: BRAND, sources, locked: ['quoted words'] });
    expect(res.status).toBe(202);
    expect(startDraftWriting).toHaveBeenCalledWith({
      draftId: DRAFT,
      brandId: BRAND,
      input: { sources, rules: [], textRules: [], locked: ['quoted words'] },
      rewrite: true,
    });
  });

  it('says why it didn’t start', async () => {
    startDraftWriting.mockRejectedValueOnce(
      Object.assign(new Error('too long'), { status: 422, code: 'too_long' }),
    );
    const res = await rewrite({ brandId: BRAND, sources });
    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toMatchObject({ code: 'too_long' });
  });
});

const fix = (body) =>
  fetch(`${baseUrl}/${DRAFT}/suggestions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('POST /api/content-drafts/:draftId/suggestions', () => {
  const rules = [{ key: 'faq', name: 'FAQ', detail: 'missing' }];

  it('runs the agent for a member of the brand', async () => {
    const res = await fix({ brandId: BRAND, rules });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ count: 2, batchId: 'b1' });
    expect(fixDraftRules).toHaveBeenCalledWith({
      draftId: DRAFT,
      brandId: BRAND,
      input: { rules, textRules: [], locked: [] },
    });
  });

  it('says why it didn’t run', async () => {
    fixDraftRules.mockRejectedValueOnce(new PlanLimitError('used up', 429));
    let res = await fix({ brandId: BRAND, rules });
    expect(res.status).toBe(429);
    await expect(res.json()).resolves.toMatchObject({ code: 'ai_budget' });

    fixDraftRules.mockRejectedValueOnce(new PlanLimitError('no subscription', 402));
    res = await fix({ brandId: BRAND, rules });
    expect(res.status).toBe(402);
    await expect(res.json()).resolves.toMatchObject({ code: 'no_subscription' });

    for (const code of ['open_suggestions', 'published']) {
      fixDraftRules.mockRejectedValueOnce(Object.assign(new Error(code), { status: 409, code }));
      res = await fix({ brandId: BRAND, rules });
      expect(res.status).toBe(409);
      await expect(res.json()).resolves.toMatchObject({ code });
    }
  });
});

describe('POST /api/content-drafts/:draftId/handoff (CE-051)', () => {
  const handOff = (body) =>
    fetch(`${baseUrl}/${DRAFT}/handoff`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  const items = [{ key: 'readability:longSentences', detail: '2 sentences over 35 words' }];
  beforeEach(() => {
    process.env.CONTENT_QUALITY_PHASE = '2';
  });
  afterEach(() => {
    delete process.env.CONTENT_QUALITY_PHASE;
  });

  it('hands the page’s checks to the agent for a member of the brand', async () => {
    const res = await handOff({ brandId: BRAND, items, origin: 'auto' });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ count: 2, batchId: 'b1' });
    expect(assertBrandAccess).toHaveBeenCalledWith(BRAND, 'u1');
    expect(fixDraftRules).toHaveBeenCalledWith(
      expect.objectContaining({
        draftId: DRAFT,
        brandId: BRAND,
        input: expect.objectContaining({
          rules: [expect.objectContaining({ key: 'readability:longSentences' })],
        }),
        handoff: { origin: 'auto' },
      }),
    );
  });

  it('is off before phase 2, refuses a check it doesn’t fix, and says why it didn’t run', async () => {
    let res = await handOff({ brandId: BRAND, items: [{ key: 'eeat:experience' }] });
    expect(res.status).toBe(400);
    for (const code of ['not_due', 'already', 'open_suggestions']) {
      fixDraftRules.mockRejectedValueOnce(Object.assign(new Error(code), { status: 409, code }));
      res = await handOff({ brandId: BRAND, items });
      expect(res.status).toBe(409);
      await expect(res.json()).resolves.toMatchObject({ code });
    }
    fixDraftRules.mockRejectedValueOnce(new PlanLimitError('used up', 429));
    res = await handOff({ brandId: BRAND, items });
    expect(res.status).toBe(429);
    await expect(res.json()).resolves.toMatchObject({ code: 'ai_budget' });
    process.env.CONTENT_QUALITY_PHASE = '1';
    res = await handOff({ brandId: BRAND, items });
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ code: 'off' });
  });
});

describe('POST /api/content-drafts/:draftId/stop', () => {
  const stop = (body = { brandId: BRAND }, draftId = DRAFT) =>
    fetch(`${baseUrl}/${draftId}/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('stops the draft’s run under way', async () => {
    const res = await stop();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ stopped: true });
    expect(assertBrandAccess).toHaveBeenCalledWith(BRAND, 'u1');
    expect(stopDraftRun).toHaveBeenCalledWith(DRAFT, null);
    // A background run's draft is let go at once, whichever server held it:
    // the claim that run holds, never a newer one.
    expect(letGo).toEqual([
      {
        value: { agent_state: null, agent_state_at: expect.any(String) },
        filters: [
          ['id', DRAFT],
          ['agent_state', 'writing'],
          ['agent_state_at', CLAIM],
        ],
      },
    ]);
  });

  it('keeps a Start’s claim when the run it names is a Fix on the same draft', async () => {
    const RUN = '99999999-9999-4999-8999-999999999999';
    // A Fix, or the brief, holds no claim: the Start another tab began goes on with its own.
    stopDraftRun.mockResolvedValue([{ id: RUN, claimed_at: null }]);
    const res = await stop({ brandId: BRAND, runId: RUN });
    expect(await res.json()).toEqual({ stopped: true });
    expect(stopDraftRun).toHaveBeenCalledWith(DRAFT, RUN);
    expect(letGo).toEqual([]);
  });

  it('stops only the run the editor names, when it names one', async () => {
    const RUN = '99999999-9999-4999-8999-999999999999';
    expect((await stop({ brandId: BRAND, runId: RUN })).status).toBe(200);
    expect(stopDraftRun).toHaveBeenCalledWith(DRAFT, RUN);
    expect((await stop({ brandId: BRAND, runId: 'not-a-run' })).status).toBe(400);
  });

  it('lets go of nothing when no run was under way', async () => {
    stopDraftRun.mockResolvedValue([]);
    expect(await (await stop()).json()).toEqual({ stopped: false });
    expect(letGo).toEqual([]);
  });

  it('stops nothing of another brand’s draft, or on a bad request', async () => {
    stopDraft = { brand_id: '44444444-4444-4444-4444-444444444444' };
    expect((await stop()).status).toBe(404);
    expect((await stop({})).status).toBe(400);
    expect((await stop({ brandId: BRAND }, 'nope')).status).toBe(400);
    expect(stopDraftRun).not.toHaveBeenCalled();
  });

  it('says a Fix open rules run was stopped', async () => {
    fixDraftRules.mockRejectedValue(new RunStoppedError());
    const res = await fetch(`${baseUrl}/${DRAFT}/suggestions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        brandId: BRAND,
        rules: [{ key: 'faq', name: 'FAQ', detail: '' }],
      }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'stopped' });
  });
});

describe('POST /api/content-drafts/:draftId/shopping-path', () => {
  const build = (body, draftId = DRAFT) =>
    fetch(`${baseUrl}/${draftId}/shopping-path`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  it("builds the draft's shopping path for a member of the brand", async () => {
    const res = await build({ brandId: BRAND });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ path: { version: 1, products: [] } });
    expect(assertBrandAccess).toHaveBeenCalledWith(BRAND, 'u1');
    expect(buildShoppingPath).toHaveBeenCalledWith({ draftId: DRAFT, brandId: BRAND });
  });

  it("says why a draft has none, and refuses another brand's draft", async () => {
    buildShoppingPath.mockRejectedValueOnce(new NoShoppingPath('page_type'));
    await expect((await build({ brandId: BRAND })).json()).resolves.toEqual({
      path: null,
      reason: 'page_type',
    });
    buildShoppingPath.mockRejectedValueOnce(
      Object.assign(new Error('Draft not found'), { status: 404 }),
    );
    expect((await build({ brandId: BRAND })).status).toBe(404);
    expect((await build({ brandId: 'nope' })).status).toBe(400);
  });

  it('says when the path changed while it was built, and when the bucket is spent', async () => {
    buildShoppingPath.mockRejectedValueOnce(
      Object.assign(new Error('The shopping path changed while it was built'), {
        status: 409,
        code: 'changed',
      }),
    );
    const changed = await build({ brandId: BRAND });
    expect(changed.status).toBe(409);
    expect(await changed.json()).toMatchObject({ code: 'changed' });
    buildShoppingPath.mockRejectedValueOnce(new NoShoppingPath('no_match'));
    await expect((await build({ brandId: BRAND })).json()).resolves.toEqual({
      path: null,
      reason: 'no_match',
    });
    shoppingPathSpent = true;
    expect((await build({ brandId: BRAND })).status).toBe(429);
    expect(buildShoppingPath).toHaveBeenCalledTimes(2);
  });

  it("answers 502 when the path can't be built", async () => {
    buildShoppingPath.mockRejectedValueOnce(new Error('catalog_variants read: timeout'));
    const res = await build({ brandId: BRAND });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({
      error: 'The shopping path could not be built',
      code: 'failed',
    });
  });
});
