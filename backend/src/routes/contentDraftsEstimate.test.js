import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

/**
 * POST /api/content-drafts/:draftId/audit-estimate (customer priorities
 * item 9): the draft's Site Audit estimate, free; its AI checks on request,
 * on Quality's AI usage.
 */

const BRAND = '33333333-3333-3333-3333-333333333333';
const DRAFT = '77777777-7777-7777-7777-777777777777';

let rows;
const assertBrandAccess = vi.fn();
vi.mock('../config/supabase.js', () => ({
  default: {
    from: (table) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        order: () => chain,
        limit: () => chain,
        maybeSingle: async () => ({ data: rows[table] ?? null, error: null }),
        single: async () => ({ data: rows[table] ?? null, error: null }),
        then: (resolve) => resolve({ data: rows[table] ?? [], error: null }),
      };
      return chain;
    },
  },
}));
vi.mock('../lib/access.js', () => ({ assertBrandAccess: (...args) => assertBrandAccess(...args) }));
const readSiteSignals = vi.fn();
vi.mock('../lib/audit/draftEstimate.js', async (importOriginal) => ({
  ...(await importOriginal()),
  readSiteSignals: (...args) => readSiteSignals(...args),
}));
const evaluateLlmSignals = vi.fn();
vi.mock('../lib/audit/llmSignals.js', async (importOriginal) => ({
  ...(await importOriginal()),
  evaluateLlmSignals: (...args) => evaluateLlmSignals(...args),
}));
const reserveAiBudget = vi.fn();
vi.mock('../lib/planGuard.js', async (importOriginal) => ({
  ...(await importOriginal()),
  reserveAiBudget: (...args) => reserveAiBudget(...args),
}));

const demo = vi.hoisted(() => ({ value: false }));
vi.mock('../middleware/demoBrand.js', async (importOriginal) => ({
  ...(await importOriginal()),
  isDemoBrand: async () => demo.value,
}));

const { default: router } = await import('./contentDrafts.js');
const { PlanLimitError } = await import('../lib/planGuard.js');
const { LLM_SIGNAL_KEYS } = await import('../lib/audit/llmSignals.js');

let server;
let baseUrl;
let budget;

beforeEach(async () => {
  rows = {
    content_drafts: { brand_id: BRAND, source_url: null },
    brand_domains: [{ domain: 'acme.example', is_primary: true }],
    brands: { organization_id: 'org-1' },
  };
  assertBrandAccess.mockReset().mockResolvedValue({ orgId: 'org-1' });
  readSiteSignals.mockReset().mockResolvedValue([{ key: 'https', status: 'pass', score: 1 }]);
  budget = { charge: vi.fn(), release: vi.fn() };
  reserveAiBudget.mockReset().mockResolvedValue(budget);
  evaluateLlmSignals.mockReset().mockImplementation(async (_ctx, { onUsage }) => {
    await onUsage({ inputTokens: 4000, outputTokens: 1500 });
    return {
      results: LLM_SIGNAL_KEYS.map((key) => ({
        key,
        status: 'pass',
        score: 1,
        evidence: { reason: 'ok' },
      })),
      partial: false,
    };
  });
  const app = express();
  app.use(express.json({ limit: '5mb' }));
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

const HTML =
  '<!doctype html><html><head><title>Cold brew</title></head><body><h1>Cold brew at home</h1><p>Cold brew is coffee steeped in cold water for 12 to 18 hours.</p><h2>What you need</h2><ul><li>Coffee</li><li>Water</li></ul><a href="https://acme.example/shop">Shop</a></body></html>';
const estimate = (body) =>
  fetch(`${baseUrl}/${DRAFT}/audit-estimate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ brandId: BRAND, html: HTML, ...body }),
  });

describe('POST /api/content-drafts/:draftId/audit-estimate', () => {
  it('estimates the draft for free: its own checks, the site’s from its audit', async () => {
    const res = await estimate();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.score).toEqual(expect.any(Number));
    expect(body.checks).toMatchObject({ site: 1, ai: 0 });
    expect(body.checks.page).toBeGreaterThan(10);
    expect(body).not.toHaveProperty('verdicts');
    expect(readSiteSignals).toHaveBeenCalledWith(BRAND);
    expect(reserveAiBudget).not.toHaveBeenCalled();
    expect(evaluateLlmSignals).not.toHaveBeenCalled();
    expect(assertBrandAccess).toHaveBeenCalledWith(BRAND, 'u1');
  });

  it('reads the page on the brand’s site, so its links to it are internal', async () => {
    await estimate({ ai: true });
    expect(evaluateLlmSignals.mock.calls[0][0].url).toBe('https://acme.example/');
    rows.content_drafts = { brand_id: BRAND, source_url: 'https://acme.example/blog/cold-brew' };
    await estimate({ ai: true });
    expect(evaluateLlmSignals.mock.calls[1][0].url).toBe('https://acme.example/blog/cold-brew');
  });

  it('runs the AI checks on request, charged to Quality’s AI usage, and returns their verdicts', async () => {
    const res = await estimate({ ai: true });
    const body = await res.json();
    expect(reserveAiBudget).toHaveBeenCalledWith('org-1', {
      feature: 'quality',
      modelId: expect.any(String),
      draftId: DRAFT,
      holdUsd: 0.01,
    });
    expect(budget.charge).toHaveBeenCalledWith({ inputTokens: 4000, outputTokens: 1500 });
    expect(budget.release).toHaveBeenCalled();
    expect(body.checks.ai).toBe(13);
    expect(body.verdicts).toHaveLength(13);
    expect(body.verdicts[0]).toEqual({ key: LLM_SIGNAL_KEYS[0], status: 'pass', score: 1 });
  });

  it('keeps verdicts it is sent back in the score, for free', async () => {
    const free = await (await estimate()).json();
    const res = await estimate({
      verdicts: LLM_SIGNAL_KEYS.map((key) => ({ key, status: 'pass', score: 1 })),
    });
    const body = await res.json();
    expect(body.checks.ai).toBe(13);
    expect(body.score).toBeGreaterThan(free.score);
    expect(reserveAiBudget).not.toHaveBeenCalled();
  });

  it('estimates the demo brand’s drafts for free, and refuses their AI checks before any spend', async () => {
    demo.value = true;
    try {
      expect((await estimate()).status).toBe(200);
      const res = await estimate({ ai: true });
      expect(res.status).toBe(402);
      expect(await res.json()).toMatchObject({ code: 'demo_brand' });
      expect(reserveAiBudget).not.toHaveBeenCalled();
    } finally {
      demo.value = false;
    }
  });

  it('says the AI usage is spent, or there is no plan, before any call', async () => {
    reserveAiBudget.mockRejectedValueOnce(new PlanLimitError('Spent', 429));
    let res = await estimate({ ai: true });
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ code: 'ai_budget' });
    reserveAiBudget.mockRejectedValueOnce(new PlanLimitError('No plan', 402));
    res = await estimate({ ai: true });
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ code: 'no_subscription' });
    expect(evaluateLlmSignals).not.toHaveBeenCalled();
  });

  it('refuses another brand’s draft, a verdict that isn’t an AI check, and a page too long', async () => {
    rows.content_drafts = { brand_id: 'other', source_url: null };
    expect((await estimate()).status).toBe(404);
    rows.content_drafts = { brand_id: BRAND, source_url: null };
    expect(
      (await estimate({ verdicts: [{ key: 'https', status: 'pass', score: 1 }] })).status,
    ).toBe(400);
    expect((await estimate({ html: 'x'.repeat(1_000_001) })).status).toBe(400);
  });
});
