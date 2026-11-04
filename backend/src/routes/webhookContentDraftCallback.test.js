import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

/**
 * Send to CMS's callback (#1331): the workspace's automation tells how a sent
 * page went in the CMS (live at an address, or failed), with its webhook's
 * secret.
 */

const { state } = vi.hoisted(() => ({
  state: { deliveries: [], configs: [], drafts: [], rpcs: [] },
}));

vi.mock('../config/supabase.js', () => ({
  default: {
    rpc: async (name, args) => (state.rpcs.push({ name, args }), { data: 'v1', error: null }),
    from: (name) => {
      const rows =
        name === 'content_draft_deliveries'
          ? state.deliveries
          : name === 'content_drafts'
            ? state.drafts
            : state.configs;
      const q = { filters: [], update: null, order: null };
      const matched = () => {
        const found = rows.filter((row) => q.filters.every((f) => f(row)));
        if (q.order) found.sort((a, b) => (a[q.order] < b[q.order] ? 1 : -1));
        return found;
      };
      const run = (single) => {
        // A draft write that fails once (state.failDraft).
        if (q.update && name === 'content_drafts' && state.failDraft) {
          state.failDraft = false;
          return { data: null, error: { message: 'down' } };
        }
        const found = matched();
        if (q.update) for (const row of found) Object.assign(row, q.update);
        return { data: single ? (found[0] ?? null) : found, error: null };
      };
      const chain = {
        select: () => chain,
        eq: (column, value) => (q.filters.push((row) => row[column] === value), chain),
        neq: (column, value) => (q.filters.push((row) => row[column] !== value), chain),
        update: (row) => ((q.update = row), chain),
        order: (column) => ((q.order = column), chain),
        limit: () => chain,
        maybeSingle: async () => run(true),
        then: (resolve, reject) => Promise.resolve(run(false)).then(resolve, reject),
      };
      return chain;
    },
  },
}));
vi.mock('../middleware/rateLimiter.js', () => ({
  webhookCallbackLimiter: (_req, _res, next) => next(),
  webhookCallbackAuthFailureLimiter: (_req, _res, next) => next(),
}));
const isBrandActive = vi.hoisted(() => vi.fn());
vi.mock('../lib/activeSubscriptions.js', () => ({ isBrandActive }));

const { default: router } = await import('./webhookContentDraftCallback.js');

const DELIVERY = '5e8cd4c2-2bc4-4fb7-8711-bc0ad1bb4a29';
let server;
let baseUrl;

