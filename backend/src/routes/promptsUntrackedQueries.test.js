import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

/**
 * GET /api/prompts/untracked-queries/:brandId (AT-009): Google queries you
 * don't track yet, for the AI Traffic page. The list itself is tested in
 * untrackedQueries.test.js; this checks the days, the limit and access.
 */

const untrackedGoogleQueries = vi.fn();
let profileOrg;

function table(name) {
  const result = () => {
    if (name === 'brands') return { data: { id: 'b1', organization_id: 'o1' }, error: null };
    if (name === 'profiles') return { data: { organization_id: profileOrg }, error: null };
    return { data: [], error: null };
  };
  const chain = new Proxy(
    {},
    {
      get: (_t, prop) => {
        if (prop === 'then') {
          return (resolve, reject) => Promise.resolve(result()).then(resolve, reject);
        }
        if (prop === 'single' || prop === 'maybeSingle') return async () => result();
        return () => chain;
      },
    },
  );
  return chain;
}

vi.mock('../config/supabase.js', () => ({ default: { from: (name) => table(name) } }));
vi.mock('../lib/planGuard.js', () => ({
  PlanLimitError: class extends Error {},
  enforceFeature: vi.fn(),
  reserveAiBudget: vi.fn(),
  getImproveQuotaStatus: vi.fn(),
  requireFeature: () => (req, res, next) => next(),
  reserveRelevanceAllowance: vi.fn(),
  settleRelevanceUsage: vi.fn(),
}));
vi.mock('../lib/untrackedQueries.js', () => ({
  UNTRACKED_QUERY_SCAN: 5000,
  untrackedGoogleQueries,
}));

const { default: router } = await import('./prompts.js');

const BRAND = '33333333-3333-3333-3333-333333333333';
let server;
let baseUrl;

const get = (query) => fetch(`${baseUrl}/untracked-queries/${BRAND}?${new URLSearchParams(query)}`);

beforeEach(async () => {
  untrackedGoogleQueries.mockReset().mockResolvedValue({ count: 0, rows: [] });
  profileOrg = 'o1';
  const app = express();
  app.use((req, _res, next) => {
    req.user = { id: 'u1' };
    req.log = { error: vi.fn(), info: vi.fn() };
    next();
  });
  app.use('/api/prompts', router);
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/prompts`;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe('GET /api/prompts/untracked-queries/:brandId', () => {
  it("reads the page's days, all time without a first one", async () => {
    const res = await get({ since: '2026-10-13', until: '2026-10-19', limit: '0' });
    expect(res.status).toBe(200);
    expect(untrackedGoogleQueries).toHaveBeenCalledWith(BRAND, {
      since: '2026-10-13',
      until: '2026-10-19',
      limit: 0,
    });

    await get({ until: '2026-10-19' });
    expect(untrackedGoogleQueries).toHaveBeenLastCalledWith(BRAND, {
      since: null,
      until: '2026-10-19',
      limit: 10,
    });
  });

  it('rejects days it cannot read and a limit past the scan', async () => {
    expect((await get({ until: 'yesterday' })).status).toBe(400);
    expect((await get({ until: '2026-10-19', limit: '6000' })).status).toBe(400);
    expect(untrackedGoogleQueries).not.toHaveBeenCalled();
  });

  it("refuses a brand outside the member's organization", async () => {
    profileOrg = 'o2';
    const res = await get({ until: '2026-10-19' });
    expect(res.status).toBe(403);
    expect(untrackedGoogleQueries).not.toHaveBeenCalled();
  });
});
