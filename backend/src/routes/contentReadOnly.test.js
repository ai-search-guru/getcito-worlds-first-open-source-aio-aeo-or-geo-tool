import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

/**
 * The Content reads a workspace whose plan ended still gets (read-only,
 * 2026-10-27): GET /api/content/usage and GET /api/content/briefs/quota read
 * the counts as reads (plan-guard answers limits of 0 and `noPlan`, not a
 * 402), and GET /api/content/prompts/:promptId/suggestion gives
 * requireFeature `readOnly`, so the prompt's open suggestion still opens.
 */

const getBriefQuotaStatus = vi.fn();
const getContentUsage = vi.fn();
const getOrgIdForUser = vi.fn();
const openOpportunityForPrompt = vi.fn();
// The plan ended: requireFeature refuses with 402 unless the route gave it
// readOnly, as the real one does.
let planEnded = false;
let server;
let baseUrl;

beforeAll(async () => {
  vi.doMock('../lib/planGuard.js', () => ({
    PlanLimitError: class PlanLimitError extends Error {},
    requireFeature: (_feature, options) => (req, res, next) =>
      planEnded && !options?.readOnly ? res.status(402).json({ error: 'plan_limit' }) : next(),
    enforceBriefQuota: vi.fn(),
    getBriefQuotaStatus,
    getContentUsage,
    getOpportunityRequestAllowance: vi.fn(),
    getOrgIdForUser,
  }));
  vi.doMock('../lib/access.js', () => ({
    NOT_IN_WORKSPACE: 'Not in this workspace',
    assertBrandAccess: vi.fn(),
    assertOpportunitiesAccess: vi.fn(),
    assertOpportunityAccess: vi.fn(),
    assertPromptAccess: async () => [{ prompt_sets: { brand_id: 'b1' } }],
  }));
  vi.doMock('../lib/promptContentSuggestion.js', () => ({
    openOpportunityForPrompt,
    promptClusterId: vi.fn(),
    promptSuggestionRequest: vi.fn(),
    runningSuggestionJob: vi.fn(),
  }));
  vi.doMock('../lib/jobManager.js', () => ({ createJob: vi.fn(), getJob: vi.fn() }));
  vi.doMock('../lib/jobRunner.js', () => ({ runContentJob: vi.fn() }));
  vi.doMock('../config/supabase.js', () => ({ default: { from: vi.fn(), rpc: vi.fn() } }));
  vi.doMock('../lib/logger.js', () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() };
    return { default: logger, logger };
  });

  const { default: router } = await import('./content.js');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'u1' };
    req.log = { error: vi.fn(), info: vi.fn() };
    next();
  });
  app.use('/api/content', router);
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/content`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  for (const mod of [
    '../lib/planGuard.js',
    '../lib/access.js',
    '../lib/promptContentSuggestion.js',
    '../lib/jobManager.js',
    '../lib/jobRunner.js',
    '../config/supabase.js',
    '../lib/logger.js',
  ]) {
    vi.doUnmock(mod);
  }
});

beforeEach(() => {
  vi.clearAllMocks();
  planEnded = false;
  getOrgIdForUser.mockResolvedValue('o1');
});

const noPlanCount = { used: 2, limit: 0, remaining: 0, noPlan: true };

describe('GET /usage', () => {
  it('reads the counts as a read, so a plan that ended answers 200', async () => {
    const usage = {
      plan: 'starter',
      planName: 'Starter',
      noPlan: true,
      periodStart: '2026-10-01T00:00:00.000Z',
      periodEnd: '2026-11-01T00:00:00.000Z',
      opportunities: { ...noPlanCount, perRequest: 0 },
      briefs: noPlanCount,
    };
    getContentUsage.mockResolvedValue(usage);
    const res = await fetch(`${baseUrl}/usage`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(usage);
    expect(getContentUsage).toHaveBeenCalledWith('o1', { readOnly: true });
  });
});

describe('GET /briefs/quota', () => {
  it('reads the quota as a read, so a plan that ended answers 200', async () => {
    getBriefQuotaStatus.mockResolvedValue(noPlanCount);
    const res = await fetch(`${baseUrl}/briefs/quota`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(noPlanCount);
    expect(getBriefQuotaStatus).toHaveBeenCalledWith('o1', { readOnly: true });
  });
});

describe('GET /prompts/:promptId/suggestion', () => {
  it("still opens the prompt's suggestion once the plan has ended, but writes none", async () => {
    planEnded = true;
    openOpportunityForPrompt.mockResolvedValue('opp-1');
    const res = await fetch(`${baseUrl}/prompts/p1/suggestion`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ existingId: 'opp-1' });
    expect(openOpportunityForPrompt).toHaveBeenCalledWith('b1', 'p1');

    // Only the read is given readOnly: asking for a new one is refused.
    const suggest = await fetch(`${baseUrl}/prompts/p1/suggest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idempotencyKey: 'key-0001' }),
    });
    expect(suggest.status).toBe(402);
  });
});
