import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

/**
 * Route-level tests for "Send to Action Center" on the AI Traffic page's
 * Pages section (AT-006): POST /api/action-center/pages. The action itself
 * is tested in fromTrafficPages.test.js; what shows up only here is what
 * the route lets through: ids in the format seeded data uses, paths, a list
 * it knows, the page's range, and a caller from the brand's organization.
 */

const assertBrandAccess = vi.fn();
const sendTrafficPagesToActionCenter = vi.fn();

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
    sendTrafficPagesToActionCenter,
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
const FROM = '2026-09-18T12:00:00.000Z';
const TO = '2026-10-18T12:00:00.000Z';

const post = (body) =>
  fetch(`${baseUrl}/pages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

beforeEach(async () => {
  assertBrandAccess.mockReset().mockResolvedValue({});
  sendTrafficPagesToActionCenter.mockReset();
  await startApp();
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe('POST /api/action-center/pages', () => {
  it('sends the pages for a member and says whether it was created', async () => {
    sendTrafficPagesToActionCenter.mockResolvedValue({
      actionId: 'a1',
      actionNo: 71,
      created: true,
    });
    const body = {
      brandId: BRAND,
      pages: ['/shop/beans', '/'],
      reason: 'cited_not_clicked',
      from: FROM,
      to: TO,
    };
    const res = await post(body);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ actionId: 'a1', actionNo: 71, created: true });
    expect(assertBrandAccess).toHaveBeenCalledWith(BRAND, 'u1');
    expect(sendTrafficPagesToActionCenter).toHaveBeenCalledWith(BRAND, {
      pages: ['/shop/beans', '/'],
      reason: 'cited_not_clicked',
      from: FROM,
      to: TO,
      userId: 'u1',
    });

    // All time has no range; the same pages again find the open action.
    sendTrafficPagesToActionCenter.mockResolvedValue({
      actionId: 'a1',
      actionNo: 71,
      created: false,
    });
    expect((await post({ brandId: BRAND, pages: ['/'], reason: 'no_ai_traffic' })).status).toBe(
      200,
    );
  });

  it('rejects a body without pages, with URLs, too many pages or another list', async () => {
    expect((await post({ brandId: BRAND, pages: [], reason: 'no_ai_traffic' })).status).toBe(400);
    expect(
      (
        await post({
          brandId: BRAND,
          pages: ['https://acme.example/menu'],
          reason: 'no_ai_traffic',
        })
      ).status,
    ).toBe(400);
    expect(
      (await post({ brandId: BRAND, pages: Array(51).fill('/a'), reason: 'no_ai_traffic' })).status,
    ).toBe(400);
    expect((await post({ brandId: BRAND, pages: ['/'], reason: 'all' })).status).toBe(400);
    expect((await post({ brandId: 'nope', pages: ['/'], reason: 'no_ai_traffic' })).status).toBe(
      400,
    );
    expect(
      (await post({ brandId: BRAND, pages: ['/'], reason: 'no_ai_traffic', from: 'last week' }))
        .status,
    ).toBe(400);
    expect(sendTrafficPagesToActionCenter).not.toHaveBeenCalled();
  });

  it("takes a custom range's first day as the page sends it", async () => {
    sendTrafficPagesToActionCenter.mockResolvedValue({
      actionId: 'a1',
      actionNo: 71,
      created: true,
    });
    const res = await post({
      brandId: BRAND,
      pages: ['/'],
      reason: 'no_ai_traffic',
      from: '2026-10-01',
      to: '2026-10-11T23:59:59.999Z',
    });
    expect(res.status).toBe(201);
    expect(sendTrafficPagesToActionCenter).toHaveBeenCalledWith(
      BRAND,
      expect.objectContaining({ from: '2026-10-01', to: '2026-10-11T23:59:59.999Z' }),
    );
  });

  it('refuses a caller outside the brand’s organization, with the code', async () => {
    assertBrandAccess.mockRejectedValue(
      Object.assign(new Error("This brand isn't in your workspace"), {
        status: 403,
        code: 'not_in_workspace',
      }),
    );
    const res = await post({ brandId: BRAND, pages: ['/'], reason: 'no_ai_traffic' });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'not_in_workspace' });
    expect(sendTrafficPagesToActionCenter).not.toHaveBeenCalled();
  });

  it('says why when no page is on the list any more', async () => {
    sendTrafficPagesToActionCenter.mockRejectedValue(
      Object.assign(new Error('None of these pages are on the list for this range'), {
        status: 404,
      }),
    );
    const res = await post({ brandId: BRAND, pages: ['/menu'], reason: 'cited_not_clicked' });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: 'Failed to send to the Action Center',
      details: 'None of these pages are on the list for this range',
    });
  });
});
