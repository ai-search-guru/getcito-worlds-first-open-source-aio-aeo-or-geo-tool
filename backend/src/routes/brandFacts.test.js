import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

/**
 * A brand's facts (Quality CE-047): read for its members, read again when
 * asked, approved or rejected; off before Quality's phase 2.
 */

// Seeded brands' ids aren't RFC 4122 versions; the routes must still take them.
const BRAND = '33333333-3333-3333-3333-333333333333';
const FACT = '5e8cd4c2-2bc4-4fb7-8711-bc0ad1bb4a29';
let factRow;
const logError = vi.fn();
const assertBrandAccess = vi.fn();
const readBrandFacts = vi.fn();
const setFactStatus = vi.fn();
const isOrgActive = vi.fn();
const isDemoBrand = vi.fn();

vi.mock('../config/supabase.js', () => ({
  default: {
    from: () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: factRow, error: null }),
      };
      return chain;
    },
  },
}));
vi.mock('../lib/access.js', () => ({
  assertBrandAccess: (...args) => assertBrandAccess(...args),
}));
vi.mock('../lib/brandFacts.js', () => ({
  readBrandFacts: (...args) => readBrandFacts(...args),
  setFactStatus: (...args) => setFactStatus(...args),
}));

vi.mock('../lib/activeSubscriptions.js', () => ({
  isOrgActive: (...args) => isOrgActive(...args),
}));
vi.mock('../middleware/demoBrand.js', () => ({
  isDemoBrand: (...args) => isDemoBrand(...args),
}));

const { default: router } = await import('./brandFacts.js');

let server;
let baseUrl;
beforeEach(async () => {
  vi.stubEnv('CONTENT_QUALITY_PHASE', '2');
  factRow = { id: FACT, brand_id: BRAND, kind: 'price', slot: 'price|pro|USD|month||' };
  logError.mockReset();
  assertBrandAccess.mockReset().mockResolvedValue({ orgId: 'o1' });
  readBrandFacts.mockReset().mockResolvedValue({ facts: [], pages: [], paused: false });
  setFactStatus.mockReset().mockResolvedValue({ id: FACT, status: 'approved' });
  isOrgActive.mockReset().mockResolvedValue(true);
  isDemoBrand.mockReset().mockResolvedValue(false);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'u1' };
    req.log = { error: logError };
    next();
  });
  app.use('/api/brand-facts', router);
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/brand-facts`;
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await new Promise((resolve) => server.close(resolve));
});

const send = (path, method, body) =>
  fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });

describe('/api/brand-facts', () => {
  it('reads only what is kept once the plan has ended', async () => {
    isOrgActive.mockResolvedValue(false);
    const res = await send(`?brandId=${BRAND}`, 'GET');
    expect(res.status).toBe(200);
    expect(isOrgActive).toHaveBeenCalledWith('o1');
    expect(readBrandFacts).toHaveBeenCalledWith(BRAND, { orgId: 'o1', keptOnly: true });
  });

  it('reads only what is kept on a demo brand: its facts are sample data', async () => {
    isDemoBrand.mockResolvedValue(true);
    const res = await send(`?brandId=${BRAND}`, 'GET');
    expect(res.status).toBe(200);
    expect(isDemoBrand).toHaveBeenCalledWith(BRAND);
    expect(readBrandFacts).toHaveBeenCalledWith(BRAND, { orgId: 'o1', keptOnly: true });
  });

  it('reads the facts for a member, and reads the site again when asked', async () => {
    const res = await send(`?brandId=${BRAND}`, 'GET');
    expect(res.status).toBe(200);
    expect(assertBrandAccess).toHaveBeenCalledWith(BRAND, 'u1');
    expect(readBrandFacts).toHaveBeenCalledWith(BRAND, { orgId: 'o1', keptOnly: false });
    await send('/fetch', 'POST', { brandId: BRAND });
    expect(readBrandFacts).toHaveBeenLastCalledWith(BRAND, { orgId: 'o1', refresh: true });
  });

  it('is off before phase 2, and refuses a malformed ask or another workspace’s brand', async () => {
    vi.stubEnv('CONTENT_QUALITY_PHASE', '1');
    expect((await send(`?brandId=${BRAND}`, 'GET')).status).toBe(404);
    expect((await send(`/${FACT}`, 'PATCH', { status: 'approved' })).status).toBe(404);
    vi.stubEnv('CONTENT_QUALITY_PHASE', '2');
    expect((await send('?brandId=nope', 'GET')).status).toBe(400);
    expect((await send('/fetch', 'POST', {})).status).toBe(400);
    assertBrandAccess.mockRejectedValueOnce(Object.assign(new Error('Not yours'), { status: 403 }));
    const res = await send(`?brandId=${BRAND}`, 'GET');
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('forbidden');
    expect(readBrandFacts).not.toHaveBeenCalled();
  });

  it('approves or rejects a fact of a brand the member is in, and nothing else', async () => {
    const res = await send(`/${FACT}`, 'PATCH', { status: 'approved' });
    expect(res.status).toBe(200);
    expect(assertBrandAccess).toHaveBeenCalledWith(BRAND, 'u1');
    expect(setFactStatus).toHaveBeenCalledWith(factRow, 'approved', 'u1');
    expect((await send(`/${FACT}`, 'PATCH', { status: 'pending' })).status).toBe(400);
    factRow = null;
    expect((await send(`/${FACT}`, 'PATCH', { status: 'rejected' })).status).toBe(404);
  });

  it('changes no fact of another workspace’s brand', async () => {
    assertBrandAccess.mockRejectedValueOnce(Object.assign(new Error('Not yours'), { status: 403 }));
    const res = await send(`/${FACT}`, 'PATCH', { status: 'approved' });
    expect(res.status).toBe(403);
    expect(setFactStatus).not.toHaveBeenCalled();
  });

  it('logs a failure without the provider’s request', async () => {
    readBrandFacts.mockRejectedValueOnce(
      Object.assign(new Error('Bad Request'), {
        name: 'AI_APICallError',
        requestBodyValues: { prompt: 'Page: pricing page of ledgerly.example' },
      }),
    );
    expect((await send(`?brandId=${BRAND}`, 'GET')).status).toBe(500);
    expect(logError).toHaveBeenCalledWith(
      { err: expect.objectContaining({ name: 'AI_APICallError', message: 'Bad Request' }) },
      'brand facts read error',
    );
    expect(JSON.stringify(logError.mock.calls)).not.toContain('ledgerly.example');
  });
});
