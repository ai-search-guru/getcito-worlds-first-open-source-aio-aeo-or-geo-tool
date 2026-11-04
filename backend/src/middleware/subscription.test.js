import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import express from 'express';

/**
 * Read-only once the plan has ended (2026-10-27): on the cloud, a signed-in
 * person's writes are refused while their organization has no active or
 * trialing subscription, but for billing's named routes, the routes that
 * stop a cost or take back an access, and onboarding's routes for an
 * organization that never subscribed, a few a day.
 */

const reads = [];
let profile;
let org;
vi.mock('../config/supabase.js', () => ({
  default: {
    from: (table) => {
      reads.push(table);
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: table === 'profiles' ? profile : org, error: null }),
      };
      return chain;
    },
  },
}));
vi.mock('../lib/logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

const {
  ACTIVE_CACHE_MS,
  BILLING_ROUTES,
  COST_STOPPING,
  DATA_REMOVAL,
  DEMO_ROUTES,
  MAX_ENTRIES,
  ONBOARDING_DAILY_CALLS,
  ONBOARDING_LIMIT_REACHED,
  ONBOARDING_ROUTES,
  SUBSCRIPTION_INACTIVE,
  clearSubscriptionCache,
  requireActiveSubscription,
  subscriptionAccess,
} = await import('./subscription.js');

function makeRes() {
  const res = { status: vi.fn(), json: vi.fn(), set: vi.fn() };
  res.status.mockReturnValue(res);
  res.set.mockReturnValue(res);
  return res;
}

async function run({ method = 'POST', path = '/prompts/suggest', user = { id: 'u1' } } = {}) {
  const res = makeRes();
  const next = vi.fn();
  await requireActiveSubscription({ method, path, user }, res, next);
  return { res, next };
}

const ended = { subscription_status: 'canceled', stripe_subscription_id: 'sub_1' };
const neverSubscribed = { subscription_status: 'incomplete', stripe_subscription_id: null };

const ONBOARDING = [
  ['POST', '/topics/suggest'],
  ['POST', '/prompts/from-topics'],
  ['POST', '/competitors/suggest'],
  ['POST', '/brands/b1/detect-site-type'],
];

beforeEach(() => {
  vi.stubEnv('IS_CLOUD', 'true');
  reads.length = 0;
  clearSubscriptionCache();
  profile = { organization_id: 'org-1' };
  org = { subscription_status: 'active', stripe_subscription_id: 'sub_1' };
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('requireActiveSubscription', () => {
  it('lets an active or trialing organization write', async () => {
    for (const status of ['active', 'trialing']) {
      clearSubscriptionCache();
      org = { subscription_status: status, stripe_subscription_id: 'sub_1' };
      const { res, next } = await run();
      expect(next).toHaveBeenCalledOnce();
      expect(res.status).not.toHaveBeenCalled();
    }
  });

  it('refuses a write with 402 once the trial ended or the plan was cancelled', async () => {
    for (const status of ['canceled', 'past_due', 'unpaid', 'incomplete_expired']) {
      org = { subscription_status: status, stripe_subscription_id: 'sub_1' };
      for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
        const { res, next } = await run({ method });
        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(402);
        expect(res.json).toHaveBeenCalledWith(SUBSCRIPTION_INACTIVE);
      }
    }
    expect(SUBSCRIPTION_INACTIVE).toEqual({
      success: false,
      error: 'plan_limit',
      code: 'subscription_inactive',
      message: 'Your plan has ended. Choose a plan to use GetCito again.',
    });
  });

  it('lets reads through without reading the organization', async () => {
    org = ended;
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      const { res, next } = await run({ method });
      expect(next).toHaveBeenCalledOnce();
      expect(res.status).not.toHaveBeenCalled();
    }
    expect(reads).toHaveLength(0);
  });

  it("leaves billing's named routes open, and only them", async () => {
    org = ended;
    for (const [method, path] of [
      ['POST', '/billing/cancel-feedback'],
      ['POST', '/billing/cancel-feedback/'],
      // Billing's reads, as every read.
      ['GET', '/billing/ai-usage'],
      ['GET', '/billing/ai-usage/draft/d1'],
    ]) {
      const { res, next } = await run({ method, path });
      expect(next, `${method} ${path}`).toHaveBeenCalledOnce();
      expect(res.status).not.toHaveBeenCalled();
    }
    // A billing route that isn't named isn't let through by its path.
    for (const [method, path] of [
      ['POST', '/billing'],
      ['POST', '/billing/checkout'],
      ['POST', '/billing/cancel-feedback/extra'],
      ['PUT', '/billing/cancel-feedback'],
      ['DELETE', '/billing/cancel-feedback'],
      ['POST', '/billingx'],
    ]) {
      const { res, next } = await run({ method, path });
      expect(next, `${method} ${path}`).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(402);
    }
    expect(BILLING_ROUTES).toHaveLength(1);
  });

  it('lets an organization off a plan stop work and take back access, and nothing else', async () => {
    org = ended;
    const open = [
      ['DELETE', '/tracking/job/9b2c1e40-0000-4000-8000-000000000001'],
      ['POST', '/content-drafts/9b2c1e40-0000-4000-8000-000000000002/stop'],
      // A published page taken down to a draft: it only lowers what is live.
      ['POST', '/content-drafts/9b2c1e40-0000-4000-8000-000000000002/take-down'],
      ['DELETE', '/integrations/google-search-console'],
      ['DELETE', '/integrations/google-analytics'],
      ['DELETE', '/cms/brands/b1/webflow'],
      ['DELETE', '/cms/brands/b1/wordpress'],
      ['DELETE', '/cms/brands/b1/framer'],
      ['DELETE', '/cms/brands/b1/wix'],
      ['DELETE', '/bots/connections/b1/c1'],
      // A store's sign-in is revoked at the store as it is removed.
      ['DELETE', '/catalog/sources/9b2c1e40-0000-4000-8000-000000000003'],
    ];
    for (const [method, path] of open) {
      const { res, next } = await run({ method, path });
      expect(next, `${method} ${path}`).toHaveBeenCalledOnce();
      expect(res.status).not.toHaveBeenCalled();
    }
    // The same paths with another method, their neighbours, and lookalikes stay closed.
    for (const [method, path] of [
      ['POST', '/tracking/job/j1'],
      ['POST', '/tracking/check'],
      ['DELETE', '/tracking/job/j1/extra'],
      ['DELETE', '/content-drafts/d1/stop'],
      ['POST', '/content-drafts/d1/write'],
      ['POST', '/content-drafts/d1/stop/now'],
      ['DELETE', '/content-drafts/d1/take-down'],
      ['POST', '/content-drafts/d1/take-down/again'],
      ['POST', '/content-drafts/d1/publish'],
      ['POST', '/content-drafts/stop'],
      ['POST', '/content/d1/stop'],
      ['POST', '/action-center/tasks/t1/cancel'],
      ['POST', '/integrations/google-search-console/connect'],
      ['POST', '/integrations/google-search-console/sync'],
      ['PUT', '/cms/brands/b1/webflow'],
      ['POST', '/cms/brands/b1/webflow'],
      ['POST', '/cms/brands/b1/wordpress'],
      ['DELETE', '/cms/brands/b1/wordpress/extra'],
      ['POST', '/cms/brands/b1/framer'],
      ['PUT', '/cms/brands/b1/framer'],
      ['DELETE', '/cms/brands/b1/framer/collections'],
      ['POST', '/cms/brands/b1/wix'],
      ['DELETE', '/cms/brands/b1/wix/extra'],
      ['POST', '/bots/connections/b1'],
      ['DELETE', '/bots/connections/b1'],
      ['POST', '/catalog/sources'],
      ['POST', '/catalog/sources/s1/sync'],
      ['PUT', '/catalog/sources/s1/credentials'],
      ['DELETE', '/catalog/sources/s1/extra'],
      ['POST', '/catalog/upload'],
    ]) {
      const { res, next } = await run({ method, path });
      expect(next, `${method} ${path}`).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(402);
    }
    // Both Google disconnects are one route.
    expect(COST_STOPPING).toHaveLength(10);
  });

  it('lets an organization off a plan delete a brand, and nothing near it', async () => {
    org = ended;
    // Leaving needs no purchase (product decision, 2026-10-27).
    for (const path of ['/brands/9b2c1e40-0000-4000-8000-000000000004', '/brands/b1/']) {
      const { res, next } = await run({ method: 'DELETE', path });
      expect(next, path).toHaveBeenCalledOnce();
      expect(res.status).not.toHaveBeenCalled();
    }
    for (const [method, path] of [
      ['POST', '/brands'],
      ['PUT', '/brands/b1'],
      ['PATCH', '/brands/b1'],
      ['DELETE', '/brands/b1/domains/d1'],
      ['DELETE', '/brands'],
    ]) {
      const { res, next } = await run({ method, path });
      expect(next, `${method} ${path}`).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(402);
    }
    expect(DATA_REMOVAL).toHaveLength(1);
  });

  it('lets an organization off a plan, or never on one, open and hide the demo brand', async () => {
    for (const state of [ended, neverSubscribed]) {
      org = state;
      for (const [method, path] of [
        ['POST', '/demo'],
        ['POST', '/demo/'],
        ['PATCH', '/demo'],
      ]) {
        const { res, next } = await run({ method, path });
        expect(next, `${method} ${path}`).toHaveBeenCalledOnce();
        expect(res.status).not.toHaveBeenCalled();
      }
    }
    org = ended;
    for (const [method, path] of [
      ['DELETE', '/demo'],
      ['POST', '/demo/rebuild'],
      ['PUT', '/demo'],
    ]) {
      const { res, next } = await run({ method, path });
      expect(next, `${method} ${path}`).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(402);
    }
    expect(DEMO_ROUTES).toHaveLength(2);
  });

  it("opens onboarding's routes, and only them, to an organization that never subscribed", async () => {
    // Setting up, before the plan step; and back from it (onboarding marked
    // done, still no subscription): the flag is not read.
    org = neverSubscribed;
    for (const [method, path] of ONBOARDING) {
      const { res, next } = await run({ method, path });
      expect(next, `${method} ${path}`).toHaveBeenCalledOnce();
      expect(res.status).not.toHaveBeenCalled();
    }
    for (const [method, path] of [
      ['POST', '/prompts/suggest'],
      ['POST', '/tracking/check'],
      ['POST', '/volumes/bootstrap'],
      ['POST', '/brand-facts/fetch'],
      ['PUT', '/topics/suggest'],
      ['POST', '/topics/suggest/extra'],
      ['POST', '/brands/b1/detect-site-type/again'],
      ['PATCH', '/brands/b1'],
    ]) {
      const { res, next } = await run({ method, path });
      expect(next, `${method} ${path}`).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(402);
    }
    expect(ONBOARDING_ROUTES).toHaveLength(ONBOARDING.length);

    // Before the organization exists, too.
    profile = { organization_id: null };
    expect((await run({ path: '/topics/suggest' })).next).toHaveBeenCalledOnce();
  });

  it("holds onboarding's routes to ONBOARDING_DAILY_CALLS a day for the organization", async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-27T18:00:00Z'));
    org = neverSubscribed;
    // The routes share one count.
    for (let i = 0; i < ONBOARDING_DAILY_CALLS; i++) {
      const [method, path] = ONBOARDING[i % ONBOARDING.length];
      expect((await run({ method, path })).next).toHaveBeenCalledOnce();
    }
    const { res, next } = await run({ path: '/competitors/suggest' });
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith(ONBOARDING_LIMIT_REACHED);
    // Until midnight UTC, six hours on.
    expect(res.set).toHaveBeenCalledWith('Retry-After', String(6 * 60 * 60));
    expect(ONBOARDING_LIMIT_REACHED).toMatchObject({ error: 'rate_limited' });

    // Counted per organization: its other people wait too…
    expect(
      (await run({ path: '/topics/suggest', user: { id: 'u2' } })).res.status,
    ).toHaveBeenCalledWith(429);
    // …another organization's people don't.
    profile = { organization_id: 'org-2' };
    expect(
      (await run({ path: '/topics/suggest', user: { id: 'u3' } })).next,
    ).toHaveBeenCalledOnce();

    // A new day starts over.
    profile = { organization_id: 'org-1' };
    vi.setSystemTime(new Date('2026-10-28T00:00:00Z'));
    expect((await run({ path: '/topics/suggest' })).next).toHaveBeenCalledOnce();
  });

  it('makes room by the day a count began, so a count renewed today stays', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-27T18:00:00Z'));
    org = neverSubscribed;
    // Each call counts for its person and its organization: half as many
    // calls fill the map exactly, the first organization's counts first.
    for (let i = 0; i < MAX_ENTRIES / 2; i++) {
      profile = { organization_id: `org-${i}` };
      await run({ path: '/topics/suggest', user: { id: `u-${i}` } });
    }

    // The next day the first organization uses its calls again: its count
    // moves to the end, behind every count of the day before.
    vi.setSystemTime(new Date('2026-10-28T09:00:00Z'));
    profile = { organization_id: 'org-0' };
    const first = { id: 'u-0' };
    for (let i = 0; i < ONBOARDING_DAILY_CALLS; i++) {
      expect((await run({ path: '/topics/suggest', user: first })).next).toHaveBeenCalledOnce();
    }
    // A new organization makes room by dropping a count of the day before…
    profile = { organization_id: 'org-new' };
    expect(
      (await run({ path: '/topics/suggest', user: { id: 'u-new' } })).next,
    ).toHaveBeenCalledOnce();
    // …not today's, so the first organization's calls are still used up.
    profile = { organization_id: 'org-0' };
    expect((await run({ path: '/topics/suggest', user: first })).res.status).toHaveBeenCalledWith(
      429,
    );
  });

  it('counts onboarding per person before the organization exists', async () => {
    profile = { organization_id: null };
    for (let i = 0; i < ONBOARDING_DAILY_CALLS; i++) await run({ path: '/topics/suggest' });
    expect((await run({ path: '/topics/suggest' })).res.status).toHaveBeenCalledWith(429);
    expect(
      (await run({ path: '/topics/suggest', user: { id: 'u2' } })).next,
    ).toHaveBeenCalledOnce();
  });

  it('gives one person one allowance a day, before and after the organization exists', async () => {
    // Half the day's calls before the organization, half after: one allowance.
    profile = { organization_id: null };
    for (let i = 0; i < ONBOARDING_DAILY_CALLS / 2; i++) await run({ path: '/topics/suggest' });
    profile = { organization_id: 'org-1' };
    org = neverSubscribed;
    for (let i = 0; i < ONBOARDING_DAILY_CALLS / 2; i++) {
      expect((await run({ path: '/prompts/from-topics' })).next).toHaveBeenCalledOnce();
    }
    expect((await run({ path: '/competitors/suggest' })).res.status).toHaveBeenCalledWith(429);
    // A refused call counts for neither: the organization's other person
    // still has the half the first one didn't use there.
    for (let i = 0; i < ONBOARDING_DAILY_CALLS / 2; i++) {
      expect(
        (await run({ path: '/topics/suggest', user: { id: 'u2' } })).next,
      ).toHaveBeenCalledOnce();
    }
    expect(
      (await run({ path: '/topics/suggest', user: { id: 'u2' } })).res.status,
    ).toHaveBeenCalledWith(429);
  });

  it("leaves an active organization's onboarding calls uncounted", async () => {
    for (let i = 0; i < ONBOARDING_DAILY_CALLS + 5; i++) {
      clearSubscriptionCache();
      const { res, next } = await run({ path: '/topics/suggest' });
      expect(next).toHaveBeenCalledOnce();
      expect(res.status).not.toHaveBeenCalled();
    }
    // And a subscription chosen after the day's calls are used lets them all
    // through (another person: the first is remembered as active).
    const user = { id: 'u3' };
    org = neverSubscribed;
    for (let i = 0; i < ONBOARDING_DAILY_CALLS; i++) await run({ path: '/topics/suggest', user });
    expect((await run({ path: '/topics/suggest', user })).res.status).toHaveBeenCalledWith(429);
    org = { subscription_status: 'trialing', stripe_subscription_id: 'sub_1' };
    expect((await run({ path: '/topics/suggest', user })).next).toHaveBeenCalledOnce();
  });

  it("keeps onboarding's routes closed once the organization has had a subscription", async () => {
    org = ended;
    for (const [method, path] of ONBOARDING) {
      const { res, next } = await run({ method, path });
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(402);
    }
  });

  it('refuses a person with no profile, or whose organization is gone', async () => {
    profile = null;
    expect((await run({ path: '/topics/suggest' })).res.status).toHaveBeenCalledWith(402);
    profile = { organization_id: 'org-1' };
    org = null;
    expect((await run({ path: '/topics/suggest' })).res.status).toHaveBeenCalledWith(402);
  });

  it('refuses a write with no signed-in person', async () => {
    const { res, next } = await run({ user: null });
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(reads).toHaveLength(0);
  });

  it('refuses nothing self-hosted', async () => {
    vi.stubEnv('IS_CLOUD', 'false');
    org = ended;
    const { res, next } = await run();
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
    expect(reads).toHaveLength(0);
  });
});

