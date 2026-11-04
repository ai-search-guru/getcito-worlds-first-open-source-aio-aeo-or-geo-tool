import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

/**
 * POST /api/prompts/:promptId/improve builds the Improve set. The brand's
 * earlier Improve rounds on the prompt (learning B5) are read for the set's
 * region and go into the model's prompt; when they can't be read, the set is
 * still written, as before, and the request's log says why.
 */

const generateObject = vi.fn();
const loadImproveRounds = vi.fn();
const getImproveQuotaStatus = vi.fn();
const release = vi.fn();

// One platform where the brand isn't named: actionable, so the model is called.
const answers = [
  {
    id: 'r1',
    platform: 'chatgpt-web',
    created_at: '2026-10-12T08:00:00.000Z',
    mention_count: 0,
    mention_position: null,
    mentioned_entity_count: 3,
    citation_count: 0,
    citations: [],
    search_queries: [],
    competitor_mentions: [],
  },
];

function table(name) {
  const result = () => {
    if (name === 'prompts') {
      return {
        data: {
          id: 'p1',
          text: 'best crm',
          platforms: ['chatgpt-web'],
          prompt_sets: { brand_id: 'b1' },
        },
        error: null,
      };
    }
    if (name === 'brands') {
      return { data: { id: 'b1', name: 'Acme', organization_id: 'o1' }, error: null };
    }
    if (name === 'profiles') return { data: { organization_id: 'o1', role: 'admin' }, error: null };
    if (name === 'prompt_results') return { data: answers, error: null };
    if (name === 'prompt_improve_suggestions') {
      return {
        data: {
          range_key: '7d',
          region: '',
          platform_states: [],
          suggestions: [],
          latest_result_at: answers[0].created_at,
          generated_at: '2026-10-13T08:00:00.000Z',
        },
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

vi.mock('ai', async (importOriginal) => ({ ...(await importOriginal()), generateObject }));
vi.mock('../config/supabase.js', () => ({ default: { from: (name) => table(name) } }));
vi.mock('../lib/aiProvider.js', () => ({ resolveModel: vi.fn() }));
vi.mock('../lib/planGuard.js', () => ({
  PlanLimitError: class extends Error {},
  enforceFeature: vi.fn(),
  reserveAiBudget: async () => ({ charge: vi.fn(), release }),
  getImproveQuotaStatus,
  requireFeature: () => (req, res, next) => next(),
  reserveRelevanceAllowance: vi.fn(),
  settleRelevanceUsage: vi.fn(),
}));
vi.mock('../lib/action-center/fromPromptImprove.js', () => ({
  liveImproveSends: async () => ({ latest: null, sentSuggestionIds: [] }),
  loadImproveRounds,
  sendImproveToActionCenter: vi.fn(),
}));

const { default: router } = await import('./prompts.js');

let server;
let baseUrl;
let log;

const build = (region = '') =>
  fetch(`${baseUrl}/p1/improve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ preset: '7d', from: '2026-10-06T00:00:00.000Z', region }),
  });

beforeEach(async () => {
  generateObject.mockReset();
  generateObject.mockResolvedValue({ object: { suggestions: [] }, usage: {} });
  loadImproveRounds.mockReset();
  release.mockReset();
  getImproveQuotaStatus.mockResolvedValue({ unlimited: true });
  log = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'u1' };
    req.log = log;
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
  it("tells the model the set's region's earlier rounds", async () => {
    loadImproveRounds.mockResolvedValue([
      {
        sent: '2026-09-10',
        daysAgo: 48,
        open: false,
        final: true,
        platforms: [{ id: 'chatgpt-web', verdict: 'unchanged' }],
        suggestions: [{ platform: 'chatgpt-web', title: 'Add a table', status: 'done' }],
      },
    ]);
    const res = await build('US');
    expect(res.status).toBe(200);
    expect(loadImproveRounds).toHaveBeenCalledWith({ promptId: 'p1', brandId: 'b1', region: 'US' });
    expect(generateObject).toHaveBeenCalledTimes(1);
    expect(generateObject.mock.calls[0][0].prompt).toContain(
      'Earlier Improve rounds on this prompt, newest first:',
    );
  });

  it('still writes the suggestions when the earlier rounds cannot be read', async () => {
    const err = new Error('earlier Improve rounds read failed: timeout');
    loadImproveRounds.mockRejectedValue(err);
    const res = await build();
    expect(res.status).toBe(200);
    expect((await res.json()).improve.rangeKey).toBe('7d');
    expect(generateObject).toHaveBeenCalledTimes(1);
    expect(generateObject.mock.calls[0][0].prompt).not.toContain('Earlier Improve rounds');
    expect(log.warn).toHaveBeenCalledWith(
      { err, promptId: 'p1' },
      'prompt improve earlier rounds unavailable',
    );
    expect(log.error).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
  });
});
