import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

/**
 * Route-level tests for "Send to Action Center" on the Mentions tab (MS-08):
 * POST /api/mentions/action. The action itself is tested in
 * fromMentions.test.js; what shows up only here is what the route lets
 * through: ids in the format seeded data uses, a body that matches, and a
 * caller from the brand's organization.
 */

const assertBrandAccess = vi.fn();
const sendMentionsToActionCenter = vi.fn();

let server;
let baseUrl;

async function startApp() {
  vi.resetModules();
  vi.doMock('../lib/access.js', () => ({ assertBrandAccess }));
  vi.doMock('../lib/action-center/fromMentions.js', () => ({
    MAX_MENTIONS: 100,
    sendMentionsToActionCenter,
  }));

  const { default: router } = await import('./mentions.js');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'u1' };
    req.log = { error: vi.fn(), info: vi.fn() };
    next();
  });
  app.use('/api/mentions', router);

  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/mentions`;
}

// Seeded ids aren't RFC 4122 versions; the route must still take them.
const BRAND = '33333333-3333-3333-3333-333333333333';
const R1 = '780b5130-567e-8aef-eb44-505221a56152';

const post = (body) =>
  fetch(`${baseUrl}/action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

beforeEach(async () => {
  assertBrandAccess.mockReset().mockResolvedValue({});
  sendMentionsToActionCenter.mockReset();
  await startApp();
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe('POST /api/mentions/action', () => {
  it('sends the answers for a member and says whether it was created', async () => {
    sendMentionsToActionCenter.mockResolvedValue({ actionId: 'a1', actionNo: 62, created: true });
    const res = await post({ brandId: BRAND, resultIds: [R1], excerpts: { [R1]: '…Acme…' } });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ actionId: 'a1', actionNo: 62, created: true });
    expect(assertBrandAccess).toHaveBeenCalledWith(BRAND, 'u1');
    expect(sendMentionsToActionCenter).toHaveBeenCalledWith(BRAND, {
      resultIds: [R1],
      excerpts: { [R1]: '…Acme…' },
      userId: 'u1',
    });

    sendMentionsToActionCenter.mockResolvedValue({ actionId: 'a1', actionNo: 62, created: false });
    expect((await post({ brandId: BRAND, resultIds: [R1] })).status).toBe(200);
  });

  it('rejects a body without answers or with bad ids', async () => {
    expect((await post({ brandId: BRAND, resultIds: [] })).status).toBe(400);
    expect((await post({ brandId: 'nope', resultIds: [R1] })).status).toBe(400);
    expect((await post({ brandId: BRAND, resultIds: Array(101).fill(R1) })).status).toBe(400);
    expect(sendMentionsToActionCenter).not.toHaveBeenCalled();
  });

  it('refuses a caller outside the brand’s organization', async () => {
    assertBrandAccess.mockRejectedValue(Object.assign(new Error('Unauthorized'), { status: 403 }));
    const res = await post({ brandId: BRAND, resultIds: [R1] });
    expect(res.status).toBe(403);
    expect(sendMentionsToActionCenter).not.toHaveBeenCalled();
  });
});