describe('subscriptionAccess', () => {
  it('tells active, never subscribed and ended apart, without the onboarding flag', async () => {
    expect(await subscriptionAccess('u1')).toBe('active');
    org = neverSubscribed;
    expect(await subscriptionAccess('u1')).toBe('never_subscribed');
    org = ended;
    expect(await subscriptionAccess('u1')).toBe('inactive');
    profile = null;
    expect(await subscriptionAccess('u1')).toBe('inactive');
  });
});

describe('the cache', () => {
  it('remembers an active organization for a short while', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    await run();
    await run();
    expect(reads).toEqual(['profiles', 'organizations']);

    // The plan ends: within the window, still the remembered answer…
    org = ended;
    vi.advanceTimersByTime(ACTIVE_CACHE_MS - 1);
    expect((await run()).next).toHaveBeenCalledOnce();

    // …after it, read again and refused.
    vi.advanceTimersByTime(1);
    const { res } = await run();
    expect(res.status).toHaveBeenCalledWith(402);
    expect(ACTIVE_CACHE_MS).toBeLessThanOrEqual(30_000);
  });

  it('never remembers a refusal, so a plan chosen now works on the next request', async () => {
    org = ended;
    expect((await run()).res.status).toHaveBeenCalledWith(402);

    org = { subscription_status: 'trialing', stripe_subscription_id: 'sub_1' };
    const { res, next } = await run();
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('is kept per person', async () => {
    await run({ user: { id: 'u1' } });
    org = ended;
    expect((await run({ user: { id: 'u2' } })).res.status).toHaveBeenCalledWith(402);
    expect((await run({ user: { id: 'u1' } })).next).toHaveBeenCalledOnce();
  });

  it('makes room only for a new person, not when one already remembered is again', async () => {
    for (let i = 0; i < MAX_ENTRIES; i++) await run({ user: { id: `u${i}` } });
    // Two requests of a new person at once: both read, both remember them.
    await Promise.all([run({ user: { id: 'new' } }), run({ user: { id: 'new' } })]);

    reads.length = 0;
    // The oldest made room for the new person once…
    await run({ user: { id: 'u0' } });
    expect(reads).toEqual(['profiles', 'organizations']);
    // …and the second remembering took nobody else's place.
    reads.length = 0;
    await run({ user: { id: 'u2' } });
    await run({ user: { id: 'new' } });
    expect(reads).toEqual([]);
  });
});

describe('when the check cannot be read', () => {
  it('answers 500 and never lets the write through', async () => {
    const supabase = (await import('../config/supabase.js')).default;
    const from = supabase.from;
    supabase.from = () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: null, error: { message: 'timeout' } }),
      };
      return chain;
    };
    try {
      await expect(subscriptionAccess('u1')).rejects.toThrow('profiles read: timeout');

      const res = makeRes();
      const next = vi.fn();
      const log = { error: vi.fn() };
      await requireActiveSubscription(
        { method: 'POST', path: '/prompts/suggest', user: { id: 'u1' }, log },
        res,
        next,
      );
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(500);
      expect(log.error).toHaveBeenCalledOnce();
    } finally {
      supabase.from = from;
    }
  });
});

