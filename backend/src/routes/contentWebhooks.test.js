import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

/**
 * Route-level tests for the Opportunities webhook sends (POST
 * /api/content/:id/send-webhook and /bulk/send-webhook) and the webhook test
 * (POST /api/content/webhook-test): they post as Send to CMS does
 * (postJson), so on Cloud a private address is refused and a redirect is an
 * answer, not followed (#1437 review, item 5). The test is a brand's, for
 * those who can edit its webhook, 10 a minute (#1568 review).
 */

import { PageFetchError } from '../lib/safeFetch.js';

const postJson = vi.fn();
const assertOpportunityAccess = vi.fn();
const assertBrandAccess = vi.fn();
let rows = {};
let updates = [];

let server;
let baseUrl;

/** A query on `table`: every filter returns it, and it reads as the table's rows. */
function query(table) {
  const answer = () => ({ data: rows[table] ?? null, error: null });
  const chain = new Proxy(
    {},
    {
      get: (_t, op) => {
        if (op === 'then')
          return (resolve, reject) => Promise.resolve(answer()).then(resolve, reject);
        if (op === 'maybeSingle' || op === 'single') {
          return async () => {
            const data = rows[table] ?? null;
            return { data: Array.isArray(data) ? (data[0] ?? null) : data, error: null };
          };
        }
        if (op === 'update') {
          return (values) => {
            updates.push({ table, values });
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
  vi.doMock('../lib/safePost.js', async (importOriginal) => ({
    ...(await importOriginal()),
    postJson: (...args) => postJson(...args),
  }));
  // As the other content route tests: the jobs and workers aren't loaded.
  vi.doMock('../lib/planGuard.js', () => ({
    PlanLimitError: class PlanLimitError extends Error {},
    requireFeature: () => (req, res, next) => next(),
    enforceBriefQuota: vi.fn(),
    getBriefQuotaStatus: vi.fn(),
    getContentUsage: vi.fn(),
    getOpportunityRequestAllowance: vi.fn(),
    getOrgIdForUser: vi.fn(),
  }));
  vi.doMock('../lib/jobManager.js', () => ({ createJob: vi.fn(), getJob: vi.fn() }));
  vi.doMock('../lib/jobRunner.js', () => ({ runContentJob: vi.fn() }));
  vi.doMock('../lib/access.js', () => ({
    assertBrandAccess,
    assertOpportunitiesAccess: vi.fn(),
    assertOpportunityAccess,
    assertPromptAccess: vi.fn(),
  }));
  vi.doMock('../config/supabase.js', () => ({ default: { from: (table) => query(table) } }));
  vi.doMock('../lib/promptClusters.js', () => ({ loadClusters: vi.fn() }));
  vi.doMock('../lib/action-center/fromOpportunity.js', () => ({
    OPPORTUNITY_ACTION_KIND: 'content_opportunity',
    sendToActionCenter: vi.fn(),
  }));
  vi.doMock('../lib/aiProvider.js', () => ({ resolveModel: vi.fn() }));
  vi.doMock('../lib/logger.js', () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() };
    return { default: logger, logger };
  });

  const { default: router } = await import('./content.js');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'u1' };
    req.log = { error: vi.fn(), info: vi.fn() };
    next();
  });
  app.use('/api/content', router);

  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/content`;
}

const post = (path, body = {}) =>
  fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

const BRAND_ID = '11111111-1111-4111-8111-111111111111';

const OPPORTUNITY = {
  id: 'o1',
  brand_id: 'b1',
  prompt_id: null,
  title: 'Pricing comparison',
  description: 'Compare the plans.',
  type: 'comparison',
  impact: 'high',
  opportunity_score: '0.8',
  source_data: {},
  brief: null,
  status: 'new',
  updated_at: '2026-10-27T08:00:00Z',
};

beforeEach(async () => {
  vi.clearAllMocks();
  updates = [];
  rows = {
    webhook_configs: {
      id: 'w1',
      webhook_url: 'https://hooks.example/abc',
      webhook_secret: 'shh',
      events: ['opportunity.sent'],
    },
    brands: { name: 'Acme', industry: 'SaaS' },
    brand_domains: [{ domain: 'acme.example' }],
    competitors: [],
    content_opportunities: { status: 'sent' },
    profiles: { role: 'manager' },
  };
  assertOpportunityAccess.mockResolvedValue(OPPORTUNITY);
  assertBrandAccess.mockResolvedValue({ brand: { id: BRAND_ID }, orgId: 'org-1' });
  postJson.mockResolvedValue({ status: 200, answer: '{"ok":true}' });
  await startApp();
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe('POST /api/content/webhook-test', () => {
  const test = (body) => post('/webhook-test', { brandId: BRAND_ID, ...body });

  it('posts the test event with the secret, for 10 s, and says how it was answered', async () => {
    const res = await test({ webhookUrl: 'https://hooks.example/abc', webhookSecret: 'shh' });
    expect(await res.json()).toEqual({ success: true, status: 200, statusText: 'OK' });
    expect(assertBrandAccess).toHaveBeenCalledWith(BRAND_ID, 'u1');
    const [address, body, opts] = postJson.mock.calls[0];
    expect(address).toBe('https://hooks.example/abc');
    expect(JSON.parse(body)).toMatchObject({ event: 'webhook.test' });
    expect(opts).toEqual({ headers: { 'X-Webhook-Secret': 'shh' }, timeoutMs: 10_000 });
  });

  it('lets an admin test too', async () => {
    rows.profiles = { role: 'admin' };
    const res = await test({ webhookUrl: 'https://hooks.example/abc' });
    expect(res.status).toBe(200);
    expect(postJson).toHaveBeenCalledTimes(1);
  });

  it('reads a redirect as an answer, not a success', async () => {
    postJson.mockResolvedValue({ status: 302, answer: '' });
    const res = await test({ webhookUrl: 'https://hooks.example/abc' });
    // In a send's words, so the dialog says it as a send would (#1590).
    expect(await res.json()).toEqual({
      success: false,
      status: 302,
      statusText: 'Found',
      error: 'The webhook address redirects. Use the address it redirects to.',
    });
    expect(postJson.mock.calls[0][2]).toEqual({ headers: {}, timeoutMs: 10_000 });
  });

  it('says where a redirect points', async () => {
    postJson.mockResolvedValue({ status: 308, answer: '', location: 'https://hooks.example/v2' });
    const res = await test({ webhookUrl: 'https://hooks.example/abc' });
    expect(await res.json()).toEqual({
      success: false,
      status: 308,
      statusText: 'Permanent Redirect',
      error: 'The webhook address redirects. Use the address it redirects to.',
      location: 'https://hooks.example/v2',
    });
  });

  it('says why an address it refused failed', async () => {
    postJson.mockRejectedValue(new PageFetchError('blocked', '10.0.0.5 is not a public address'));
    const res = await test({ webhookUrl: 'http://10.0.0.5/hook' });
    expect(await res.json()).toEqual({
      success: false,
      status: 0,
      error: '10.0.0.5 is not a public address',
    });
  });

  it.each(['ENOTFOUND', 'ECONNREFUSED', 'CERT_HAS_EXPIRED'])(
    'names the network error when the webhook can’t be reached (%s)',
    async (errno) => {
      postJson.mockRejectedValue(
        new PageFetchError('unreachable', 'The webhook could not be reached', { errno }),
      );
      const res = await test({ webhookUrl: 'https://hooks.example/abc' });
      expect(await res.json()).toEqual({
        success: false,
        status: 0,
        error: `The webhook could not be reached (${errno})`,
      });
    },
  );

  it('leaves out a system error’s numeric errno', async () => {
    postJson.mockRejectedValue(Object.assign(new Error('socket hang up'), { errno: -54 }));
    const res = await test({ webhookUrl: 'https://hooks.example/abc' });
    expect(await res.json()).toEqual({ success: false, status: 0, error: 'socket hang up' });
  });

  it.each([
    ['no brand', { brandId: undefined }],
    ['a brand that isn’t an id', { brandId: 'acme' }],
    ['no address', { webhookUrl: '  ' }],
  ])('answers 400 for %s, posting nothing', async (_what, body) => {
    const res = await test({ webhookUrl: 'https://hooks.example/abc', ...body });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'Invalid request' });
    expect(postJson).not.toHaveBeenCalled();
  });

  it.each(['member', undefined])(
    'answers 403 to a %s, who can’t edit the webhook, posting nothing',
    async (role) => {
      rows.profiles = role ? { role } : null;
      const res = await test({ webhookUrl: 'https://hooks.example/abc' });
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({
        error: 'Only admins and managers can test the webhook.',
        code: 'forbidden',
      });
      expect(postJson).not.toHaveBeenCalled();
    },
  );

  it('answers 403 for another workspace’s brand, posting nothing', async () => {
    assertBrandAccess.mockRejectedValue(
      Object.assign(new Error("This brand isn't in your workspace"), {
        status: 403,
        code: 'not_in_workspace',
      }),
    );
    const res = await test({ webhookUrl: 'https://hooks.example/abc' });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "This brand isn't in your workspace",
      code: 'not_in_workspace',
    });
    expect(postJson).not.toHaveBeenCalled();
  });

  it('takes 10 tests a minute from a member, then answers 429', async () => {
    for (let i = 0; i < 10; i++) {
      const res = await test({ webhookUrl: 'https://hooks.example/abc' });
      expect(res.status).toBe(200);
    }
    const res = await test({ webhookUrl: 'https://hooks.example/abc' });
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({
      success: false,
      message: 'Too many requests, please try again later.',
    });
    expect(postJson).toHaveBeenCalledTimes(10);
  });
});

describe('POST /api/content/:id/send-webhook', () => {
  it('posts the opportunity to the brand’s webhook with its secret, and keeps the answer', async () => {
    const res = await post('/o1/send-webhook');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      webhookStatus: 200,
      opportunityStatus: 'sent',
    });
    const [address, body, opts] = postJson.mock.calls[0];
    expect(address).toBe('https://hooks.example/abc');
    expect(JSON.parse(body)).toMatchObject({
      event: 'opportunity.sent',
      opportunity: { id: 'o1', title: 'Pricing comparison' },
      brand: { name: 'Acme', domain: 'acme.example' },
    });
    expect(opts).toEqual({ headers: { 'X-Webhook-Secret': 'shh' } });
    const write = updates.find((u) => u.table === 'content_opportunities');
    expect(write.values).toMatchObject({
      status: 'sent',
      webhook_response: { status: 200, body: '{"ok":true}' },
    });
  });

  it.each([301, 302, 307, 308])(
    'answers 502 on a %i, which no send follows, and marks nothing sent',
    async (status) => {
      postJson.mockResolvedValue({ status, answer: '' });
      const res = await post('/o1/send-webhook');
      expect(res.status).toBe(502);
      expect(await res.json()).toEqual({
        error: 'The webhook address redirects. Use the address it redirects to.',
        code: 'webhook_redirect',
        webhookStatus: status,
      });
      expect(updates.find((u) => u.table === 'content_opportunities')).toBeUndefined();
    },
  );

  it('marks it sent on any other answer, an error too, keeping the status it got', async () => {
    postJson.mockResolvedValue({ status: 400, answer: 'bad' });
    const res = await post('/o1/send-webhook');
    expect(await res.json()).toMatchObject({ success: true, webhookStatus: 400 });
    const write = updates.find((u) => u.table === 'content_opportunities');
    expect(write.values).toMatchObject({ status: 'sent', webhook_response: { status: 400 } });
  });

  it('answers 500 when the address is refused, and marks nothing sent', async () => {
    postJson.mockRejectedValue(new PageFetchError('blocked', '10.0.0.5 is not a public address'));
    const res = await post('/o1/send-webhook');
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({
      error: 'Failed to send webhook',
      details: '10.0.0.5 is not a public address',
    });
    expect(updates.find((u) => u.table === 'content_opportunities')).toBeUndefined();
  });
});

describe('POST /api/content/bulk/send-webhook', () => {
  it('posts each opportunity as the single send does, and counts a refused one failed', async () => {
    rows.content_opportunities = [OPPORTUNITY, { ...OPPORTUNITY, id: 'o2', title: 'FAQ page' }];
    postJson
      .mockResolvedValueOnce({ status: 200, answer: 'ok' })
      .mockRejectedValueOnce(new Error('The webhook could not be reached'));
    const res = await post('/bulk/send-webhook', { ids: ['o1', 'o2'] });
    expect(await res.json()).toEqual({ sent: 1, failed: 1, redirected: 0 });
    expect(
      postJson.mock.calls.map(([address, body, opts]) => [
        address,
        JSON.parse(body).opportunity.id,
        opts,
      ]),
    ).toEqual([
      ['https://hooks.example/abc', 'o1', { headers: { 'X-Webhook-Secret': 'shh' } }],
      ['https://hooks.example/abc', 'o2', { headers: { 'X-Webhook-Secret': 'shh' } }],
    ]);
    const writes = updates.filter((u) => u.table === 'content_opportunities');
    expect(writes).toHaveLength(1);
    expect(writes[0].values.webhook_response).toEqual({ status: 200, body: 'ok' });
  });

  it('counts a redirect failed, and redirected, and marks only the delivered one sent', async () => {
    rows.content_opportunities = [OPPORTUNITY, { ...OPPORTUNITY, id: 'o2', title: 'FAQ page' }];
    postJson
      .mockResolvedValueOnce({ status: 302, answer: '' })
      .mockResolvedValueOnce({ status: 200, answer: 'ok' });
    const res = await post('/bulk/send-webhook', { ids: ['o1', 'o2'] });
    expect(await res.json()).toEqual({ sent: 1, failed: 1, redirected: 1 });
    const writes = updates.filter((u) => u.table === 'content_opportunities');
    expect(writes).toHaveLength(1);
    expect(writes[0].values.webhook_response).toEqual({ status: 200, body: 'ok' });
  });
});
