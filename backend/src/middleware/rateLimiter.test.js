import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import {
  apiLimiter,
  apiLimiterKey,
  botIngestKey,
  catalogCategoryLimiter,
  catalogLimiter,
  cmsLimiter,
  cmsStatusLimiter,
  isInternalChatBudgetCall,
  isJourneyBeacon,
  journeyEventKey,
  shoppingPathLimiter,
  webhookCallbackKey,
} from './rateLimiter.js';
import { markBotSenderVerified, markTokenVerified, clearVerifiedTokens } from './verifiedTokens.js';

function reqWith({ authorization, ip = '203.0.113.7' } = {}) {
  return { headers: authorization ? { authorization } : {}, ip };
}

describe('rate-limiter – apiLimiterKey', () => {
  beforeEach(() => clearVerifiedTokens());

  it('keeps unverified Authorization headers in the caller IP bucket', () => {
    const forged = apiLimiterKey(reqWith({ authorization: 'Bearer forged-1', ip: '1.1.1.1' }));
    const forged2 = apiLimiterKey(reqWith({ authorization: 'Bearer forged-2', ip: '1.1.1.1' }));
    const anonymous = apiLimiterKey(reqWith({ ip: '1.1.1.1' }));
    expect(forged).toBe(anonymous);
    expect(forged2).toBe(anonymous);
  });

  it('buckets verified tokens by user across IPs', () => {
    markTokenVerified('Bearer tok-1', 'user-a');
    const a = apiLimiterKey(reqWith({ authorization: 'Bearer tok-1', ip: '1.1.1.1' }));
    const b = apiLimiterKey(reqWith({ authorization: 'Bearer tok-1', ip: '2.2.2.2' }));
    expect(a).toBe('user:user-a');
    expect(b).toBe('user:user-a');
  });

  it('maps a refreshed token for the same user to the same bucket', () => {
    markTokenVerified('Bearer tok-old', 'user-a');
    markTokenVerified('Bearer tok-new', 'user-a');
    const oldKey = apiLimiterKey(reqWith({ authorization: 'Bearer tok-old' }));
    const newKey = apiLimiterKey(reqWith({ authorization: 'Bearer tok-new' }));
    expect(oldKey).toBe(newKey);
  });

  it('gives different verified users different buckets', () => {
    markTokenVerified('Bearer tok-1', 'user-a');
    markTokenVerified('Bearer tok-2', 'user-b');
    const a = apiLimiterKey(reqWith({ authorization: 'Bearer tok-1' }));
    const b = apiLimiterKey(reqWith({ authorization: 'Bearer tok-2' }));
    expect(a).not.toBe(b);
  });

  it('falls back to the caller IP for anonymous requests', () => {
    const a = apiLimiterKey(reqWith({ ip: '1.1.1.1' }));
    const b = apiLimiterKey(reqWith({ ip: '2.2.2.2' }));
    expect(a).not.toBe(b);
    expect(a).toContain('1.1.1.1');
  });

  it('collapses an IPv6 subnet into one anonymous bucket', () => {
    const a = apiLimiterKey(reqWith({ ip: '2001:db8:abcd:12::1' }));
    const b = apiLimiterKey(reqWith({ ip: '2001:db8:abcd:12::2' }));
    expect(a).toBe(b);
  });

  it('keeps v4-mapped IPv6 addresses distinct per IPv4 address', () => {
    const a = apiLimiterKey(reqWith({ ip: '::ffff:1.1.1.1' }));
    const b = apiLimiterKey(reqWith({ ip: '::ffff:2.2.2.2' }));
    expect(a).not.toBe(b);
  });
});

describe('rate-limiter – botIngestKey', () => {
  beforeEach(() => clearVerifiedTokens());

  it('buckets a matched secret by its connection, whatever the address', () => {
    markBotSenderVerified('Bearer getcito_bot_one', 'c1');
    markBotSenderVerified('Bearer getcito_bot_two', 'c2');
    const a = botIngestKey(reqWith({ authorization: 'Bearer getcito_bot_one', ip: '1.1.1.1' }));
    const b = botIngestKey(reqWith({ authorization: 'Bearer getcito_bot_one', ip: '2.2.2.2' }));
    const other = botIngestKey(reqWith({ authorization: 'Bearer getcito_bot_two', ip: '1.1.1.1' }));
    expect(a).toBe('bot:c1');
    expect(b).toBe('bot:c1');
    expect(other).toBe('bot:c2');
  });

  it('keeps unknown secrets in the caller IP bucket, so made-up ones share it', () => {
    const one = botIngestKey(
      reqWith({ authorization: 'Bearer getcito_bot_made_up_1', ip: '1.1.1.1' }),
    );
    const two = botIngestKey(
      reqWith({ authorization: 'Bearer getcito_bot_made_up_2', ip: '1.1.1.1' }),
    );
    expect(one).toBe('ip:1.1.1.1');
    expect(two).toBe('ip:1.1.1.1');
  });

  it('falls back to the IP without a secret', () => {
    expect(botIngestKey(reqWith({ ip: '1.1.1.1' }))).toBe('ip:1.1.1.1');
  });

  it("never gives a bot secret a dashboard user's bucket", () => {
    markBotSenderVerified('Bearer getcito_bot_one', 'c1');
    expect(apiLimiterKey(reqWith({ authorization: 'Bearer getcito_bot_one', ip: '1.1.1.1' }))).toBe(
      'ip:1.1.1.1',
    );
  });
});

