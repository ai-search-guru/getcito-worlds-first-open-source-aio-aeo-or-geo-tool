import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

/**
 * Route-level tests for "Send to Action Center" on a Site Audit report
 * (learning D2): POST /api/action-center/audits. The action itself is tested
 * in fromAudit.test.js; here, what the route lets through (ids in the
 * format seeded data uses, a caller from the brand's organization) and how
 * it answers: 201 created, 200 already open, and the action's refusals with
 * their code, an older report's with the page's latest audit.
 */

const assertBrandAccess = vi.fn();
const sendAuditToActionCenter = vi.fn();

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
    sendContentDraftToActionCenter: vi.fn(),
  }));
  vi.doMock('../lib/action-center/fromAudit.js', () => ({ sendAuditToActionCenter }));

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
const AUDIT = '44444444-4444-4444-4444-444444444444';

const post = (body) =>
  fetch(`${baseUrl}/audits`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

/** The action's refusal, as fromAudit.js throws it. */
const refusal = (message, status, code, extra) =>
  Object.assign(new Error(message), { status, code, ...(extra ? { extra } : {}) });

beforeEach(async () => {
  assertBrandAccess.mockReset().mockResolvedValue({});
  sendAuditToActionCenter.mockReset();
  await startApp();
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe('POST /api/action-center/audits', () => {
  it('sends the audit for a member: 201 when created, 200 when already open', async () => {
    sendAuditToActionCenter.mockResolvedValue({ actionId: 'a1', actionNo: 71, created: true });
    const res = await post({ brandId: BRAND, auditId: AUDIT });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ actionId: 'a1', actionNo: 71, created: true });
    expect(assertBrandAccess).toHaveBeenCalledWith(BRAND, 'u1');
    expect(sendAuditToActionCenter).toHaveBeenCalledWith(BRAND, { auditId: AUDIT, userId: 'u1' });

    sendAuditToActionCenter.mockResolvedValue({ actionId: 'a1', actionNo: 71, created: false });
    const again = await post({ brandId: BRAND, auditId: AUDIT });
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ actionId: 'a1', actionNo: 71, created: false });
  });

  it('rejects a body without valid ids', async () => {
    expect((await post({ brandId: BRAND })).status).toBe(400);
    expect((await post({ brandId: BRAND, auditId: 'nope' })).status).toBe(400);
    expect((await post({ brandId: 'nope', auditId: AUDIT })).status).toBe(400);
    expect(assertBrandAccess).not.toHaveBeenCalled();
    expect(sendAuditToActionCenter).not.toHaveBeenCalled();
  });

  it('rejects a caller outside the brand’s workspace', async () => {
    assertBrandAccess.mockRejectedValue(refusal('nope', 403, 'not_in_workspace'));
    const res = await post({ brandId: BRAND, auditId: AUDIT });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'not_in_workspace' });
    expect(sendAuditToActionCenter).not.toHaveBeenCalled();
  });

  it('passes on an audit the brand doesn’t have', async () => {
    sendAuditToActionCenter.mockRejectedValue(refusal('Audit not found', 404, 'not_found'));
    const res = await post({ brandId: BRAND, auditId: AUDIT });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: 'not_found' });
  });

  it('passes on the action’s refusals with their code', async () => {
    sendAuditToActionCenter.mockRejectedValue(
      refusal('The page passes its checks', 409, 'nothing_to_fix'),
    );
    let res = await post({ brandId: BRAND, auditId: AUDIT });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'Failed to send to the Action Center',
      details: 'The page passes its checks',
      code: 'nothing_to_fix',
    });

    sendAuditToActionCenter.mockRejectedValue(
      refusal('The audit hasn’t finished', 409, 'not_completed'),
    );
    res = await post({ brandId: BRAND, auditId: AUDIT });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'not_completed' });
  });

  it("answers an older report with the page's latest audit", async () => {
    sendAuditToActionCenter.mockRejectedValue(
      refusal('The page has a newer audit', 409, 'newer_audit', { latestAuditId: 'a-new' }),
    );
    const res = await post({ brandId: BRAND, auditId: AUDIT });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'Failed to send to the Action Center',
      details: 'The page has a newer audit',
      code: 'newer_audit',
      latestAuditId: 'a-new',
    });
  });

  it('answers 500 for an unexpected failure', async () => {
    sendAuditToActionCenter.mockRejectedValue(new Error('db down'));
    const res = await post({ brandId: BRAND, auditId: AUDIT });
    expect(res.status).toBe(500);
    expect(await res.json()).not.toHaveProperty('code');
  });
});
