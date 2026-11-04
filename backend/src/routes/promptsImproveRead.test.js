import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

/**
 * GET /api/prompts/:promptId/improve reads the kept Improve set; it never
 * generates. Read-only once the plan has ended (2026-10-27), its quota is
 * read as a read: a workspace without an active plan gets the kept set with
 * a spent budget and `noPlan`, not an error.
 */

const getImproveQuotaStatus = vi.fn();
// The plan ended: requireFeature refuses with 402 unless the route gave it
// readOnly, as the real one does.
let planEnded = false;
const kept = {
  id: 'set-1',
  range_key: '7d',
  region: '',
  platform_states: [],
  suggestions: [{ id: 's1', title: 'Publish a comparison page' }],
  latest_result_at: '2026-10-13T08:00:00.000Z',
  generated_at: '2026-10-13T08:00:00.000Z',
  sent_actions: [],
};

function table(name) {
  const result = () => {
    if (name === 'prompts') {
      return { data: { id: 'p1', text: 'best crm', prompt_sets: { brand_id: 'b1' } }, error: null };
    }
    if (name === 'brands') return { data: { id: 'b1', organization_id: 'o1' }, error: null };
    if (name === 'profiles') return { data: { organization_id: 'o1' }, error: null };
    if (name === 'prompt_improve_suggestions') return { data: kept, error: null };
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
  getImproveQuotaStatus,
  requireFeature: (_feature, options) => (req, res, next) =>
    planEnded && !options?.readOnly ? res.status(402).json({ error: 'plan_limit' }) : next(),
  reserveRelevanceAllowance: vi.fn(),
  settleRelevanceUsage: vi.fn(),
}));
vi.mock('../lib/action-center/fromPromptImprove.js', () => ({
  liveImproveSends: async () => ({ latest: null, sentSuggestionIds: [] }),
  sendImproveToActionCenter: vi.fn(),
}));

const { default: router } = await import('./prompts.js');

let server;
let baseUrl;

const read = () =>
  fetch(
    `${baseUrl}/p1/improve?${new URLSearchParams({ preset: '7d', from: '2026-10-06T00:00:00.000Z' })}`,
  );

beforeEach(async () => {
  getImproveQuotaStatus.mockReset();
  planEnded = false;
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

describe('GET /api/prompts/:promptId/improve', () => {
  it('returns the kept set with a spent budget once the plan has ended', async () => {
    planEnded = true;
    getImproveQuotaStatus.mockResolvedValue({
      unlimited: false,
      planName: 'Starter',
      trial: false,
      budgetUsd: 0,
      spentUsd: 0.4,
      remainingUsd: 0,
      generationsLeft: 0,
      percentLeft: 0,
      noPlan: true,
    });
    const res = await read();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.improve.suggestions).toEqual(kept.suggestions);
    expect(body.quota).toEqual({
      unlimited: false,
      exhausted: true,
      generationsLeft: 0,
      percentLeft: 0,
      trial: false,
      noPlan: true,
    });
    expect(getImproveQuotaStatus).toHaveBeenCalledWith('o1', expect.any(String), {
      readOnly: true,
    });
    // Only the read is given readOnly: building a set is still refused.
    const build = await fetch(`${baseUrl}/p1/improve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(build.status).toBe(402);
  });

  it('answers an active plan as before, with no noPlan', async () => {
    getImproveQuotaStatus.mockResolvedValue({
      unlimited: false,
      planName: 'Starter',
      trial: false,
      budgetUsd: 5,
      spentUsd: 1,
      remainingUsd: 4,
      generationsLeft: 80,
      percentLeft: 80,
    });
    const body = await (await read()).json();
    expect(body.quota).toEqual({
      unlimited: false,
      exhausted: false,
      generationsLeft: 80,
      percentLeft: 80,
      trial: false,
    });
  });
});
