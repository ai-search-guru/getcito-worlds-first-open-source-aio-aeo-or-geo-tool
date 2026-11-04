import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

/**
 * Route-level tests for "Team" in the Content Editor's Start (CE-015):
 * POST /api/action-center/content-drafts. The action itself is tested in
 * fromContentDraft.test.js; here, what the route lets through: ids in the
 * format seeded data uses, and a caller from the brand's organization.
 */

const assertBrandAccess = vi.fn();
const sendContentDraftToActionCenter = vi.fn();

let server;
let baseUrl;

async function startApp() {
  vi.resetModules();
  vi.doMock('../config/supabase.js', () => ({ default: {} }));
  vi.doMock('../lib/access.js', () => ({ assertBrandAccess }));
  vi.doMock('../lib/action-center/priorityData.js', () => ({ rescoreActionsForSignal: vi.fn() }));
  vi.doMock('../lib/planGuard.js', () => ({
    PlanLimitError: class extends Error {},
    requireFeature: () => (_req, _res, next) => next(),
  }));
  vi.doMock('../lib/action-center/task-writer/index.js', () => ({
    TaskWriterError: class extends Error {},
    isTaskWriterEnabled: () => false,
    writeTasksForAction: vi.fn(),
  }));
  vi.doMock('../lib/action-center/taskSend.js', () => ({
    TaskSendError: class extends Error {},
    loadTask: vi.fn(),
    sendTaskToContent: vi.fn(),
    sendTaskToWebhook: vi.fn(),
  }));
  vi.doMock('../lib/action-center/fromTrafficPages.js', () => ({
    MAX_TRAFFIC_PAGES: 50,
    TRAFFIC_PAGE_REASONS: ['cited_not_clicked', 'no_ai_traffic'],
    sendTrafficPagesToActionCenter: vi.fn(),
  }));
  vi.doMock('../lib/action-center/fromContentDraft.js', () => ({
    sendContentDraftToActionCenter,
  }));

  const { default: router } = await import('./actionCenter.js');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'u1' };
    req.log = { error: vi.fn(), info: vi.fn() };
    next();
  });
  app.use('/api/action-center', router);

  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/action-center`;
}

// Seeded ids aren't RFC 4122 versions; the route must still take them.
const BRAND = '33333333-3333-3333-3333-333333333333';
const DRAFT = '44444444-4444-4444-4444-444444444444';

const post = (body) =>
  fetch(`${baseUrl}/content-drafts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

beforeEach(async () => {
  assertBrandAccess.mockReset().mockResolvedValue({});
  sendContentDraftToActionCenter.mockReset();
  await startApp();
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe('POST /api/action-center/content-drafts', () => {
  it('sends the draft for a member and says whether it was created', async () => {
    sendContentDraftToActionCenter.mockResolvedValue({
      actionId: 'a1',
      actionNo: 214,
      created: true,
    });
    const res = await post({ brandId: BRAND, draftId: DRAFT });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ actionId: 'a1', actionNo: 214, created: true });
    expect(assertBrandAccess).toHaveBeenCalledWith(BRAND, 'u1');
    expect(sendContentDraftToActionCenter).toHaveBeenCalledWith(BRAND, {
      draftId: DRAFT,
      userId: 'u1',
    });

    sendContentDraftToActionCenter.mockResolvedValue({
      actionId: 'a1',
      actionNo: 214,
      created: false,
    });
    expect((await post({ brandId: BRAND, draftId: DRAFT })).status).toBe(200);
  });

  it('rejects a body without ids, and a caller outside the brand', async () => {
    expect((await post({ brandId: BRAND })).status).toBe(400);
    expect((await post({ brandId: 'nope', draftId: DRAFT })).status).toBe(400);
    expect(sendContentDraftToActionCenter).not.toHaveBeenCalled();

    assertBrandAccess.mockRejectedValue(
      Object.assign(new Error("You don't have access to this brand"), {
        status: 403,
        code: 'no_brand_access',
      }),
    );
    const refused = await post({ brandId: BRAND, draftId: DRAFT });
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ code: 'no_brand_access' });
    expect(sendContentDraftToActionCenter).not.toHaveBeenCalled();
  });

  it('passes on a draft the brand doesn’t have', async () => {
    sendContentDraftToActionCenter.mockRejectedValue(
      Object.assign(new Error('Draft not found'), { status: 404 }),
    );
    expect((await post({ brandId: BRAND, draftId: DRAFT })).status).toBe(404);
  });
});
