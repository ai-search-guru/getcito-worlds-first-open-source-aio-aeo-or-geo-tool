import type { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Back from Stripe Checkout: the organization gets its plan, status and
 * period end before the webhook lands, then the dashboard opens.
 */

const stripeApi = vi.hoisted(() => ({ retrieveSession: vi.fn(), retrieve: vi.fn() }));
vi.mock('@/lib/stripe', () => ({
  stripe: {
    checkout: { sessions: { retrieve: stripeApi.retrieveSession } },
    subscriptions: { retrieve: stripeApi.retrieve },
  },
}));

/** The demo brand's update: what it set, the filters it was made with, and its answer. */
const brands = vi.hoisted(() => ({
  update: vi.fn(),
  filters: [] as [string, string, unknown][],
  answer: { error: null } as { error: { message: string } | null },
}));
const db = vi.hoisted(() => ({
  update: vi.fn(),
  eq: vi.fn(),
  brand: null as { id: string } | null,
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: (table: string) => ({
      update: (values: unknown) => {
        if (table !== 'brands') {
          db.update(values);
          return { eq: db.eq };
        }
        brands.update(values);
        const chain = {
          eq: (column: string, value: unknown) => {
            brands.filters.push(['eq', column, value]);
            return chain;
          },
          is: (column: string, value: unknown) => {
            brands.filters.push(['is', column, value]);
            return chain;
          },
          then: (resolve: (value: unknown) => unknown) => resolve(brands.answer),
        };
        return chain;
      },
      // The organization's first brand, for its first run: none unless a
      // test says so.
      select: () => {
        const query = {
          eq: () => query,
          order: () => query,
          limit: () => query,
          maybeSingle: async () => ({ data: db.brand }),
        };
        return query;
      },
    }),
  },
}));

const align = vi.hoisted(() => vi.fn());
vi.mock('@/lib/planEngines', () => ({ alignPromptsToPlanForOrg: align }));

const { GET } = await import('./route');

const back = () =>
  GET(new Request('http://localhost/api/stripe/success?session_id=cs_1') as unknown as NextRequest);

/** A Stripe subscription with one item, its period ending at `end` (seconds). */
const subscription = (end?: number) => ({
  id: 'sub1',
  status: 'trialing',
  metadata: { organization_id: 'org1', plan_id: 'starter' },
  items: { data: [end == null ? {} : { current_period_end: end }] },
});

// The API the first run is asked of.
const api = vi.fn();
const apiPaths = () => api.mock.calls.map(([url]) => new URL(String(url)).pathname);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  align.mockResolvedValue({ promptCount: 0, platforms: [], models: [] });
  db.eq.mockResolvedValue({ error: null });
  brands.filters = [];
  brands.answer = { error: null };
  db.brand = null;
  api.mockReset();
  vi.stubGlobal('fetch', api);
  vi.stubEnv('CRON_SECRET', 'secret');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('GET /api/stripe/success', () => {
  it('writes the period end with the plan, then opens the dashboard', async () => {
    stripeApi.retrieveSession.mockResolvedValue({
      payment_status: 'no_payment_required',
      status: 'complete',
      customer: 'cus1',
      subscription: subscription(1_800_000_000),
    });

    const res = await back();

    expect(stripeApi.retrieveSession).toHaveBeenCalledWith('cs_1', { expand: ['subscription'] });
    expect(db.update).toHaveBeenCalledWith({
      subscription_status: 'trialing',
      plan: 'starter',
      stripe_customer_id: 'cus1',
      stripe_subscription_id: 'sub1',
      subscription_ends_at: '2027-01-15T08:00:00.000Z',
    });
    expect(db.eq).toHaveBeenCalledWith('id', 'org1');
    expect(align).toHaveBeenCalledWith('org1', 'starter');
    expect(res.headers.get('location')).toMatch(/\/dashboard\/action-center\/actions$/);
  });

  it('reads an unexpanded subscription, and leaves the period end alone without one', async () => {
    stripeApi.retrieveSession.mockResolvedValue({
      payment_status: 'paid',
      status: 'complete',
      customer: 'cus1',
      subscription: 'sub1',
    });
    stripeApi.retrieve.mockResolvedValue(subscription());

    await back();

    expect(stripeApi.retrieve).toHaveBeenCalledWith('sub1');
    expect(db.update).toHaveBeenCalledTimes(1);
    expect(db.update.mock.calls[0][0]).not.toHaveProperty('subscription_ends_at');
  });
});

