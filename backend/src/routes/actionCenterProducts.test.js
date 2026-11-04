import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

/**
 * Route-level tests for "Send to Action Center" on Product Visibility
 * (ECOM-013): POST /api/action-center/products. The action itself is tested
 * in fromProducts.test.js; here, what the route lets through.
 */

const assertBrandAccess = vi.fn();
const sendProductActions = vi.fn();
// The features the routes ask for, and whether the caller's plan has them.
const featuresAsked = [];
let planHasFeature = true;

let server;
let baseUrl;

async function startApp() {
  vi.resetModules();
  vi.doMock('../config/supabase.js', () => ({ default: {} }));
  vi.doMock('../lib/access.js', () => ({ assertBrandAccess }));
  vi.doMock('../lib/action-center/priorityData.js', () => ({ rescoreActionsForSignal: vi.fn() }));
  vi.doMock('../lib/planGuard.js', () => ({
    PlanLimitError: class extends Error {},
    requireFeature: (feature) => (_req, res, next) => {
      featuresAsked.push(feature);
      if (planHasFeature) return next();
      return res.status(403).json({ success: false, error: 'plan_limit' });
    },
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
  vi.doMock('../lib/action-center/fromProducts.js', () => ({
    MAX_PROMPTS: 50,
    PRODUCT_WORK_TYPES: ['optimize_page', 'create_content', 'get_listed', 'technical'],
    sendProductActions,
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
const PRODUCT = '11111111-0000-0000-0000-000000000001';

const post = (body) =>
  fetch(`${baseUrl}/products`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

beforeEach(async () => {
  assertBrandAccess.mockReset().mockResolvedValue({});
  sendProductActions.mockReset();
  featuresAsked.length = 0;
  planHasFeature = true;
  await startApp();
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe('POST /api/action-center/products', () => {
  const body = {
    brandId: BRAND,
    target: { type: 'product', id: PRODUCT },
    work: [{ type: 'optimize_page', who: 'agent', why: 'Fit and weight in the title' }],
    promptIds: ['44444444-4444-4444-4444-444444444444'],
  };

  it('sends the product with its work for a member of the brand, 201 when it opened one', async () => {
    sendProductActions.mockResolvedValue({ actionId: 'a1', actionNo: 301, created: true });
    const res = await post(body);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ actionId: 'a1', actionNo: 301, created: true });
    expect(assertBrandAccess).toHaveBeenCalledWith(BRAND, 'u1');
    expect(sendProductActions).toHaveBeenCalledWith(BRAND, {
      target: body.target,
      work: body.work,
      promptIds: body.promptIds,
      userId: 'u1',
    });
  });

  it('answers 200 with the action already open', async () => {
    sendProductActions.mockResolvedValue({ actionId: 'a0', actionNo: 299, created: false });
    expect((await post(body)).status).toBe(200);
  });

  it('refuses no work, an unknown work type or target, and passes the not-found status on', async () => {
    expect((await post({ ...body, work: [] })).status).toBe(400);
    expect((await post({ ...body, work: [{ type: 'teleport', who: 'me' }] })).status).toBe(400);
    expect((await post({ ...body, target: { type: 'brand', id: PRODUCT } })).status).toBe(400);
    expect(sendProductActions).not.toHaveBeenCalled();
    sendProductActions.mockRejectedValue(
      Object.assign(new Error('Product not found'), { status: 404 }),
    );
    expect((await post(body)).status).toBe(404);
  });

  it("refuses a caller outside the brand's organization, with the code", async () => {
    assertBrandAccess.mockRejectedValue(
      Object.assign(new Error("This brand isn't in your workspace"), {
        status: 403,
        code: 'not_in_workspace',
      }),
    );
    const res = await post(body);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'not_in_workspace' });
    expect(sendProductActions).not.toHaveBeenCalled();
  });

  it('refuses a plan without Product Visibility (shopping_analytics), and passes on a 422 for work with no task', async () => {
    planHasFeature = false;
    expect((await post(body)).status).toBe(403);
    expect(featuresAsked).toEqual(['shopping_analytics']);
    expect(sendProductActions).not.toHaveBeenCalled();

    planHasFeature = true;
    sendProductActions.mockRejectedValue(
      Object.assign(new Error('None of the work picked has a task to plan for this brand.'), {
        status: 422,
      }),
    );
    const res = await post(body);
    expect(res.status).toBe(422);
    expect((await res.json()).details).toBe(
      'None of the work picked has a task to plan for this brand.',
    );
  });
});