beforeEach(async () => {
  // Every brand's organization on a plan unless a test says otherwise.
  isBrandActive.mockReset().mockResolvedValue(true);
  state.deliveries = [
    {
      id: DELIVERY,
      brand_id: 'b1',
      draft_id: 'd1',
      status: 'sent',
      target: 'webhook',
      created_at: '2026-10-24T10:00:00Z',
    },
  ];
  state.drafts = [{ id: 'd1', status: 'ready', published_url: null }];
  state.rpcs = [];
  state.configs = [
    {
      brand_id: 'b1',
      is_active: true,
      webhook_secret: 's3cret',
      events: ['content_draft.sent'],
    },
  ];
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.log = { error: vi.fn(), warn: vi.fn() };
    next();
  });
  app.use('/webhooks/content-drafts', router);
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/webhooks/content-drafts`;
});

afterEach(() => new Promise((resolve) => server.close(resolve)));

const call = (body, { id = DELIVERY, secret = 's3cret' } = {}) =>
  fetch(`${baseUrl}/${id}/status`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(secret ? { 'X-Webhook-Secret': secret } : {}),
    },
    body: JSON.stringify(body),
  });

const published = (url, more = {}) => call({ status: 'published', url, ...more });

describe('POST /webhooks/content-drafts/:deliveryId/status', () => {
  /**
   * Once the plan has ended (2026-10-27): a 2xx, so the workflow doesn't
   * fail or retry, and the delivery, its page and History left as they are.
   */
  it("writes nothing for a brand whose organization's plan has ended, and answers 202", async () => {
    isBrandActive.mockResolvedValue(false);
    const res = await published('https://acme.example/live');
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({
      success: false,
      ignored: true,
      code: 'subscription_inactive',
    });
    expect(isBrandActive).toHaveBeenCalledWith('b1');
    expect(state.deliveries[0].status).toBe('sent');
    expect(state.drafts[0].status).toBe('ready');
    expect(state.rpcs).toEqual([]);

    expect((await call({ status: 'failed', reason: 'CMS down' })).status).toBe(202);
    expect(state.deliveries[0].status).toBe('sent');
  });

  it('asks about the plan only once the secret matched', async () => {
    isBrandActive.mockResolvedValue(false);
    const res = await call({ status: 'published', url: 'https://a.example' }, { secret: 'nope' });
    expect(res.status).toBe(401);
    expect(isBrandActive).not.toHaveBeenCalled();
  });

  it('marks the delivery and its page published at the address, keeping a publish version', async () => {
    const res = await published('https://acme.example/blog/best-aeo-tools', { externalId: '812' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, status: 'published' });
    expect(state.deliveries[0]).toMatchObject({
      status: 'published',
      published_url: 'https://acme.example/blog/best-aeo-tools',
      published_at: expect.any(String),
      external_id: '812',
    });
    expect(state.drafts[0]).toMatchObject({
      status: 'published',
      published_url: 'https://acme.example/blog/best-aeo-tools',
    });
    expect(state.rpcs).toEqual([
      { name: 'content_draft_snapshot', args: { p_draft_id: 'd1', p_origin: 'publish' } },
    ]);
  });

  it('keeps no second version, nor a new time, when the workflow says it again', async () => {
    await published('https://acme.example/live');
    const at = state.deliveries[0].published_at;
    await new Promise((resolve) => setTimeout(resolve, 5));
    await published('https://acme.example/live');
    expect(state.rpcs).toHaveLength(1);
    expect(state.deliveries[0].published_at).toBe(at);
  });

  it('keeps the page as published again when a new send goes live at the same address', async () => {
    // Published once; the page changed and was sent again, the post updated in place.
    state.deliveries[0] = {
      ...state.deliveries[0],
      status: 'published',
      published_url: 'https://acme.example/live',
    };
    state.drafts[0] = { id: 'd1', status: 'published', published_url: 'https://acme.example/live' };
    const NEWER = '5e8cd4c2-2bc4-4fb7-8711-bc0ad1bb4a30';
    state.deliveries.push({
      id: NEWER,
      brand_id: 'b1',
      draft_id: 'd1',
      status: 'sent',
      target: 'webhook',
      created_at: '2026-10-24T12:00:00Z',
    });
    const res = await call(
      { status: 'published', url: 'https://acme.example/live' },
      { id: NEWER },
    );
    expect(res.status).toBe(200);
    expect(state.rpcs).toEqual([
      { name: 'content_draft_snapshot', args: { p_draft_id: 'd1', p_origin: 'publish' } },
    ]);
    expect(state.drafts[0].published_at).toEqual(expect.any(String));
  });

  it('marks the delivery failed with the workflow’s reason, the page left as it is', async () => {
    const res = await call({ status: 'failed', reason: 'Slug already taken', externalId: '812' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, status: 'failed' });
    expect(state.deliveries[0]).toMatchObject({
      status: 'failed',
      error: 'Slug already taken',
      external_id: '812',
    });
    expect(state.drafts[0]).toMatchObject({ status: 'ready', published_url: null });
    expect(state.rpcs).toEqual([]);

    await call({ status: 'failed' });
    expect(state.deliveries[0].error).toBe('Your workflow said the page wasn’t published');
  });

  it('keeps a published page published when a failure comes after', async () => {
    await published('https://acme.example/live');
    const res = await call({ status: 'failed', reason: 'Later step' });
    expect(await res.json()).toEqual({ success: true, status: 'published' });
    expect(state.deliveries[0]).toMatchObject({
      status: 'published',
      published_url: 'https://acme.example/live',
    });
  });

  it('answers the same for a wrong secret, an unknown or malformed delivery, and a webhook not taking the event', async () => {
    const denied = { error: 'Invalid webhook credentials' };
    for (const res of [
      await call({ status: 'published', url: 'https://a.example/x' }, { secret: 'wrong' }),
      await call({ status: 'published', url: 'https://a.example/x' }, { secret: null }),
      await call(
        { status: 'published', url: 'https://a.example/x' },
        { id: '5e8cd4c2-2bc4-4fb7-8711-bc0ad1bb4a30' },
      ),
      await call({ status: 'published', url: 'https://a.example/x' }, { id: 'not-an-id' }),
    ]) {
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual(denied);
    }
    state.configs[0].events = ['opportunity.sent'];
    const res = await published('https://a.example/x');
    expect(res.status).toBe(401);
    expect(state.deliveries[0].status).toBe('sent');
  });

  it('reads what a workflow left unmapped as left out, and a CMS’s number as its id', async () => {
    const res = await call({
      status: ' Published ',
      url: 'https://acme.example/live',
      externalId: 812,
      reason: '',
    });
    expect(res.status).toBe(200);
    expect(state.deliveries[0]).toMatchObject({ status: 'published', external_id: '812' });

    state.deliveries[0].status = 'sent';
    await call({ status: 'failed', url: null, externalId: '  ', reason: null });
    expect(state.deliveries[0]).toMatchObject({
      status: 'failed',
      error: 'Your workflow said the page wasn’t published',
      external_id: '812',
    });
    expect((await call({ status: 'failed', externalId: 1.5 })).status).toBe(400);
  });

  it('takes only an http(s) address up to 2,048 characters, as the browser reads it', async () => {
    expect((await published('javascript:alert(1)')).status).toBe(400);
    // Sign-in details would be kept and shown as a link.
    expect((await published('https://admin:pw@acme.example/live')).status).toBe(400);
    expect((await call({ status: 'published' })).status).toBe(400);
    expect((await call({ url: 'https://acme.example/x' })).status).toBe(400);
    expect((await call({ status: 'live', url: 'https://acme.example/x' })).status).toBe(400);
    // Under the limit as sent, past it once the browser escapes the spaces.
    const spaced = `https://acme.example/${' x'.repeat(1000)}`;
    expect(spaced.length).toBeLessThan(2048);
    expect((await published(spaced)).status).toBe(400);
    expect(state.deliveries[0].status).toBe('sent');
    expect((await published('https://acme.example/a\nb')).status).toBe(200);
    expect(state.deliveries[0].published_url).toBe('https://acme.example/ab');
  });

  it('counts a callback that lands before the send’s answer, or after it gave up', async () => {
    for (const status of ['queued', 'failed']) {
      state.deliveries[0].status = status;
      const res = await published('https://acme.example/live');
      expect(res.status).toBe(200);
      expect(state.deliveries[0].status).toBe('published');
    }
  });

  it('does it all again on the retry of a callback whose page write failed', async () => {
    state.failDraft = true;
    expect((await published('https://acme.example/live')).status).toBe(500);
    expect(state.deliveries[0].status).toBe('sent');
    expect((await published('https://acme.example/live')).status).toBe(200);
    expect(state.drafts[0]).toMatchObject({ status: 'published' });
    expect(state.deliveries[0]).toMatchObject({ status: 'published' });
    expect(state.rpcs).toHaveLength(1);
  });

  it('keeps a CMS id a retry adds, and nothing else', async () => {
    await published('https://acme.example/live');
    const at = state.deliveries[0].published_at;
    await published('https://acme.example/live', { externalId: '812' });
    expect(state.deliveries[0]).toMatchObject({ external_id: '812', published_at: at });
    expect(state.rpcs).toHaveLength(1);
  });

  it('answers a Webflow delivery’s id as it does an unknown one: the API writes those itself', async () => {
    state.deliveries[0].target = 'webflow';
    const res = await published('https://acme.example/live');
    expect(res.status).toBe(401);
    expect(state.deliveries[0].status).toBe('sent');
  });

  it('moves the page’s address only for its latest delivery', async () => {
    state.deliveries.push({
      id: 'newer',
      brand_id: 'b1',
      draft_id: 'd1',
      status: 'sent',
      target: 'webhook',
      created_at: '2026-10-24T11:00:00Z',
    });
    const res = await published('https://acme.example/old');
    expect(res.status).toBe(200);
    expect(state.deliveries[0].published_url).toBe('https://acme.example/old');
    expect(state.drafts[0]).toMatchObject({ status: 'ready', published_url: null });
    expect(state.rpcs).toEqual([]);
  });
});
