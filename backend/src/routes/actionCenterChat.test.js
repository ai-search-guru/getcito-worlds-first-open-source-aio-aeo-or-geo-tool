import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

/**
 * Route-level tests for Send to Action Center from Chat (CHAT-09 §E):
 * POST /api/action-center/chat-actions and its duplicate check,
 * /chat-actions/check. The action itself is tested in fromChat.test.js;
 * here, who may call them (the brand's organization, Admins and Managers)
 * and how they answer: 201 created, 200 the same approval again, 409
 * duplicate with the action that covers it and whether Create anyway may go.
 */

const assertBrandAccess = vi.fn();
const assertRole = vi.fn();
const sendChatAction = vi.fn();
const findCoveringActions = vi.fn();

let server;
let baseUrl;

async function startApp() {
  vi.resetModules();
  vi.doMock('../config/supabase.js', () => ({ default: {} }));
  vi.doMock('../lib/access.js', () => ({
    MANAGER_ROLES: ['admin', 'manager'],
    assertBrandAccess,
    assertRole,
  }));
  vi.doMock('../lib/action-center/priorityData.js', () => ({
    rescoreActionsForSignal: vi.fn(),
    priorityOnCreate: vi.fn(),
  }));
  vi.doMock('../lib/planGuard.js', () => ({
    PlanLimitError: class extends Error {},
    requireFeature: () => (_req, _res, next) => next(),
  }));
  vi.doMock('../lib/action-center/task-writer/index.js', () => ({
    TaskWriterError: class extends Error {},
    isTaskWriterEnabled: () => false,
    writeTasksForAction: vi.fn(),
  }));
  vi.doMock('../lib/action-center/fromChat.js', async (importOriginal) => ({
    ...(await importOriginal()),
    sendChatAction,
    findCoveringActions,
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

// Seeded ids aren't RFC 4122 versions; the routes must still take them.
const BRAND = '33333333-3333-3333-3333-333333333333';
const PROMPT = '55555555-5555-5555-5555-555555555555';

const post = (path, body) =>
  fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

const proposal = {
  title: 'Win back pricing citations',
  category: 'recover',
  why: 'Google AI Overviews stopped citing /pricing.',
  entities: { prompts: [PROMPT], pages: ['/pricing'] },
  tasks: [
    {
      title: 'Add a pricing FAQ block to /pricing',
      type: 'on_page',
      url: '/pricing',
      done_when: 'The FAQ block is live',
    },
  ],
};

const refusal = (message, status, code, extra) =>
  Object.assign(new Error(message), { status, code, ...(extra ? { extra } : {}) });

beforeEach(async () => {
  assertBrandAccess.mockReset().mockResolvedValue({});
  assertRole.mockReset().mockResolvedValue('manager');
  sendChatAction.mockReset();
  findCoveringActions.mockReset();
  await startApp();
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe('POST /api/action-center/chat-actions', () => {
  const body = {
    brandId: BRAND,
    proposal,
    conversationId: '66666666-6666-6666-6666-666666666666',
    runId: '77777777-7777-7777-7777-777777777777',
    executionMode: 'automated',
    idempotencyKey: 'chat:step-1',
  };

  it('creates for an Admin or Manager of the brand: 201, and 200 for the same approval again', async () => {
    sendChatAction.mockResolvedValueOnce({ actionId: 'a1', actionNo: 1300, created: true });
    const res = await post('/chat-actions', body);
    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toEqual({ actionId: 'a1', actionNo: 1300, created: true });
    expect(assertBrandAccess).toHaveBeenCalledWith(BRAND, 'u1');
    expect(assertRole).toHaveBeenCalledWith(
      'u1',
      ['admin', 'manager'],
      'Only admins and managers can send findings to the Action Center.',
    );
    expect(sendChatAction).toHaveBeenCalledWith(BRAND, {
      proposal: expect.objectContaining({ title: 'Win back pricing citations', impact: 'medium' }),
      conversationId: body.conversationId,
      runId: body.runId,
      executionMode: 'automated',
      idempotencyKey: 'chat:step-1',
      createAnyway: false,
      userId: 'u1',
    });

    sendChatAction.mockResolvedValueOnce({ actionId: 'a1', actionNo: 1300, created: false });
    expect((await post('/chat-actions', body)).status).toBe(200);
  });

  it('answers a duplicate with the action that covers it', async () => {
    sendChatAction.mockRejectedValueOnce(
      refusal('AC-1258 already covers this.', 409, 'duplicate', {
        action: { id: 'a0', no: 1258, title: null, covers: 'some' },
        canCreateAnyway: true,
      }),
    );
    const res = await post('/chat-actions', body);
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({
      error: 'Failed to send to the Action Center',
      details: 'AC-1258 already covers this.',
      code: 'duplicate',
      action: { id: 'a0', no: 1258, title: null, covers: 'some' },
      canCreateAnyway: true,
    });
  });

  it('refuses an Analyst, and a brand of another workspace, before anything is made', async () => {
    assertRole.mockRejectedValueOnce(refusal('Only admins and managers…', 403, 'forbidden'));
    expect((await post('/chat-actions', body)).status).toBe(403);
    assertBrandAccess.mockRejectedValueOnce(refusal("This brand isn't in your workspace", 403));
    expect((await post('/chat-actions', body)).status).toBe(403);
    expect(sendChatAction).not.toHaveBeenCalled();
  });

  it('refuses a proposal its schema does not take', async () => {
    const bad = await post('/chat-actions', {
      ...body,
      proposal: { ...proposal, category: 'urgent', tasks: [] },
    });
    expect(bad.status).toBe(400);
    await expect(bad.json()).resolves.toMatchObject({ code: 'invalid' });
    expect((await post('/chat-actions', { ...body, idempotencyKey: '' })).status).toBe(400);
    expect(sendChatAction).not.toHaveBeenCalled();
  });
});

describe('POST /api/action-center/chat-actions/check', () => {
  it("lists the brand's active actions that cover the entities", async () => {
    findCoveringActions.mockResolvedValueOnce({
      keys: {},
      dedupKey: 'k',
      covering: [{ actionId: 'a0', actionNo: 1258, covers: 'all', shared: 2 }],
    });
    const res = await post('/chat-actions/check', {
      brandId: BRAND,
      entities: { prompts: [PROMPT], pages: ['/pricing'] },
      category: 'recover',
    });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      covering: [{ actionId: 'a0', actionNo: 1258, covers: 'all', shared: 2 }],
    });
    expect(findCoveringActions).toHaveBeenCalledWith(
      BRAND,
      { prompts: [PROMPT], pages: ['/pricing'], competitors: [], platforms: [] },
      { category: 'recover' },
    );
  });

  it('is for Admins and Managers of the brand only', async () => {
    assertRole.mockRejectedValueOnce(refusal('Only admins and managers…', 403, 'forbidden'));
    const res = await post('/chat-actions/check', { brandId: BRAND, entities: {} });
    expect(res.status).toBe(403);
    expect(findCoveringActions).not.toHaveBeenCalled();
  });
});
