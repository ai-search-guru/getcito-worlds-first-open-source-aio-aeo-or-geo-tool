// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeSupabase } from '@/lib/chat/testing/fakeSupabase';

/**
 * Buying a pack: Admins of a paid, active plan only, with Chat on; AI credits
 * open a Stripe Checkout in payment mode, storage joins the plan's
 * subscription as a monthly item. A pack with no Stripe price isn't sold.
 * Nothing here grants anything: the purchase waits for the webhook. Stripe
 * is mocked; nothing reaches it.
 */

vi.mock('@/lib/supabase/admin', async () => ({
  supabaseAdmin: (await import('@/lib/chat/testing/fakeSupabase')).createFakeSupabase(),
}));

const auth = vi.hoisted(() => ({ user: { id: 'u_admin', email: 'a@example.com' } as unknown }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: auth.user } }) } }),
}));

const stripeApi = vi.hoisted(() => ({
  createSession: vi.fn(),
  retrieveSubscription: vi.fn(),
  createItem: vi.fn(),
  createCustomer: vi.fn(),
}));
vi.mock('@/lib/stripe', () => ({
  stripe: {
    checkout: { sessions: { create: stripeApi.createSession } },
    subscriptions: { retrieve: stripeApi.retrieveSubscription },
    subscriptionItems: { create: stripeApi.createItem },
    customers: { create: stripeApi.createCustomer },
  },
}));

const { supabaseAdmin } = await import('@/lib/supabase/admin');
const db = supabaseAdmin as unknown as FakeSupabase;
const { getBillingAddOns, startAddOnPurchase } = await import('./addOns');

const ORG = '11111111-1111-4111-8111-111111111111';

const pack = (id: string, kind: 'ai' | 'storage', price: string | null, over = {}) => ({
  id,
  kind,
  name: id,
  price_cents: kind === 'ai' ? 5000 : 500,
  currency: 'usd',
  billing: kind === 'ai' ? 'one_time' : 'monthly',
  grant_ai_usd: kind === 'ai' ? 25 : null,
  grant_bytes: kind === 'storage' ? 26843545600 : null,
  valid_months: kind === 'ai' ? 12 : null,
  stripe_price_id: price,
  active: true,
  highlight: false,
  sort: 1,
  ...over,
});

