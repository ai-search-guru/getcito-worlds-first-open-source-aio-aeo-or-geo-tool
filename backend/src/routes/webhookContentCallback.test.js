import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

const { mockFrom, state } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  state: { opportunities: [], configs: [] },
}));

vi.mock('../config/supabase.js', () => ({
  default: { from: mockFrom },
}));
vi.mock('../middleware/rateLimiter.js', () => ({
  webhookCallbackLimiter: (_req, _res, next) => next(),
  webhookCallbackAuthFailureLimiter: (_req, _res, next) => next(),
}));
const isBrandActive = vi.hoisted(() => vi.fn());
vi.mock('../lib/activeSubscriptions.js', () => ({ isBrandActive }));

const { default: router } = await import('./webhookContentCallback.js');

function table(name) {
  const q = { op: 'select', filters: [], payload: null, returning: false };
  const rows = () =>
    (name === 'content_opportunities' ? state.opportunities : state.configs).filter((row) =>
      q.filters.every((matches) => matches(row)),
    );
  const run = (single) => {
    const matched = rows();
    if (q.op === 'update') {
      for (const row of matched) Object.assign(row, q.payload);
    }
    const data = single ? (matched[0] ?? null) : matched;
    return { data: q.returning || q.op === 'select' ? data : null, error: null };
  };
  const chain = {
    select: () => ((q.returning = q.op !== 'select'), chain),
    eq: (column, value) => (q.filters.push((row) => row[column] === value), chain),
    limit: () => chain,
    update: (payload) => ((q.op = 'update'), (q.payload = payload), chain),
    maybeSingle: async () => run(true),
    then: (resolve, reject) => Promise.resolve(run(false)).then(resolve, reject),
  };
  return chain;
}

let server;
let baseUrl;

async function startApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.log = { error: vi.fn() };
    next();
  });
  app.use('/webhooks/content', router);
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl =
    'http://127.0.0.1:' +
    server.address().port +
    '/webhooks/content/5e8cd4c2-2bc4-4fb7-8711-bc0ad1bb4a29/status';
}

beforeEach(async () => {
  state.opportunities = [
    {
      id: '5e8cd4c2-2bc4-4fb7-8711-bc0ad1bb4a29',
      brand_id: 'brand-1',
      status: 'sent',
      source_data: { kept: true },
      updated_at: '2026-10-20T00:00:00.000Z',
    },
  ];
  state.configs = [{ brand_id: 'brand-1', is_active: true, webhook_secret: 'shared-secret' }];
  mockFrom.mockReset();
  mockFrom.mockImplementation((name) => table(name));
  // Every brand's organization on a plan unless a test says otherwise.
  isBrandActive.mockReset().mockResolvedValue(true);
  await startApp();
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
});

async function send({
  secret,
  status = 'in_progress',
  id = '5e8cd4c2-2bc4-4fb7-8711-bc0ad1bb4a29',
} = {}) {
  const url = baseUrl.replace('5e8cd4c2-2bc4-4fb7-8711-bc0ad1bb4a29', id);
  return fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(secret === undefined ? {} : { 'X-Webhook-Secret': secret }),
    },
    body: JSON.stringify({ status }),
  });
}

describe('POST /webhooks/content/:id/status', () => {
  /**
   * Once the plan has ended (2026-10-27): a 2xx, so the workflow doesn't
   * fail or retry, and the opportunity left as it is.
   */
  it("changes nothing for a brand whose organization's plan has ended, and answers 202", async () => {
    isBrandActive.mockResolvedValue(false);
    const response = await send({ secret: 'shared-secret', status: 'completed' });
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      success: false,
      ignored: true,
      code: 'subscription_inactive',
    });
    expect(isBrandActive).toHaveBeenCalledWith('brand-1');
    expect(state.opportunities[0].status).toBe('sent');
  });

  it('asks about the plan only once the secret matched', async () => {
    isBrandActive.mockResolvedValue(false);
    expect((await send({ secret: 'wrong-secret' })).status).toBe(401);
    expect(isBrandActive).not.toHaveBeenCalled();
  });

  it('rejects a missing secret', async () => {
    const response = await send();
    expect(response.status).toBe(401);
    expect(state.opportunities[0].status).toBe('sent');
  });

  it('rejects a wrong secret', async () => {
    const response = await send({ secret: 'wrong-secret' });
    expect(response.status).toBe(401);
    expect(state.opportunities[0].status).toBe('sent');
  });

  it('rejects a secret belonging to another brand', async () => {
    state.configs.push({
      brand_id: 'brand-2',
      is_active: true,
      webhook_secret: 'other-brand-secret',
    });
    const response = await send({ secret: 'other-brand-secret' });
    expect(response.status).toBe(401);
    expect(state.opportunities[0].status).toBe('sent');
  });

  it('rejects callbacks when the active config has no secret configured', async () => {
    state.configs[0].webhook_secret = null;
    const response = await send({ secret: 'shared-secret' });
    expect(response.status).toBe(401);
    expect(state.opportunities[0].status).toBe('sent');
  });

  it('returns 401 for a valid UUID that does not exist', async () => {
    state.opportunities = [];
    const response = await send({
      secret: 'shared-secret',
      id: '3b77bbdb-df2c-44da-aa57-823d2bccb991',
    });
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Invalid webhook credentials' });
  });

  it('returns the same 401 for a malformed identifier without querying Postgres', async () => {
    const response = await send({ secret: 'shared-secret', id: 'not-a-uuid' });
    expect(response.status).toBe(401);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('updates the opportunity when the webhook secret matches', async () => {
    const response = await send({ secret: 'shared-secret', status: 'done' });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true, status: 'done' });
    expect(state.opportunities[0].status).toBe('done');
  });

  it('rejects a status outside the existing status whitelist', async () => {
    const response = await send({ secret: 'shared-secret', status: 'delete' });
    expect(response.status).toBe(400);
    expect(state.opportunities[0].status).toBe('sent');
  });
});
