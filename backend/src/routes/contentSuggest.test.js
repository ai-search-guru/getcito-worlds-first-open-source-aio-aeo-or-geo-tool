import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

/**
 * Route-level tests for "Suggest content" from the prompts table (PROMPT-006).
 *
 * The helpers are tested on their own; what only shows up here is the order
 * the route checks things in, which decides whether a click spends the
 * month's quota and whether the same opportunity can be written twice: a
 * repeated request, a job still running for the prompt and an open
 * opportunity all come before the quota, and only then is a job started.
 */

class PlanLimitError extends Error {
  constructor(message, statusCode = 403) {
    super(message);
    this.name = 'PlanLimitError';
    this.statusCode = statusCode;
  }
}

const assertPromptAccess = vi.fn();
const assertBrandAccess = vi.fn();
const getOpportunityRequestAllowance = vi.fn();
const createJob = vi.fn();
const runContentJob = vi.fn();
const openOpportunityForPrompt = vi.fn();
const runningSuggestionJob = vi.fn();
const loadNeedAvailability = vi.fn();
let previousJob = null;

let server;
let baseUrl;

async function startApp() {
  vi.resetModules();
  vi.doMock('../lib/planGuard.js', () => ({
    PlanLimitError,
    requireFeature: () => (req, res, next) => next(),
    enforceBriefQuota: vi.fn(),
    getBriefQuotaStatus: vi.fn(),
    getContentUsage: vi.fn(),
    getOpportunityRequestAllowance,
    getOrgIdForUser: vi.fn(),
  }));
  vi.doMock('../lib/access.js', () => ({
    MANAGER_ROLES: ['admin', 'manager'],
    assertBrandAccess,
    assertOpportunitiesAccess: vi.fn(),
    assertOpportunityAccess: vi.fn(),
    assertPromptAccess,
    // Generating is a manager's (2026-10-29): the caller is one here.
    assertRole: vi.fn(async () => 'manager'),
  }));
  vi.doMock('../lib/jobManager.js', () => ({ createJob, getJob: vi.fn() }));
  vi.doMock('../lib/jobRunner.js', () => ({ runContentJob }));
  vi.doMock('../lib/promptContentSuggestion.js', async () => {
    const actual = await vi.importActual('../lib/promptContentSuggestion.js');
    return { ...actual, openOpportunityForPrompt, runningSuggestionJob };
  });
  // The idempotency lookup (startedJob) is the only table the route reads.
  vi.doMock('../config/supabase.js', () => {
    const chain = new Proxy(
      {},
      {
        get: (_t, op) =>
          op === 'maybeSingle' ? async () => ({ data: previousJob, error: null }) : () => chain,
      },
    );
    return { default: { from: () => chain } };
  });
  vi.doMock('../lib/promptClusters.js', () => ({ loadClusters: vi.fn() }));
  vi.doMock('../lib/opportunityAvailability.js', () => ({ loadNeedAvailability }));
  vi.doMock('../lib/action-center/fromOpportunity.js', () => ({ sendToActionCenter: vi.fn() }));
  vi.doMock('../lib/aiProvider.js', () => ({ resolveModel: vi.fn() }));
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
  app.set('io', null);
  app.use('/api/content', router);

  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/content`;
}

const suggest = () =>
  fetch(`${baseUrl}/prompts/p1/suggest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idempotencyKey: 'key-123456' }),
  });

const allowance = (max) => ({ perRequest: 3, remaining: max, max, periodEnd: null, planId: 'x' });

beforeEach(async () => {
  vi.clearAllMocks();
  previousJob = null;
  assertPromptAccess.mockResolvedValue([
    { id: 'p1', prompt_sets: { brand_id: 'b1', brands: { organization_id: 'org1' } } },
  ]);
  assertBrandAccess.mockResolvedValue({ orgId: 'org1' });
  runningSuggestionJob.mockResolvedValue(null);
  openOpportunityForPrompt.mockResolvedValue(null);
  getOpportunityRequestAllowance.mockResolvedValue(allowance(3));
  createJob.mockResolvedValue({ id: 'job-new' });
  await startApp();
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe('POST /prompts/:promptId/suggest', () => {
  it('starts one prompt-tagged opportunity against the quota', async () => {
    const res = await suggest();

    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ jobId: 'job-new' });
    expect(getOpportunityRequestAllowance).toHaveBeenCalledWith('org1');
    expect(createJob).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'content',
        brandId: 'b1',
        data: expect.objectContaining({
          request: expect.objectContaining({
            count: 1,
            promptId: 'p1',
            explicit: true,
            source: 'prompt',
          }),
        }),
      }),
    );
    expect(runContentJob).toHaveBeenCalledWith('job-new', null);
  });

  it('offers the open opportunity even when the quota is used up', async () => {
    openOpportunityForPrompt.mockResolvedValue('opp-1');
    getOpportunityRequestAllowance.mockResolvedValue(allowance(0));

    const res = await suggest();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ existingId: 'opp-1' });
    expect(getOpportunityRequestAllowance).not.toHaveBeenCalled();
    expect(createJob).not.toHaveBeenCalled();
  });

  it('follows a job still running for the prompt instead of starting another', async () => {
    runningSuggestionJob.mockResolvedValue('job-running');

    const res = await suggest();

    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ jobId: 'job-running' });
    expect(openOpportunityForPrompt).not.toHaveBeenCalled();
    expect(createJob).not.toHaveBeenCalled();
  });

  it('returns the job a repeated request already started', async () => {
    previousJob = { id: 'job-before', data: {} };

    const res = await suggest();

    expect(await res.json()).toEqual({ jobId: 'job-before' });
    expect(runningSuggestionJob).not.toHaveBeenCalled();
    expect(createJob).not.toHaveBeenCalled();
  });

  it('refuses with quota_exhausted when nothing is left and nothing is open', async () => {
    getOpportunityRequestAllowance.mockResolvedValue(allowance(0));

    const res = await suggest();

    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ error: 'quota_exhausted' });
    expect(createJob).not.toHaveBeenCalled();
  });

  it("stops at the access check for someone else's prompt", async () => {
    assertPromptAccess.mockRejectedValue(Object.assign(new Error('Unauthorized'), { status: 403 }));

    const res = await suggest();

    expect(res.status).toBe(403);
    expect(createJob).not.toHaveBeenCalled();
  });
});

