import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

/**
 * POST /api/brands/:id/tracking-snippet/check (00433): AI Traffic's Check
 * again, for any member of the brand.
 */

const assertBrandAccess = vi.fn();
const checkTrackingSnippet = vi.fn();

vi.mock('../config/supabase.js', () => ({ default: {} }));
vi.mock('../lib/access.js', () => ({ assertBrandAccess: (...a) => assertBrandAccess(...a) }));
vi.mock('../lib/brandDelete.js', () => ({ deleteBrand: vi.fn() }));
vi.mock('../lib/siteTypeDetect.js', () => ({ applySiteTypeDetection: vi.fn() }));
vi.mock('../lib/trackingSnippetCheck.js', () => ({
  checkTrackingSnippet: (...a) => checkTrackingSnippet(...a),
}));

const { default: router } = await import('./brands.js');

let server;
let baseUrl;
beforeEach(async () => {
  assertBrandAccess.mockReset().mockResolvedValue(undefined);
  checkTrackingSnippet.mockReset();
  const app = express();
  app.use((req, _res, next) => {
    req.user = { id: 'u1' };
    req.log = { error: vi.fn(), info: vi.fn(), warn: vi.fn() };
    next();
  });
  app.use('/api/brands', router);
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
afterEach(() => new Promise((resolve) => server.close(resolve)));

const check = (id = 'b1') =>
  fetch(`${baseUrl}/api/brands/${id}/tracking-snippet/check`, { method: 'POST' });

describe('POST /api/brands/:id/tracking-snippet/check', () => {
  it('checks the brand’s home page and answers what it found', async () => {
    const result = {
      status: 'found',
      domain: 'getcito.com',
      checkedAt: '2026-11-01T10:00:00.000Z',
      foundAt: '2026-11-01T10:00:00.000Z',
    };
    checkTrackingSnippet.mockResolvedValue(result);
    const res = await check();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(result);
    expect(assertBrandAccess).toHaveBeenCalledWith('b1', 'u1');
    expect(checkTrackingSnippet).toHaveBeenCalledWith('b1');
  });

  it('says a brand without a site has nothing to check', async () => {
    checkTrackingSnippet.mockResolvedValue({
      status: 'no_domain',
      domain: null,
      checkedAt: null,
      foundAt: null,
    });
    expect(await (await check()).json()).toMatchObject({ status: 'no_domain' });
  });

  it('refuses a brand the person can’t open, and checks nothing', async () => {
    assertBrandAccess.mockRejectedValue(
      Object.assign(new Error('Brand not found'), { status: 404 }),
    );
    const res = await check();
    expect(res.status).toBe(404);
    expect(checkTrackingSnippet).not.toHaveBeenCalled();
  });

  it('hides an unexpected failure behind a plain message', async () => {
    checkTrackingSnippet.mockRejectedValue(new Error('relation does not exist'));
    const res = await check();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Failed to check the tracking snippet.' });
  });
});