describe('rate-limiter – webhookCallbackKey', () => {
  it('buckets callbacks by the secret hash across shared provider IPs', () => {
    const a = webhookCallbackKey({ headers: { 'x-webhook-secret': 'shared-one' }, ip: '1.1.1.1' });
    const b = webhookCallbackKey({ headers: { 'x-webhook-secret': 'shared-one' }, ip: '2.2.2.2' });
    const other = webhookCallbackKey({
      headers: { 'x-webhook-secret': 'shared-two' },
      ip: '1.1.1.1',
    });
    expect(a).toBe(b);
    expect(a).not.toBe(other);
    expect(a).toMatch(/^webhook:[0-9a-f]{64}$/);
    expect(a).not.toContain('shared-one');
  });

  it('falls back to the anonymous IP bucket when the secret is missing', () => {
    expect(webhookCallbackKey({ headers: {}, ip: '1.1.1.1' })).toBe('ip:1.1.1.1');
  });
});

describe('rate-limiter – journey events (CE-017)', () => {
  it('buckets a journey event by its tracking code, whatever the address', () => {
    expect(journeyEventKey({ params: { trackingCode: 'abc123' }, ip: '203.0.113.7' })).toBe(
      'journey:abc123',
    );
    expect(journeyEventKey({ params: { trackingCode: 'abc123' }, ip: '198.51.100.9' })).toBe(
      'journey:abc123',
    );
  });

  it('counts only pageviews and conversions, as a string or a parsed body: never a visit', () => {
    expect(isJourneyBeacon('{"k":"pv","u":"https://acme.example/"}')).toBe(true);
    expect(isJourneyBeacon({ k: 'cv' })).toBe(true);
    expect(isJourneyBeacon('{"u":"https://acme.example/","s":"chatgpt.com"}')).toBe(false);
    expect(isJourneyBeacon({ k: 'nf' })).toBe(false);
    expect(isJourneyBeacon('not json')).toBe(false);
    expect(isJourneyBeacon(undefined)).toBe(false);
  });
});

