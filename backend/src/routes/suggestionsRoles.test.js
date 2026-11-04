import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

/**
 * Who may decide on a suggestion (2026-10-29): a prompt suggestion is
 * dismissed by anyone but an agency partner (the table's update rule) and
 * accepted only by those who may add prompts, admins and managers; a topic
 * suggestion is accepted or dismissed by admins and managers, as the Topics
 * page offers it. A refused call writes nothing. A brand the caller can't
 * reach is refused with the server's code (BUG-001, BRAND-ACCESS), which the
 * web reads as "switch to one of your brands".
 */

let role;
let scope;
let brandOrg;
let writes;
let server;
let baseUrl;

/**
 * The brand is `brandOrg`'s and the suggestion the brand's; the caller is
 * `role` in o1, with `scope`.
 */
function query(table) {
  const answer = () => {
    if (table === 'profiles') {
      return { data: { organization_id: 'o1', role, brand_scope: scope }, error: null };
    }
    if (table === 'brands') {
      return { data: { id: 'b1', organization_id: brandOrg, is_demo: false }, error: null };
    }
    // Selected brands with nothing granted.
    if (table === 'member_brands') return { data: [], error: null };
    if (table.endsWith('_suggestions')) return { data: { brand_id: 'b1' }, error: null };
    return { data: null, error: null };
  };
  const chain = new Proxy(
    {},
    {
      get: (_t, op) => {
        if (op === 'then')
          return (resolve, reject) => Promise.resolve(answer()).then(resolve, reject);
        if (op === 'maybeSingle' || op === 'single') return async () => answer();
        if (op === 'update') {
          return (values) => {
            writes.push({ table, values });
            return chain;
          };
        }
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
    enforceFeature: vi.fn(),
    reserveAiBudget: vi.fn(),
    getImproveQuotaStatus: vi.fn(),
    requireFeature: () => (req, res, next) => next(),
    reserveRelevanceAllowance: vi.fn(),
    settleRelevanceUsage: vi.fn(),
    getOrgIdForUser: async () => 'o1',
  }));
  vi.doMock('ai', () => ({
    generateObject: vi.fn(),
    NoObjectGeneratedError: class extends Error {},
  }));
  vi.doMock('../lib/aiProvider.js', () => ({ resolveModel: vi.fn() }));
  vi.doMock('../lib/gscSuggestions.js', () => ({ getGscSuggestionCandidates: vi.fn() }));
  vi.doMock('../lib/gaSuggestions.js', () => ({ getGaSuggestionCandidates: vi.fn() }));
  vi.doMock('../lib/catalogSuggestions.js', () => ({ getCatalogSuggestionCandidates: vi.fn() }));
  vi.doMock('../lib/webResearch.js', () => ({ webResearch: vi.fn() }));
  vi.doMock('../lib/action-center/fromTopicOpportunity.js', () => ({
    sendTopicOpportunityToActionCenter: vi.fn(),
  }));
  vi.doMock('../lib/action-center/fromTopicGap.js', () => ({
    sendTopicGapToActionCenter: vi.fn(),
  }));
  vi.doMock('../lib/pagePromptSuggestions.js', () => ({ suggestPromptsForPage: vi.fn() }));
  vi.doMock('../lib/logger.js', () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() };
    return { default: logger, logger };
  });

  const { default: prompts } = await import('./prompts.js');
  const { default: topics } = await import('./topics.js');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'u1' };
    req.log = { error: vi.fn(), info: vi.fn() };
    next();
  });
  app.use('/api/prompts', prompts);
  app.use('/api/topics', topics);
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;
}

const post = (path, body = {}) =>
  fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

beforeEach(async () => {
  writes = [];
  scope = 'all';
  brandOrg = 'o1';
  await startApp();
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe('POST /api/prompts/suggestions/:id/dismiss', () => {
  it('refuses an agency partner, without a write', async () => {
    role = 'agency_partner';
    const res = await post('/prompts/suggestions/s1/dismiss');
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: 'Only admins, managers and analysts can dismiss prompt suggestions.',
      code: 'forbidden',
    });
    expect(writes).toEqual([]);
  });

  it('lets an analyst dismiss one', async () => {
    role = 'analyst';
    const res = await post('/prompts/suggestions/s1/dismiss');
    expect(res.status).toBe(200);
    expect(writes).toEqual([
      { table: 'prompt_suggestions', values: expect.objectContaining({ status: 'dismissed' }) },
    ]);
  });
});

describe('POST /api/prompts/suggestions/:id/accept', () => {
  it('refuses an analyst, who cannot add prompts', async () => {
    role = 'analyst';
    const res = await post('/prompts/suggestions/s1/accept', { promptId: 'p1' });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: 'Only admins and managers can add prompts.',
      code: 'forbidden',
    });
    expect(writes).toEqual([]);
  });

  it('records a manager’s accept', async () => {
    role = 'manager';
    const res = await post('/prompts/suggestions/s1/accept', { promptId: 'p1' });
    expect(res.status).toBe(200);
    expect(writes[0].values).toMatchObject({ status: 'added', added_prompt_id: 'p1' });
  });
});

describe('POST /api/topics/suggestions/:id/accept and /dismiss', () => {
  it('refuses an analyst both, without a write', async () => {
    role = 'analyst';
    for (const [path, body] of [
      ['/topics/suggestions/s1/accept', { topicId: 't1' }],
      ['/topics/suggestions/s1/dismiss', {}],
    ]) {
      const res = await post(path, body);
      expect(res.status, path).toBe(403);
      expect(await res.json(), path).toEqual({
        error: 'Only admins and managers can accept or dismiss topic suggestions.',
      });
    }
    expect(writes).toEqual([]);
  });

  it('lets an admin accept and dismiss', async () => {
    role = 'admin';
    expect((await post('/topics/suggestions/s1/accept', { topicId: 't1' })).status).toBe(200);
    expect((await post('/topics/suggestions/s1/dismiss')).status).toBe(200);
    expect(writes.map((w) => w.values.status)).toEqual(['added', 'dismissed']);
  });
});

describe('the prompt suggestion routes, for a brand the caller cannot reach', () => {
  const ROUTES = [
    ['POST', '/prompts/suggestions/b1/refresh'],
    ['POST', '/prompts/suggestions/b1/page', { page: '/pricing' }],
    ['GET', '/prompts/suggestions/b1'],
    ['GET', '/prompts/untracked-queries/b1?until=2026-10-30'],
    ['POST', '/prompts/suggestions/s1/dismiss'],
    ['POST', '/prompts/suggestions/s1/accept', { promptId: 'p1' }],
  ];
  const call = (method, path, body) =>
    method === 'GET' ? fetch(`${baseUrl}${path}`) : post(path, body);

  it.each([
    ['another organization’s brand', 'not_in_workspace', "This brand isn't in your workspace"],
    [
      'a brand not granted (Selected brands)',
      'no_brand_access',
      "You don't have access to this brand",
    ],
  ])('refuse %s with a 403 and its code, without a write', async (_case, code, error) => {
    role = 'manager';
    if (code === 'not_in_workspace') brandOrg = 'o2';
    else scope = 'selected';
    for (const [method, path, body] of ROUTES) {
      const res = await call(method, path, body);
      expect(res.status, path).toBe(403);
      expect(await res.json(), path).toEqual({ error, code });
    }
    expect(writes).toEqual([]);
  });
});