/**
 * server.js can't be imported here (it listens and starts the crons), so its
 * mount is read: the API's routes are reached only through decodeToken, the
 * demo brand's check (demoBrand.js) and then this middleware, and the
 * webhooks are mounted outside /api.
 */
describe("server.js's mount", () => {
  it('puts every API route in its request’s store, behind the person, the demo brand and then the plan', async () => {
    const source = await readFile(new URL('../apiServer.js', import.meta.url), 'utf8');
    // One call per line, however Prettier wraps it.
    const flat = source
      .replace(/\(\s+/g, '(')
      .replace(/,\s+/g, ', ')
      .replace(/,?\s+\)/g, ')');
    const mounts = flat
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => /^app\.use\(.*\broutes\);$/.test(line));
    expect(mounts).toEqual([
      "app.use('/api', requestScope, Middleware.decodeToken.bind(Middleware), refuseDemoBrandWrites, requireActiveSubscription, routes);",
    ]);
    expect(source).toMatch(
      /import \{[^}]*\brefuseDemoBrandWrites\b[^}]*\} from '\.\/middleware\/demoBrand\.js';/,
    );
    expect(source).toMatch(
      /import \{ requireActiveSubscription \} from '\.\/middleware\/subscription\.js';/,
    );
    expect(source).toMatch(/app\.use\('\/webhooks\/content-drafts', /);
  });
});