/**
 * The first run: started here or by the webhook, whichever came first, and
 * its id carried to the dashboard's progress bar either way.
 */
describe('GET /api/stripe/success, the first run', () => {
  const paidCheckout = (status: string) => ({
    payment_status: 'paid',
    status: 'complete',
    customer: 'cus1',
    created: 1_800_000_000,
    subscription: { ...subscription(), status },
  });

  beforeEach(() => {
    db.brand = { id: 'brand1' };
  });

  it("carries the webhook's run to the dashboard, and starts no second one", async () => {
    stripeApi.retrieveSession.mockResolvedValue(paidCheckout('active'));
    api.mockResolvedValueOnce(Response.json({ success: true, jobId: 'job-w', created: false }));

    const res = await back();

    expect(apiPaths()).toEqual(['/api/internal/trigger-tracking']);
    expect(JSON.parse(api.mock.calls[0][1].body)).toEqual({
      brandId: 'brand1',
      since: '2027-01-15T08:00:00.000Z',
    });
    expect(new URL(res.headers.get('location')!).searchParams.get('jobId')).toBe('job-w');
  });

  it('starts the run itself when it comes first', async () => {
    stripeApi.retrieveSession.mockResolvedValue(paidCheckout('trialing'));
    api.mockResolvedValueOnce(Response.json({ success: true, jobId: 'job-s', created: true }));

    const res = await back();

    // The API starts the volume analysis with the run.
    expect(apiPaths()).toEqual(['/api/internal/trigger-tracking']);
    expect(new URL(res.headers.get('location')!).searchParams.get('jobId')).toBe('job-s');
    // The demo brand stepped aside for the bought plan, beside the run.
    expect(brands.update).toHaveBeenCalledTimes(1);
  });

  it('starts nothing for a subscription whose payment was not made', async () => {
    stripeApi.retrieveSession.mockResolvedValue(paidCheckout('incomplete'));

    const res = await back();

    expect(api).not.toHaveBeenCalled();
    // Nor is the demo brand hidden: no plan was bought.
    expect(brands.update).not.toHaveBeenCalled();
    expect(res.headers.get('location')).toMatch(/\/dashboard\/action-center\/actions$/);
  });

  it('starts nothing for a checkout that is not paid', async () => {
    stripeApi.retrieveSession.mockResolvedValue({
      ...paidCheckout('incomplete'),
      payment_status: 'unpaid',
      status: 'open',
    });

    await back();

    expect(db.update).not.toHaveBeenCalled();
    expect(api).not.toHaveBeenCalled();
  });

  it('opens the dashboard without a job when the API is down', async () => {
    stripeApi.retrieveSession.mockResolvedValue(paidCheckout('active'));
    api.mockRejectedValue(new Error('connect ECONNREFUSED'));

    const res = await back();

    expect(res.headers.get('location')).toMatch(/\/dashboard\/action-center\/actions$/);
  });
});

describe('GET /api/stripe/success and the demo brand', () => {
  it('hides a shown demo brand before the dashboard opens, so the own brand is the one open', async () => {
    stripeApi.retrieveSession.mockResolvedValue({
      payment_status: 'no_payment_required',
      status: 'complete',
      customer: 'cus1',
      subscription: subscription(1_800_000_000),
    });
    const res = await back();
    expect(brands.update).toHaveBeenCalledTimes(1);
    expect(brands.filters).toEqual([
      ['eq', 'organization_id', 'org1'],
      ['eq', 'is_demo', true],
      ['is', 'demo_hidden_at', null],
    ]);
    expect(res.headers.get('location')).toMatch(/\/dashboard\/action-center\/actions$/);
  });

  it('opens the dashboard all the same when the demo brand could not be hidden', async () => {
    brands.answer = { error: { message: 'timeout' } };
    stripeApi.retrieveSession.mockResolvedValue({
      payment_status: 'paid',
      status: 'complete',
      customer: 'cus1',
      subscription: subscription(),
    });
    const res = await back();
    expect(res.headers.get('location')).toMatch(/\/dashboard\/action-center\/actions$/);
  });
});
