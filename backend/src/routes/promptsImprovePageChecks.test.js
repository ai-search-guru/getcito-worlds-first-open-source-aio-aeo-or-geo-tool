import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

/**
 * POST /api/prompts/:promptId/improve gives its model what Site Audit's
 * checks found on the cited pages lately (learning C2). A read of them that
 * fails goes without them rather than failing the build, and says so in the
 * log.
 */

const storedFeatures = vi.fn();
const warn = vi.fn();

function table(name) {
  const result = () => {
    if (name === 'prompts') {
      return { data: { id: 'p1', text: 'best crm', prompt_sets: { brand_id: 'b1' } }, error: null };
    }
    if (name === 'brands') return { data: { id: 'b1', organization_id: 'o1' }, error: null };
    // Improve is an admin's or a manager's (costlyRoles.test.js).
    if (name === 'profiles')
      return { data: { organization_id: 'o1', role: 'manager' }, error: null };
    if (name === 'prompt_improve_suggestions') {
      return {
        data: { range_key: '7d', region: '', platform_states: [], suggestions: [] },
        error: null,
      };
    }
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
  getImproveQuotaStatus: async () => ({ unlimited: true }),
  requireFeature: () => (_req, _res, next) => next(),
  reserveRelevanceAllowance: vi.fn(),
  settleRelevanceUsage: vi.fn(),
}));
vi.mock('../lib/action-center/competitorPages.js', async (importOriginal) => ({
  ...(await importOriginal()),
  storedFeatures: (...args) => storedFeatures(...args),
}));

const { default: router } = await import('./prompts.js');

let server;
let baseUrl;

beforeEach(async () => {
  storedFeatures.mockReset();
  warn.mockReset();
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'u1' };
    req.log = { error: vi.fn(), info: vi.fn(), warn };
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

describe('POST /api/prompts/:promptId/improve', () => {
  it("goes without the page checks when they can't be read, and logs why", async () => {
    const down = new Error('cited_page_features down');
    storedFeatures.mockRejectedValue(down);
    const res = await fetch(`${baseUrl}/p1/improve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ preset: '7d', from: '2026-10-06T00:00:00.000Z' }),
    });
    expect(res.status).toBe(200);
    expect(storedFeatures).toHaveBeenCalledWith('b1', []);
    expect(warn).toHaveBeenCalledWith(
      { err: down, promptId: 'p1' },
      'prompt improve page checks read failed',
    );
  });
});
