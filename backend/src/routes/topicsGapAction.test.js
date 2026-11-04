import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

/**
 * Route-level tests for "Send biggest gap to Actions" (VIS-010):
 * POST /api/topics/:id/gap-action. The action itself is tested in
 * fromTopicGap.test.js; what shows up only here is what the route lets
 * through: ids in the format seeded data uses, a body that matches, a topic
 * that exists, and a caller from the topic's organization.
 */

const assertBrandAccess = vi.fn();
const sendTopicGapToActionCenter = vi.fn();
let topicRow = null;

let server;
let baseUrl;

async function startApp() {
  vi.resetModules();
  vi.doMock('../lib/access.js', () => ({ assertBrandAccess }));
  vi.doMock('../lib/action-center/fromTopicGap.js', () => ({ sendTopicGapToActionCenter }));
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
const COMPETITOR = '99999999-9999-9999-9999-999999999901';

const post = (topicId, body) =>
  fetch(`${baseUrl}/${topicId}/gap-action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

beforeEach(async () => {
  vi.clearAllMocks();
  topicRow = { id: TOPIC, name: 'AI Rank Tracker', brand_id: 'b1' };
  assertBrandAccess.mockResolvedValue({});
  sendTopicGapToActionCenter.mockResolvedValue({ actionId: 'a1', actionNo: 61, created: true });
  await startApp();
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe('POST /api/topics/:id/gap-action', () => {
  it('sends the topic with the heat map’s window and filters', async () => {
    const res = await post(TOPIC, {
      competitorId: COMPETITOR,
      dayFrom: '2026-09-15',
      dayTo: '2026-10-14',
      models: ['gpt-4o'],
      region: 'US',
    });

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ actionId: 'a1', actionNo: 61, created: true });
    expect(assertBrandAccess).toHaveBeenCalledWith('b1', 'u1');
    expect(sendTopicGapToActionCenter).toHaveBeenCalledWith(topicRow, {
      competitorId: COMPETITOR,
      dayFrom: '2026-09-15',
      dayTo: '2026-10-14',
      models: ['gpt-4o'],
      region: 'US',
      userId: 'u1',
    });
  });

  it('answers 200 with the open action when it was already sent', async () => {
    sendTopicGapToActionCenter.mockResolvedValue({ actionId: 'a0', actionNo: 58, created: false });
    const res = await post(TOPIC, { competitorId: COMPETITOR });
    expect(res.status).toBe(200);
  });

  it('rejects a malformed topic id or body before reading anything', async () => {
    expect((await post('not-an-id', { competitorId: COMPETITOR })).status).toBe(400);
    expect((await post(TOPIC, { competitorId: 'nope' })).status).toBe(400);
    expect((await post(TOPIC, { competitorId: COMPETITOR, dayFrom: 'Sep 15' })).status).toBe(400);
    expect(assertBrandAccess).not.toHaveBeenCalled();
    expect(sendTopicGapToActionCenter).not.toHaveBeenCalled();
  });

  it('answers 404 for a topic that does not exist', async () => {
    topicRow = null;
    expect((await post(TOPIC, { competitorId: COMPETITOR })).status).toBe(404);
    expect(sendTopicGapToActionCenter).not.toHaveBeenCalled();
  });

  it('refuses a caller from another organization', async () => {
    assertBrandAccess.mockRejectedValue(Object.assign(new Error('Unauthorized'), { status: 403 }));
    expect((await post(TOPIC, { competitorId: COMPETITOR })).status).toBe(403);
    expect(sendTopicGapToActionCenter).not.toHaveBeenCalled();
  });

  it('passes the action’s own status through, e.g. a gap that closed', async () => {
    sendTopicGapToActionCenter.mockRejectedValue(
      Object.assign(new Error('The competitor does not lead this topic'), { status: 409 }),
    );
    const res = await post(TOPIC, { competitorId: COMPETITOR });
    expect(res.status).toBe(409);
    expect((await res.json()).details).toBe('The competitor does not lead this topic');
  });
});