/**
 * Mounted as server.js mounts it: after the person is known, on /api only.
 * The content-draft webhook, mounted outside /api, never meets it.
 */
describe('mounted like the server', () => {
  let server;
  let baseUrl;

  beforeEach(async () => {
    org = ended;
    const app = express();
    app.use(express.json());
    app.use('/webhooks/content-drafts', (req, res) => res.json({ ok: true }));
    const auth = (req, _res, next) => {
      req.user = { id: 'u1' };
      next();
    };
    const routes = express.Router();
    routes.get('/prompts', (req, res) => res.json({ prompts: [] }));
    routes.post('/prompts/suggest', (req, res) => res.json({ suggested: true }));
    routes.post('/billing/cancel-feedback', (req, res) => res.json({ kept: true }));
    routes.post('/billing/checkout', (req, res) => res.json({ charged: true }));
    routes.delete('/tracking/job/:jobId', (req, res) => res.json({ cancelled: true }));
    routes.post('/content-drafts/:draftId/stop', (req, res) => res.json({ stopped: true }));
    routes.post('/content-drafts/:draftId/write', (req, res) => res.json({ writing: true }));
    app.use('/api', auth, requireActiveSubscription, routes);
    await new Promise((resolve) => {
      server = app.listen(0, resolve);
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  afterEach(() => new Promise((resolve) => server.close(resolve)));

  const post = (path) =>
    fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });

  it('refuses the write, and only the write', async () => {
    const refused = await post('/api/prompts/suggest');
    expect(refused.status).toBe(402);
    expect(await refused.json()).toEqual(SUBSCRIPTION_INACTIVE);

    expect((await fetch(`${baseUrl}/api/prompts`)).status).toBe(200);
    expect((await post('/api/billing/cancel-feedback')).status).toBe(200);
    // A billing write that isn't named is refused like any other.
    expect((await post('/api/billing/checkout')).status).toBe(402);
  });

  it('lets work under way be stopped, but not started', async () => {
    const cancel = await fetch(`${baseUrl}/api/tracking/job/j1`, { method: 'DELETE' });
    expect(cancel.status).toBe(200);
    expect((await post('/api/content-drafts/d1/stop')).status).toBe(200);
    expect((await post('/api/content-drafts/d1/write')).status).toBe(402);
  });

  it('leaves the webhook alone', async () => {
    const res = await post('/webhooks/content-drafts/d1/status');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