/** The plan's subscription, billed monthly unless said otherwise. */
const subscription = (interval = 'month') => ({
  id: 'sub_1',
  items: {
    data: [{ id: 'si_plan', metadata: {}, price: { id: 'price_growth', recurring: { interval } } }],
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubEnv('CHAT_AGENTIC', 'true');
  vi.stubEnv('CHAT_AGENTIC_ORGS', '');
  vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.example.com');
  // A deployment with Stripe (the mock above); addOnsWithoutStripe.test.ts has none.
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_x');
  auth.user = { id: 'u_admin', email: 'a@example.com' };
  db.failures = {};
  db.log = [];
  db.unique = {};
  db.defaults = {};
  db.tables = {
    profiles: [
      { id: 'u_admin', organization_id: ORG, role: 'admin' },
      { id: 'u_manager', organization_id: ORG, role: 'manager' },
    ],
    organizations: [
      {
        id: ORG,
        subscription_status: 'active',
        stripe_customer_id: 'cus_1',
        stripe_subscription_id: 'sub_1',
      },
    ],
    add_on_products: [
      pack('ai_50', 'ai', 'price_ai50'),
      pack('ai_10', 'ai', null),
      pack('storage_25', 'storage', 'price_st25'),
      pack('storage_100', 'storage', 'price_st100', { active: false }),
    ],
    add_on_purchases: [],
  };
  stripeApi.createSession.mockResolvedValue({
    id: 'cs_test_1',
    url: 'https://checkout.stripe.com/c/1',
  });
  stripeApi.retrieveSubscription.mockResolvedValue(subscription());
  stripeApi.createItem.mockResolvedValue({ id: 'si_pack' });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const purchases = () => db.tables.add_on_purchases;
const stripeCalled = () =>
  [stripeApi.createSession, stripeApi.createItem, stripeApi.createCustomer].some(
    (fn) => fn.mock.calls.length > 0,
  );

describe('AI credits', () => {
  it('open a Stripe Checkout in payment mode, the purchase waiting for the webhook', async () => {
    await expect(startAddOnPurchase('ai_50')).resolves.toEqual({
      ok: true,
      next: 'checkout',
      url: 'https://checkout.stripe.com/c/1',
    });

    expect(purchases()).toEqual([
      expect.objectContaining({
        organization_id: ORG,
        product_id: 'ai_50',
        bought_by: 'u_admin',
        status: 'pending',
        stripe_checkout_session_id: 'cs_test_1',
      }),
    ]);
    const id = purchases()[0].id;
    const metadata = { add_on_purchase_id: id, organization_id: ORG, product_id: 'ai_50' };
    const [params, options] = stripeApi.createSession.mock.calls[0];
    expect(params).toMatchObject({
      mode: 'payment',
      customer: 'cus_1',
      line_items: [{ price: 'price_ai50', quantity: 1 }],
      metadata,
      payment_intent_data: { metadata },
      invoice_creation: { enabled: true, invoice_data: { metadata } },
      success_url: 'https://app.example.com/dashboard/settings/billing?add_on=paid#add-ons',
      cancel_url: 'https://app.example.com/dashboard/settings/billing#add-ons',
    });
    expect(options).toEqual({ idempotencyKey: `add-on-${id}` });
    // Nothing granted here.
    expect(db.tables.ai_credit_grants ?? []).toEqual([]);
  });
});

describe('storage', () => {
  it('joins the plan’s subscription as a monthly item, invoiced at once for this period', async () => {
    await expect(startAddOnPurchase('storage_25')).resolves.toEqual({ ok: true, next: 'added' });

    const id = purchases()[0].id;
    expect(stripeApi.createItem).toHaveBeenCalledWith(
      {
        subscription: 'sub_1',
        price: 'price_st25',
        quantity: 1,
        proration_behavior: 'always_invoice',
        payment_behavior: 'error_if_incomplete',
        metadata: { add_on_purchase_id: id, organization_id: ORG, product_id: 'storage_25' },
      },
      { idempotencyKey: `add-on-${id}` },
    );
    expect(purchases()[0]).toMatchObject({
      status: 'pending',
      stripe_subscription_item_id: 'si_pack',
    });
    expect(stripeApi.createSession).not.toHaveBeenCalled();
  });

  it('fails with Stripe’s words when the card on file is declined, and nothing is added', async () => {
    stripeApi.createItem.mockRejectedValue(
      Object.assign(new Error('Your card was declined.'), {
        type: 'StripeCardError',
        statusCode: 402,
      }),
    );
    await expect(startAddOnPurchase('storage_25')).resolves.toEqual({
      ok: false,
      failure: 'payment_failed',
      message: 'Your card was declined.',
    });
    expect(purchases()[0].status).toBe('failed');
  });

  it('isn’t sold on a plan billed yearly: a monthly item can’t join it', async () => {
    stripeApi.retrieveSubscription.mockResolvedValue(subscription('year'));
    await expect(startAddOnPurchase('storage_25')).resolves.toEqual({
      ok: false,
      failure: 'unavailable',
    });
    expect(purchases()).toEqual([]);
    expect(stripeApi.createItem).not.toHaveBeenCalled();
  });

  it('leaves the purchase pending when Stripe didn’t answer: the webhook settles it', async () => {
    stripeApi.createItem.mockRejectedValue(new Error('socket hang up'));
    await expect(startAddOnPurchase('storage_25')).resolves.toEqual({
      ok: false,
      failure: 'failed',
    });
    expect(purchases()[0].status).toBe('pending');
  });
});

describe('is refused', () => {
  it('for a pack without a Stripe price, or switched off: it isn’t sold', async () => {
    await expect(startAddOnPurchase('ai_10')).resolves.toEqual({
      ok: false,
      failure: 'unavailable',
    });
    await expect(startAddOnPurchase('storage_100')).resolves.toEqual({
      ok: false,
      failure: 'unavailable',
    });
    await expect(startAddOnPurchase('nope')).resolves.toEqual({
      ok: false,
      failure: 'unavailable',
    });
    expect(purchases()).toEqual([]);
    expect(stripeCalled()).toBe(false);
  });

  it('to everyone but Admins', async () => {
    auth.user = { id: 'u_manager', email: 'm@example.com' };
    await expect(startAddOnPurchase('ai_50')).resolves.toEqual({
      ok: false,
      failure: 'admin_only',
    });
    expect(purchases()).toEqual([]);
    expect(stripeCalled()).toBe(false);
  });

  it('in the free trial, and without an active plan', async () => {
    db.tables.organizations[0].subscription_status = 'trialing';
    await expect(startAddOnPurchase('ai_50')).resolves.toEqual({ ok: false, failure: 'trial' });
    db.tables.organizations[0].subscription_status = 'past_due';
    await expect(startAddOnPurchase('ai_50')).resolves.toEqual({ ok: false, failure: 'no_plan' });
    expect(stripeCalled()).toBe(false);
  });

  it('while Chat is off for the workspace', async () => {
    vi.stubEnv('CHAT_AGENTIC', 'false');
    await expect(startAddOnPurchase('ai_50')).resolves.toEqual({ ok: false, failure: 'chat_off' });
    vi.stubEnv('CHAT_AGENTIC', 'true');
    vi.stubEnv('CHAT_AGENTIC_ORGS', '22222222-2222-4222-8222-222222222222');
    await expect(startAddOnPurchase('ai_50')).resolves.toEqual({ ok: false, failure: 'chat_off' });
    expect(stripeCalled()).toBe(false);
  });

  it('without throwing when the database fails', async () => {
    db.failures = { add_on_purchases: { message: 'down' } };
    await expect(startAddOnPurchase('ai_50')).resolves.toEqual({ ok: false, failure: 'failed' });
    expect(stripeApi.createSession).not.toHaveBeenCalled();
  });
});

describe('Billing’s Add-ons', () => {
  const NOW = new Date('2026-10-30T12:00:00Z');
  const purchase = (id: string, product_id: string, status: string, over = {}) => ({
    id,
    organization_id: ORG,
    product_id,
    status,
    created_at: '2026-10-01T10:00:00.000Z',
    amount_paid_cents: status === 'pending' ? null : 5000,
    currency: 'usd',
    stripe_invoice_id: status === 'pending' ? null : `in_${id}`,
    ...over,
  });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    db.tables.organizations[0] = {
      ...db.tables.organizations[0],
      plan: 'growth',
      plan_overrides: null,
    };
    db.tables.add_on_products = [
      pack('ai_10', 'ai', 'price_ai10', { price_cents: 1000, grant_ai_usd: 5, sort: 1 }),
      pack('ai_50', 'ai', 'price_ai50', { highlight: true, sort: 2 }),
      pack('ai_250', 'ai', null, { price_cents: 25000, grant_ai_usd: 125, sort: 3 }),
      pack('storage_25', 'storage', 'price_st25', { highlight: true }),
      pack('storage_100', 'storage', 'price_st100', { active: false }),
    ];
    db.tables.add_on_purchases = [
      purchase('p1', 'ai_50', 'paid'),
      purchase('p2', 'storage_25', 'paid', { amount_paid_cents: 350 }),
      // A Checkout just opened, and one left a week ago: only the first is listed.
      purchase('p3', 'ai_10', 'pending', { created_at: '2026-10-30T11:50:00.000Z' }),
      purchase('p4', 'ai_10', 'pending', { created_at: '2026-10-23T11:50:00.000Z' }),
    ];
    db.tables.ai_credit_grants = [
      {
        organization_id: ORG,
        purchase_id: 'p1',
        usd_total: 25,
        usd_used: 0.9,
        expires_at: '2027-10-01T10:00:00.000Z',
      },
    ];
    db.tables.storage_grants = [
      { organization_id: ORG, purchase_id: 'p2', active_until: '2026-11-20T09:00:00.000Z' },
    ];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the packs with what each adds to this plan, the credit left, and the purchases', async () => {
    const read = await getBillingAddOns();
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    const { addOns } = read;
    expect(addOns).toMatchObject({ isAdmin: true, buy: 'open' });
    // Active packs, AI first; Growth's $25 monthly limit; no Stripe price, not on sale.
    expect(addOns.packs.map((p) => [p.id, p.adds, p.mostPicked, p.available])).toEqual([
      ['ai_10', { kind: 'share', percent: 20 }, false, true],
      ['ai_50', { kind: 'limits', count: 1 }, true, true],
      ['ai_250', { kind: 'limits', count: 5 }, false, false],
      ['storage_25', { kind: 'storage', gb: 25 }, true, true],
    ]);
    // $24.10 of model cost left on a $50 pack: $48.20 at its price.
    expect(addOns.credit).toEqual({ leftCents: 4820, expiresAt: '2027-10-01T10:00:00.000Z' });
    // Newest first.
    expect(addOns.purchases).toEqual([
      expect.objectContaining({ id: 'p3', state: 'processing', hasInvoice: false }),
      expect.objectContaining({
        id: 'p1',
        kind: 'ai',
        state: 'active',
        creditLeftCents: 4820,
        hasInvoice: true,
      }),
      expect.objectContaining({
        id: 'p2',
        kind: 'storage',
        state: 'active',
        gb: 25,
        paidCents: 350,
        until: '2026-11-20T09:00:00.000Z',
      }),
    ]);
    // Nothing a browser gets carries the model cost.
    expect(JSON.stringify(addOns)).not.toMatch(/usd_|grant_ai|24\.1/);
  });

  it('shows others the packs and the credit, never the purchases', async () => {
    auth.user = { id: 'u_manager', email: 'm@example.com' };
    const read = await getBillingAddOns();
    expect(read).toMatchObject({ ok: true, addOns: { isAdmin: false, purchases: null } });
    if (read.ok) expect(read.addOns.credit?.leftCents).toBe(4820);
  });

  it('says when the workspace can’t buy: the trial, a plan not active', async () => {
    db.tables.organizations[0].subscription_status = 'trialing';
    expect(await getBillingAddOns()).toMatchObject({ ok: true, addOns: { buy: 'trial' } });
    db.tables.organizations[0].subscription_status = 'canceled';
    expect(await getBillingAddOns()).toMatchObject({ ok: true, addOns: { buy: 'no_plan' } });
  });

  it('is off while Chat is off, and off the cloud', async () => {
    vi.stubEnv('CHAT_AGENTIC', 'false');
    expect(await getBillingAddOns()).toEqual({ ok: false, failure: 'off' });
    vi.stubEnv('CHAT_AGENTIC', 'true');
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'false');
    expect(await getBillingAddOns()).toEqual({ ok: false, failure: 'off' });
  });

  it('never throws when the database fails', async () => {
    db.failures = { ai_credit_grants: { message: 'down' } };
    expect(await getBillingAddOns()).toEqual({ ok: false, failure: 'failed' });
  });
});
