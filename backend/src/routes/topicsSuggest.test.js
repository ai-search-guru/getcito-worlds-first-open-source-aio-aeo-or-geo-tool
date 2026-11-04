import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { BRAND_SETUP_LIMITS, promptsFromTopicsSchema } from '../lib/brandSetupInput.js';

/**
 * POST /api/topics/suggest: the topics setup offers come back short enough
 * for /prompts/from-topics to take, whatever length the model gave them
 * (#1611 follow-up). The model is a stub; its research and structuring are
 * the route's only calls.
 */

const generateObject = vi.fn();

let server;
let baseUrl;

async function startApp() {
  vi.resetModules();
  vi.doMock('ai', () => ({ generateObject }));
  // Generating topic ideas is a manager's (2026-10-29): the caller is one here.
  vi.doMock('../lib/access.js', () => ({
    MANAGER_ROLES: ['admin', 'manager'],
    assertBrandAccess: vi.fn(),
    assertRole: vi.fn(async () => 'manager'),
  }));
  vi.doMock('../lib/action-center/fromTopicOpportunity.js', () => ({
    sendTopicOpportunityToActionCenter: vi.fn(),
  }));
  vi.doMock('../lib/action-center/fromTopicGap.js', () => ({
    sendTopicGapToActionCenter: vi.fn(),
  }));
  vi.doMock('../lib/planGuard.js', () => ({ requireFeature: () => (req, res, next) => next() }));
  vi.doMock('../lib/aiProvider.js', () => ({ resolveModel: vi.fn() }));
  vi.doMock('../lib/webResearch.js', () => ({
    webResearch: vi.fn(async () => ({ text: 'research', searched: true, sources: [] })),
  }));
  vi.doMock('../lib/logger.js', () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() };
    return { default: logger, logger };
  });
  vi.doMock('../config/supabase.js', () => ({ default: { from: vi.fn() } }));

  const { default: router } = await import('./topics.js');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'u1' };
    req.log = { error: vi.fn(), info: vi.fn() };
    next();
  });
  app.use('/api/topics', router);

  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/topics`;
}

const suggest = (body) =>
  fetch(`${baseUrl}/suggest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

beforeEach(async () => {
  vi.clearAllMocks();
  await startApp();
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe('POST /api/topics/suggest', () => {
  it('cuts a topic name longer than a prompts call takes at a word, and drops an empty one', async () => {
    const long =
      'Best specialty coffee subscription services for remote teams, offices, and coworking spaces across Europe';
    generateObject.mockResolvedValue({
      object: {
        topics: [{ name: 'Coffee subscriptions' }, { name: long }, { name: '   ' }],
      },
    });

    const res = await suggest({ brandName: 'Acme Coffee', website: 'acme.com' });

    expect(res.status).toBe(200);
    const { topics } = await res.json();
    const names = topics.map((topic) => topic.name);
    expect(names).toEqual([
      'Coffee subscriptions',
      'Best specialty coffee subscription services for remote teams, offices, and coworking spaces across',
    ]);
    expect(long.length).toBeGreaterThan(BRAND_SETUP_LIMITS.topic);
    // Every one chosen can ask for its prompts.
    expect(
      promptsFromTopicsSchema.safeParse({ brandName: 'Acme Coffee', topics: names }).success,
    ).toBe(true);
  });
});