describe('rate-limiter – catalog buckets', () => {
  it("gives category page changes a wider bucket than the syncs', apart from them", async () => {
    const app = express();
    app.post('/sync', catalogLimiter, (_req, res) => res.json({}));
    app.put('/categories', catalogCategoryLimiter, (_req, res) => res.json({}));
    const server = await new Promise((resolve) => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    const statuses = async (method, path, n) => {
      const out = [];
      for (let i = 0; i < n; i += 1) out.push((await fetch(base + path, { method })).status);
      return out;
    };
    try {
      // The syncs' 20 a quarter-hour run out…
      expect((await statuses('POST', '/sync', 21)).at(-1)).toBe(429);
      // …and a person changing the table row by row goes on past them.
      expect(new Set(await statuses('PUT', '/categories', 40))).toEqual(new Set([200]));
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

describe('rate-limiter – CMS buckets', () => {
  it("keeps the Library's publish checks apart from connecting a CMS", async () => {
    const app = express();
    app.post('/webflow-status', cmsStatusLimiter, (_req, res) => res.json({}));
    app.post('/cms', cmsLimiter, (_req, res) => res.json({}));
    const server = await new Promise((resolve) => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    const statuses = async (path, n) => {
      const out = [];
      for (let i = 0; i < n; i += 1)
        out.push((await fetch(base + path, { method: 'POST' })).status);
      return out;
    };
    try {
      // Opening the Library 45 times (4 checks each) uses up its own 180…
      const checks = await statuses('/webflow-status', 181);
      expect(new Set(checks.slice(0, 180))).toEqual(new Set([200]));
      expect(checks.at(-1)).toBe(429);
      // …and connecting a CMS still goes through (its bucket is the module's: a few here).
      expect(new Set(await statuses('/cms', 5))).toEqual(new Set([200]));
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

describe('rate-limiter – shopping path builds', () => {
  it("gives a draft's shopping path builds a bucket of their own: 30 a quarter-hour", async () => {
    const app = express();
    app.post('/shopping-path', shoppingPathLimiter, (_req, res) => res.json({}));
    app.post('/cms', cmsLimiter, (_req, res) => res.json({}));
    const server = await new Promise((resolve) => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    const statuses = async (path, n) => {
      const out = [];
      for (let i = 0; i < n; i += 1)
        out.push((await fetch(base + path, { method: 'POST' })).status);
      return out;
    };
    try {
      const builds = await statuses('/shopping-path', 31);
      expect(new Set(builds.slice(0, 30))).toEqual(new Set([200]));
      expect(builds.at(-1)).toBe(429);
      // The other buckets keep theirs.
      expect(await statuses('/cms', 1)).toEqual([200]);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

describe('rate-limiter – the Chat engine’s budget calls', () => {
  beforeEach(() => vi.stubEnv('CRON_SECRET', 'chat-secret'));
  afterEach(() => vi.unstubAllEnvs());

  const req = (path, authorization) => ({
    baseUrl: '/api',
    path,
    headers: authorization ? { authorization } : {},
  });

  it('exempts only the budget path, and only with the internal secret', () => {
    expect(
      isInternalChatBudgetCall(req('/internal/chat/budget/reserve', 'Bearer chat-secret')),
    ).toBe(true);
    expect(
      isInternalChatBudgetCall(req('/internal/chat/budget/charge', 'Bearer chat-secret')),
    ).toBe(true);
    // Chat's page reads (fetch_page) come the same way.
    expect(isInternalChatBudgetCall(req('/internal/chat/pages/open', 'Bearer chat-secret'))).toBe(
      true,
    );
    expect(isInternalChatBudgetCall(req('/internal/chat/pages/open'))).toBe(false);
    // And the model menu's reads (W4-01).
    expect(isInternalChatBudgetCall(req('/internal/chat/models', 'Bearer chat-secret'))).toBe(true);
    expect(isInternalChatBudgetCall(req('/internal/chat/models'))).toBe(false);
    // Without it, with another, or with the secret on any other path: counted.
    expect(isInternalChatBudgetCall(req('/internal/chat/budget/reserve'))).toBe(false);
    expect(isInternalChatBudgetCall(req('/internal/chat/budget/reserve', 'Bearer nope'))).toBe(
      false,
    );
    expect(isInternalChatBudgetCall(req('/internal/chat/budget/reserve', 'chat-secret'))).toBe(
      false,
    );
    expect(isInternalChatBudgetCall(req('/internal/ai-usage', 'Bearer chat-secret'))).toBe(false);
    expect(isInternalChatBudgetCall(req('/internal/chat/budgetx', 'Bearer chat-secret'))).toBe(
      false,
    );
    // No secret configured: nothing is exempt.
    vi.stubEnv('CRON_SECRET', '');
    expect(isInternalChatBudgetCall(req('/internal/chat/budget/reserve', 'Bearer '))).toBe(false);
  });

  it('never stops the secret’s budget calls, and still limits everything else from that address', async () => {
    const app = express();
    app.use('/api', apiLimiter);
    app.post('/api/internal/chat/budget/reserve', (_req, res) => res.json({}));
    app.get('/api/internal/ai-usage', (_req, res) => res.json({}));
    const server = await new Promise((resolve) => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const call = (method, path, secret) =>
      fetch(base + path, {
        method,
        headers: secret ? { Authorization: `Bearer ${secret}` } : {},
      }).then((r) => r.status);
    try {
      // Past the address's 250 a quarter-hour: none counted, none stopped.
      const budget = [];
      for (let i = 0; i < 260; i += 1) {
        budget.push(await call('POST', '/internal/chat/budget/reserve', 'chat-secret'));
      }
      expect(new Set(budget)).toEqual(new Set([200]));

      // The same address without the secret still gets its 250…
      const plain = [];
      for (let i = 0; i < 250; i += 1) plain.push(await call('GET', '/internal/ai-usage'));
      expect(new Set(plain)).toEqual(new Set([200]));
      // …then is stopped, on the budget path without the secret, with a wrong
      // one, and on another internal path with the right one.
      expect(await call('POST', '/internal/chat/budget/reserve')).toBe(429);
      expect(await call('POST', '/internal/chat/budget/reserve', 'nope')).toBe(429);
      expect(await call('GET', '/internal/ai-usage', 'chat-secret')).toBe(429);
      // The secret's budget calls go on.
      expect(await call('POST', '/internal/chat/budget/reserve', 'chat-secret')).toBe(200);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
