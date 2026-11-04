import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

/**
 * Route-level tests for an Opportunities topic's "Send action" (VIS-011):
 * POST /api/topics/:id/opportunity-action. The action itself is tested in
 * fromTopicOpportunity.test.js; what shows up only here is what the route
 * lets through: ids in the format seeded data uses, a body that matches, a
 * topic that exists, and a caller from the topic's organization.
 */

const assertBrandAccess = vi.fn();
const sendTopicOpportunityToActionCenter = vi.fn();
let topicRow = null;

let server;
let baseUrl;

async function startApp() {
  vi.resetModules();
  vi.doMock('../lib/access.js', () => ({ assertBrandAccess }));
  vi.doMock('../lib/action-center/fromTopicOpportunity.js', () => ({
    sendTopicOpportunityToActionCenter,
  }));
  vi.doMock('../lib/action-center/fromTopicGap.js', () => ({
    sendTopicGapToActionCenter: vi.fn(),
  }));
  vi.doMock('../lib/planGuard.js', () => ({ requireFeature: () => (req, res, next) => next() }));
  vi.doMock('../lib/aiProvider.js', () => ({ resolveModel: vi.fn() }));
  vi.doMock('../lib/webResearch.js', () => ({ webResearch: vi.fn() }));
  vi.doMock('../lib/logger.js', () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() };
    return { default: logger, logger };
  });
  // The topic lookup is the only table the route reads.
  vi.doMock('../config/supabase.js', () => {
    const chain = new Proxy(
      {},
      {
        get: (_t, op) =>
          op === 'maybeSingle' ? async () => ({ data: topicRow, error: null }) : () => chain,
      },
    );
    return { default: { from: () => chain } };
  });

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

// Seeded ids aren't RFC 4122 versions; the route must still take them.
const TOPIC = '77777777-7777-7777-7777-777777777701';
const SUGGESTION = '88888888-8888-8888-8888-888888888801';

const post = (topicId, body) =>
  fetch(`${baseUrl}/${topicId}/opportunity-action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

beforeEach(async () => {
  vi.clearAllMocks();
  topicRow = { id: TOPIC, name: 'GEO tools for agencies', brand_id: 'b1' };
  assertBrandAccess.mockResolvedValue({});
  sendTopicOpportunityToActionCenter.mockResolvedValue({
    actionId: 'a1',
    actionNo: 62,
    created: true,
  });
  await startApp();
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe('POST /api/topics/:id/opportunity-action', () => {
  it('sends the topic with its suggestions', async () => {
    const res = await post(TOPIC, { suggestionIds: [SUGGESTION] });

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ actionId: 'a1', actionNo: 62, created: true });
    expect(assertBrandAccess).toHaveBeenCalledWith('b1', 'u1');
    expect(sendTopicOpportunityToActionCenter).toHaveBeenCalledWith(topicRow, {
      suggestionIds: [SUGGESTION],
      userId: 'u1',
    });
  });

  it('answers 200 with the open action when it was already sent', async () => {
    sendTopicOpportunityToActionCenter.mockResolvedValue({
      actionId: 'a0',
      actionNo: 59,
      created: false,
    });
    expect((await post(TOPIC, { suggestionIds: [SUGGESTION] })).status).toBe(200);
  });

  it('rejects a malformed topic id or body before reading anything', async () => {
    const tooMany = Array.from({ length: 26 }, () => SUGGESTION);
    expect((await post('not-an-id', { suggestionIds: [SUGGESTION] })).status).toBe(400);
    expect((await post(TOPIC, { suggestionIds: [] })).status).toBe(400);
    expect((await post(TOPIC, { suggestionIds: ['nope'] })).status).toBe(400);
    expect((await post(TOPIC, { suggestionIds: tooMany })).status).toBe(400);
    expect(assertBrandAccess).not.toHaveBeenCalled();
    expect(sendTopicOpportunityToActionCenter).not.toHaveBeenCalled();
  });

  it('answers 404 for a topic that does not exist', async () => {
    topicRow = null;
    expect((await post(TOPIC, { suggestionIds: [SUGGESTION] })).status).toBe(404);
    expect(sendTopicOpportunityToActionCenter).not.toHaveBeenCalled();
  });

  it('refuses a caller from another organization', async () => {
    assertBrandAccess.mockRejectedValue(Object.assign(new Error('Unauthorized'), { status: 403 }));
    expect((await post(TOPIC, { suggestionIds: [SUGGESTION] })).status).toBe(403);
    expect(sendTopicOpportunityToActionCenter).not.toHaveBeenCalled();
  });

  it('passes the action’s own status through, e.g. suggestions already handled', async () => {
    sendTopicOpportunityToActionCenter.mockRejectedValue(
      Object.assign(new Error('No open suggestions for this topic'), { status: 409 }),
    );
    const res = await post(TOPIC, { suggestionIds: [SUGGESTION] });
    expect(res.status).toBe(409);
    expect((await res.json()).details).toBe('No open suggestions for this topic');
  });
});
