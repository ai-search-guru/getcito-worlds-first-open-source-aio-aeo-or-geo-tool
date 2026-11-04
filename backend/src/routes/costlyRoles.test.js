import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

/**
 * Who may start costly AI work (2026-10-29): generating prompt and topic
 * suggestions, opportunities, briefs and Improve sets, and sending Improve to
 * the Action Center, is for admins and managers. An analyst or an agency
 * partner is refused before anything is generated or queued. Writing in the
 * Content Editor and running a Site Audit stay open (their own routes).
 */

let role;
let server;
let baseUrl;
const generateObject = vi.fn();
const createJob = vi.fn();
const assertBrandAccess = vi.fn();
const assertOpportunityAccess = vi.fn();
const assertPromptAccess = vi.fn();

/** Every brand and profile is the caller's organization; the caller is `role`. */
function query(table) {
  const answer = () => {
    if (table === 'profiles') return { data: { organization_id: 'o1', role }, error: null };
    if (table === 'brands') {
      return { data: { id: 'b1', name: 'Acme', organization_id: 'o1' }, error: null };
    }
    if (table === 'content_opportunities') return { data: { brand_id: 'b1' }, error: null };
    if (table === 'prompts') {
      return { data: { id: 'p1', text: 'best crm', prompt_sets: { brand_id: 'b1' } }, error: null };
    }
    return { data: null, error: null };
  };
  const chain = new Proxy(
    {},
    {
      get: (_t, op) => {
        if (op === 'then')
          return (resolve, reject) => Promise.resolve(answer()).then(resolve, reject);
        if (op === 'maybeSingle' || op === 'single') return async () => answer();
        return () => chain;
      },
    },
  );
  return chain;
}

async function startApp() {
  vi.resetModules();
  vi.doMock('../config/supabase.js', () => ({ default: { from: (table) => query(table) } }));
  vi.doMock('../lib/planGuard.js', () => ({
    PlanLimitError: class extends Error {},
    requireFeature: () => (req, res, next) => next(),
    enforceFeature: vi.fn(),
    enforceBriefQuota: vi.fn(),
    getBriefQuotaStatus: vi.fn(),
    getContentUsage: vi.fn(),
    getOpportunityRequestAllowance: vi.fn(async () => ({ max: 0 })),
    getOrgIdForUser: async () => 'o1',
    reserveAiBudget: vi.fn(),
    getImproveQuotaStatus: vi.fn(),
    reserveRelevanceAllowance: vi.fn(),
    settleRelevanceUsage: vi.fn(),
  }));
  // The real role check, on the profile above; the organization checks pass.
  vi.doMock('../lib/access.js', async (importOriginal) => ({
    ...(await importOriginal()),
    assertBrandAccess,
    assertOpportunityAccess,
    assertPromptAccess,
  }));
  vi.doMock('ai', () => ({ generateObject, NoObjectGeneratedError: class extends Error {} }));
  vi.doMock('../lib/aiProvider.js', () => ({ resolveModel: vi.fn() }));
  vi.doMock('../lib/jobManager.js', () => ({ createJob, getJob: vi.fn() }));
  vi.doMock('../lib/jobRunner.js', () => ({ runContentJob: vi.fn() }));
  vi.doMock('../lib/gscSuggestions.js', () => ({ getGscSuggestionCandidates: vi.fn() }));
  vi.doMock('../lib/gaSuggestions.js', () => ({ getGaSuggestionCandidates: vi.fn() }));
  vi.doMock('../lib/catalogSuggestions.js', () => ({ getCatalogSuggestionCandidates: vi.fn() }));
  vi.doMock('../lib/pagePromptSuggestions.js', () => ({ suggestPromptsForPage: vi.fn() }));
  vi.doMock('../lib/webResearch.js', () => ({ webResearch: vi.fn() }));
  vi.doMock('../lib/promptClusters.js', () => ({ loadClusters: vi.fn() }));
  vi.doMock('../lib/action-center/fromOpportunity.js', () => ({
    OPPORTUNITY_ACTION_KIND: 'content_opportunity',
    sendToActionCenter: vi.fn(),
  }));
  vi.doMock('../lib/action-center/fromTopicOpportunity.js', () => ({
    sendTopicOpportunityToActionCenter: vi.fn(),
  }));
  vi.doMock('../lib/action-center/fromTopicGap.js', () => ({
    sendTopicGapToActionCenter: vi.fn(),
  }));
  vi.doMock('../lib/logger.js', () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() };
    return { default: logger, logger };
  });

  const { default: content } = await import('./content.js');
  const { default: prompts } = await import('./prompts.js');
  const { default: topics } = await import('./topics.js');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'u1' };
    req.log = { error: vi.fn(), info: vi.fn(), warn: vi.fn() };
    next();
  });
  app.use('/api/content', content);
  app.use('/api/prompts', prompts);
  app.use('/api/topics', topics);
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;
}

