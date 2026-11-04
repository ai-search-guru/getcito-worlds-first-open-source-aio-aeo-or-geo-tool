import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

/**
 * POST /api/prompts/suggestions/:brandId/page (AT-006 part B2): prompts
 * suggested for one page of the AI Traffic page's Pages section. The
 * suggestions themselves are tested in pagePromptSuggestions.test.js; what
 * shows up only here is what the route lets through: a path, the page's
 * range, a caller from the brand's organization, and the brand's tracked
 * prompts and topics handed on.
 */

const suggestPromptsForPage = vi.fn();
let profileOrg;
let topicRows;

function table(name) {
  const result = (single = false) => {
    if (name === 'brands') {
      return {
        data: {
          id: 'b1',
          name: 'Acme',
          description: 'Coffee',
          language: 'en',
          organization_id: 'o1',
        },
        error: null,
      };
    }
    if (name === 'profiles') {
      return { data: { organization_id: profileOrg, role: 'admin' }, error: null };
    }
    if (name === 'prompts')
      return { data: [{ id: 'p1', text: 'Best espresso beans?' }], error: null };
    if (name === 'topics')
      return { data: single ? (topicRows[0] ?? null) : topicRows, error: null };
    return { data: [], error: null };
  };
  const chain = new Proxy(
    {},
    {
      get: (_t, prop) => {
        if (prop === 'then') {
          return (resolve, reject) => Promise.resolve(result()).then(resolve, reject);
        }
        if (prop === 'single' || prop === 'maybeSingle') return async () => result(true);
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
vi.mock('../lib/pagePromptSuggestions.js', () => ({ suggestPromptsForPage }));

const { default: router } = await import('./prompts.js');

const BRAND = '33333333-3333-3333-3333-333333333333';
let server;
let baseUrl;

const post = (body) =>
  fetch(`${baseUrl}/suggestions/${BRAND}/page`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

beforeEach(async () => {
  suggestPromptsForPage.mockReset();
  profileOrg = 'o1';
  topicRows = [{ id: 't1', name: 'Espresso' }];
  const app = express();
  app.use(express.json());
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

describe('POST /api/prompts/suggestions/:brandId/page', () => {
  it("suggests prompts for the page over the page's range", async () => {
    const answer = {
      page: { path: '/gifts', title: 'Coffee gifts' },
      queries: 1,
      suggestions: [{ text: 'Best coffee gifts?', topic: 'Gifts', reason: 'r' }],
    };
    suggestPromptsForPage.mockResolvedValue(answer);
    const res = await post({ page: '/gifts', from: '2026-10-01', to: '2026-10-18T23:59:59.999Z' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(answer);
    expect(suggestPromptsForPage).toHaveBeenCalledWith(BRAND, {
      page: '/gifts',
      from: '2026-10-01',
      to: '2026-10-18T23:59:59.999Z',
      context: expect.objectContaining({
        existingPromptTexts: ['Best espresso beans?'],
        existingTopicNames: ['Espresso'],
      }),
    });
  });

  it('rejects a URL instead of a path, or a range it cannot read', async () => {
    expect((await post({ page: 'https://acme.example/gifts' })).status).toBe(400);
    expect((await post({ page: '/gifts', from: 'last week' })).status).toBe(400);
    expect(suggestPromptsForPage).not.toHaveBeenCalled();
  });

  it('asks for a topic first on a brand without one, before suggesting anything', async () => {
    topicRows = [];
    const res = await post({ page: '/gifts' });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'Add a topic first: prompts are grouped under topics.',
      code: 'no_topics',
    });
    expect(suggestPromptsForPage).not.toHaveBeenCalled();
  });

  it('refuses a caller outside the brand’s organization', async () => {
    profileOrg = 'o2';
    expect((await post({ page: '/gifts' })).status).toBe(403);
    expect(suggestPromptsForPage).not.toHaveBeenCalled();
  });

  it('passes on why no suggestions came', async () => {
    suggestPromptsForPage.mockRejectedValue(
      Object.assign(new Error("Couldn't write suggestions for this page. Try again."), {
        status: 502,
      }),
    );
    const res = await post({ page: '/gifts' });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({
      error: "Couldn't write suggestions for this page. Try again.",
    });
  });
});