describe('GET /prompts/:promptId/suggestion', () => {
  it("names the prompt's open opportunity", async () => {
    openOpportunityForPrompt.mockResolvedValue('opp-1');

    const res = await fetch(`${baseUrl}/prompts/p1/suggestion`);

    expect(await res.json()).toEqual({ existingId: 'opp-1' });
    expect(openOpportunityForPrompt).toHaveBeenCalledWith('b1', 'p1');
  });
});

describe('POST /opportunities/generate for one page (AT-006 part B3)', () => {
  const BRAND = '33333333-3333-3333-3333-333333333333';
  const generate = (body) =>
    fetch(`${baseUrl}/opportunities/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brandId: BRAND, idempotencyKey: 'key-page-1', ...body }),
    });

  it("starts one opportunity for the page, whatever count it's sent with", async () => {
    const res = await generate({ count: 3, pagePath: '/gifts' });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ jobId: 'job-new', count: 1 });
    expect(createJob).toHaveBeenCalledWith(
      expect.objectContaining({
        brandId: BRAND,
        data: expect.objectContaining({
          request: expect.objectContaining({ count: 1, pagePath: '/gifts' }),
        }),
      }),
    );
  });

  it('takes a path, not a URL, and spends nothing when the month is used up', async () => {
    expect((await generate({ count: 1, pagePath: 'https://acme.example/gifts' })).status).toBe(400);
    getOpportunityRequestAllowance.mockResolvedValue(allowance(0));
    expect((await generate({ count: 1, pagePath: '/gifts' })).status).toBe(429);
    expect(createJob).not.toHaveBeenCalled();
  });
});

describe('POST /opportunities/generate with a focus (CONTENT-003)', () => {
  const BRAND = '33333333-3333-3333-3333-333333333333';
  const TOPIC = '44444444-4444-4444-4444-444444444444';
  const PROMPT = '55555555-5555-5555-5555-555555555555';
  const generate = (body) =>
    fetch(`${baseUrl}/opportunities/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brandId: BRAND, idempotencyKey: 'key-focus-1', ...body }),
    });
  const request = () => createJob.mock.calls[0][0].data.request;

  it('asks for a picked prompt on purpose, as its own Suggest content does', async () => {
    expect((await generate({ count: 1, promptId: PROMPT })).status).toBe(202);
    expect(request()).toMatchObject({ promptId: PROMPT, explicit: true });
  });

  it("leaves a topic's or GetCito's own choice to the usual rules", async () => {
    expect((await generate({ count: 3, topicId: TOPIC })).status).toBe(202);
    expect(request()).toMatchObject({ topicId: TOPIC, explicit: false });
  });
});

describe('GET /brand/:brandId/availability', () => {
  it("returns what New can still write for, after checking the caller's access", async () => {
    const availability = {
      needs: 3,
      open: 1,
      covered: 2,
      noAnswers: 0,
      topics: { t1: { open: 1, covered: 2, noAnswers: 0 } },
      promptOpportunity: { p1: 'o1' },
    };
    loadNeedAvailability.mockResolvedValue(availability);
    const res = await fetch(`${baseUrl}/brand/b1/availability`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(availability);
    expect(assertBrandAccess).toHaveBeenCalledWith('b1', 'u1');
    expect(loadNeedAvailability).toHaveBeenCalledWith('b1');
  });

  it("reads nothing for a brand the caller can't see", async () => {
    assertBrandAccess.mockRejectedValueOnce(
      Object.assign(new Error('Brand not found'), { status: 404 }),
    );
    const res = await fetch(`${baseUrl}/brand/b2/availability`);
    expect(res.status).toBe(404);
    expect(loadNeedAvailability).not.toHaveBeenCalled();
  });
});