const BRAND = '11111111-1111-4111-8111-111111111111';
const setup = { brandName: 'Acme', industry: 'Coffee', description: 'Office coffee.' };
const range = { preset: '7d', from: '2026-10-21T00:00:00.000Z', to: '2026-10-28T00:00:00.000Z' };

/** Each costly route, what it is sent, and what a refused caller reads. */
const ROUTES = [
  ['/content/generate', { brandId: 'b1' }, 'Only admins and managers can generate opportunities.'],
  [
    '/content/opportunities/generate',
    { brandId: BRAND, count: 3, idempotencyKey: 'key-000001' },
    'Only admins and managers can generate opportunities.',
  ],
  [
    '/content/o1/alternative',
    { direction: 'different_angle', idempotencyKey: 'key-000001' },
    'Only admins and managers can generate opportunities.',
  ],
  [
    '/content/prompts/p1/suggest',
    { idempotencyKey: 'key-000001' },
    'Only admins and managers can generate opportunities.',
  ],
  ['/content/o1/brief', {}, 'Only admins and managers can generate briefs.'],
  [
    `/prompts/suggestions/${BRAND}/refresh`,
    {},
    'Only admins and managers can generate prompt suggestions.',
  ],
  [
    `/prompts/suggestions/${BRAND}/page`,
    { page: '/pricing' },
    'Only admins and managers can generate prompt suggestions.',
  ],
  ['/prompts/suggest', setup, 'Only admins and managers can generate prompt suggestions.'],
  ['/prompts/p1/improve', range, 'Only admins and managers can use Improve.'],
  [
    '/prompts/p1/improve/action',
    {
      ...range,
      idempotencyKey: 'key-000001',
      suggestions: [{ id: 's1', platform: 'perplexity-web', title: 'Publish a comparison page' }],
    },
    'Only admins and managers can use Improve.',
  ],
  ['/topics/suggest', setup, 'Only admins and managers can generate topic suggestions.'],
  [
    `/topics/suggestions/${BRAND}/refresh`,
    {},
    'Only admins and managers can generate topic suggestions.',
  ],
];

const post = (path, body) =>
  fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

beforeEach(async () => {
  vi.clearAllMocks();
  assertBrandAccess.mockResolvedValue({ brand: { id: BRAND, organization_id: 'o1' }, orgId: 'o1' });
  assertOpportunityAccess.mockResolvedValue({ id: 'o1', brand_id: 'b1', source_data: {} });
  assertPromptAccess.mockResolvedValue([
    { id: 'p1', prompt_sets: { brand_id: 'b1', brands: { organization_id: 'o1' } } },
  ]);
  await startApp();
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe('the costly AI routes', () => {
  for (const refused of ['analyst', 'agency_partner']) {
    it(`refuse an ${refused}, before anything is generated or queued`, async () => {
      role = refused;
      for (const [path, body, message] of ROUTES) {
        const res = await post(path, body);
        expect(res.status, path).toBe(403);
        expect((await res.json()).error, path).toBe(message);
      }
      expect(generateObject).not.toHaveBeenCalled();
      expect(createJob).not.toHaveBeenCalled();
    });
  }

  it('let a manager past the role check', async () => {
    role = 'manager';
    for (const [path, body, message] of ROUTES) {
      const res = await post(path, body);
      expect(res.status, path).not.toBe(403);
      expect(JSON.stringify(await res.json().catch(() => null)), path).not.toContain(message);
    }
  });
});

describe('the content routes, for a brand the caller was not given', () => {
  it('refuse /generate and /:id/brief with no_brand_access, before anything is queued', async () => {
    role = 'manager';
    assertBrandAccess.mockRejectedValue(
      Object.assign(new Error("You don't have access to this brand"), {
        status: 403,
        code: 'no_brand_access',
      }),
    );
    for (const [path, body] of [
      ['/content/generate', { brandId: 'b1' }],
      ['/content/o1/brief', {}],
    ]) {
      const res = await post(path, body);
      expect(res.status, path).toBe(403);
      expect(await res.json(), path).toEqual({
        error: "You don't have access to this brand",
        code: 'no_brand_access',
      });
    }
    expect(createJob).not.toHaveBeenCalled();
    expect(generateObject).not.toHaveBeenCalled();
  });
});
