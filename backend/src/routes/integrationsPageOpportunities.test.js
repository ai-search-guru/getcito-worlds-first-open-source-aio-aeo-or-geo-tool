import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

/**
 * GET /api/integrations/google-analytics/page-opportunities (AT-002): the AI
 * Traffic page's "Pages AI engines aren't sending traffic to" for the range
 * the page shows, for members of the brand's organization.
 */

const BRAND = '22222222-2222-2222-2222-222222222222';

const detect = vi.fn();
const access = vi.fn();

vi.mock('../config/supabase.js', () => ({ default: {} }));
vi.mock('../lib/composio.js', () => ({}));
vi.mock('../lib/gaSync.js', () => ({ runGaSync: vi.fn() }));
vi.mock('../lib/gscSync.js', () => ({ runGscSync: vi.fn() }));
vi.mock('../lib/pageOpportunities.js', () => ({
  detectPageOpportunitiesInWindow: (...args) => detect(...args),
}));
vi.mock('../lib/access.js', () => ({
  assertBrandAccess: (...args) => access(...args),
  assertAllBrands: vi.fn(),
}));

let server;
let baseUrl;

beforeAll(async () => {
  const { default: router } = await import('./integrations.js');
  const app = express();
  app.use((req, _res, next) => {
    req.user = { id: 'u1' };
    req.log = { error: vi.fn() };
    next();
  });
  app.use('/api/integrations', router);
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/integrations/google-analytics/page-opportunities`;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

beforeEach(() => {
  detect.mockReset().mockResolvedValue({ pages: 12, findings: [{ landing_page: '/pricing' }] });
  access.mockReset().mockResolvedValue({ orgId: 'org-1' });
});

const get = (query) => fetch(`${baseUrl}?${new URLSearchParams(query)}`);

describe('GET /google-analytics/page-opportunities', () => {
  it("returns the findings for the page's range", async () => {
    const res = await get({ brandId: BRAND, from: '2026-10-11', to: '2026-10-17' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ pages: 12, findings: [{ landing_page: '/pricing' }] });
    expect(access).toHaveBeenCalledWith(BRAND, 'u1');
    expect(detect).toHaveBeenCalledWith(BRAND, { since: '2026-10-11', until: '2026-10-17' });
  });

  it('passes a limit through, for an export of every finding', async () => {
    await get({ brandId: BRAND, from: '2026-10-11', limit: '1000' });
    expect(detect).toHaveBeenCalledWith(BRAND, { since: '2026-10-11', until: null, limit: 1000 });
  });

  it('refuses a limit outside 1–1000', async () => {
    for (const limit of ['0', '1001', 'many']) {
      const res = await get({ brandId: BRAND, limit });
      expect(res.status).toBe(400);
    }
    expect(detect).not.toHaveBeenCalled();
  });

  it('leaves an end open when the page sends no bound for it', async () => {
    await get({ brandId: BRAND });
    expect(detect).toHaveBeenCalledWith(BRAND, { since: null, until: null });
  });

  it("refuses a bound that isn't a calendar day, and a missing or malformed brand", async () => {
    for (const query of [
      { brandId: BRAND, from: '2026-10-11T00:00:00Z' },
      { brandId: BRAND, to: '2026-13-01' },
      { brandId: 'not-a-brand', from: '2026-10-11' },
      { from: '2026-10-11' },
    ]) {
      const res = await get(query);
      expect(res.status).toBe(400);
    }
    expect(detect).not.toHaveBeenCalled();
  });

  it("refuses someone outside the brand's organization", async () => {
    access.mockRejectedValue(Object.assign(new Error('Forbidden'), { status: 403 }));
    const res = await get({ brandId: BRAND, from: '2026-10-11' });
    expect(res.status).toBe(403);
    expect(detect).not.toHaveBeenCalled();
  });

  it('reports a failed read as an error, not as an empty list', async () => {
    detect.mockRejectedValue(new Error('timeout'));
    const res = await get({ brandId: BRAND, from: '2026-10-11' });
    expect(res.status).toBe(500);
  });
});
