import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * POST /api/stripe/checkout: a Stripe Checkout for a new subscription, from
 * onboarding's plan step (monthly, back to the step on cancel) or from
 * Billing once a plan has ended (either period, back to Billing on cancel).
 * Admins only, and never beside a subscription that is still there. Two ways
 * to start, both with a card: buy now (the first-month offer on a monthly
 * plan, no trial), or the free trial (no offer), for a first subscription.
 */

let role: string;
let org: Record<string, unknown>;

/** A Supabase query that answers `single()` with the row given. */
const row = (data: unknown) => {
  const query = { select: () => query, eq: () => query, single: async () => ({ data }) };
  return query;
};

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u1', email: 'a@example.com' } } }) },
    from: (table: string) => row(table === 'profiles' ? { organization_id: 'org1', role } : org),
  }),
}));

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: { from: vi.fn() } }));

const stripeApi = vi.hoisted(() => ({
  createSession: vi.fn(),
  listSubscriptions: vi.fn(),
  listCodes: vi.fn(),
  annual: true,
}));
vi.mock('@/lib/stripe', () => ({
  stripe: {
    checkout: { sessions: { create: stripeApi.createSession } },
    subscriptions: { list: stripeApi.listSubscriptions },
    promotionCodes: { list: stripeApi.listCodes },
    customers: { create: vi.fn() },
  },
  PRICE_IDS: {},
  priceIdFor: (planId: string, interval: string) =>
    interval === 'year' && !stripeApi.annual ? undefined : `price_${planId}_${interval}`,
}));

const { POST } = await import('./route');

/** A checkout request; buying now unless it says otherwise. */
const send = (body: unknown) =>
  POST(
    new Request('http://localhost/api/stripe/checkout', {
      method: 'POST',
      body: JSON.stringify(body),
    }) as unknown as NextRequest,
  );
const post = (body: Record<string, unknown>) => send({ mode: 'buy', ...body });

/** What Checkout was asked for. */
const session = () => stripeApi.createSession.mock.calls[0][0];

beforeEach(() => {
  vi.clearAllMocks();
  role = 'admin';
  // A plan that ended: Billing starts a new one.
  org = {
    stripe_customer_id: 'cus_1',
    stripe_subscription_id: 'sub_old',
    subscription_status: 'canceled',
  };
  stripeApi.annual = true;
  stripeApi.createSession.mockResolvedValue({ url: 'https://checkout.stripe.com/c/1' });
  // A customer who had a subscription before: no second trial.
  stripeApi.listSubscriptions.mockResolvedValue({ data: [{ id: 'sub_old' }] });
  stripeApi.listCodes.mockResolvedValue({ data: [save50] });
});

/** SAVE50 as Stripe lists it: 50% off the first invoice. */
const save50 = {
  id: 'promo_save50',
  code: 'SAVE50',
  active: true,
  customer: null,
  expires_at: null,
  max_redemptions: null,
  times_redeemed: 0,
  promotion: {
    type: 'coupon',
    coupon: {
      valid: true,
      percent_off: 50,
      amount_off: null,
      currency: null,
      duration: 'once',
      duration_in_months: null,
    },
  },
};

describe('POST /api/stripe/checkout', () => {
  it("bills monthly and returns to onboarding's plan step by default", async () => {
    const res = await post({ planId: 'starter', organizationId: 'org1' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: 'https://checkout.stripe.com/c/1' });
    expect(session().line_items).toEqual([{ price: 'price_starter_month', quantity: 1 }]);
    expect(session().cancel_url).toBe('http://localhost:3000/dashboard/onboarding');
    expect(session().subscription_data.trial_period_days).toBeUndefined();
    expect(session().payment_method_collection).toBe('always');
  });

  it('asks how the subscription starts', async () => {
    expect((await send({ planId: 'starter', organizationId: 'org1' })).status).toBe(400);
    expect((await send({ planId: 'starter', organizationId: 'org1', mode: 'later' })).status).toBe(
      400,
    );
    expect(stripeApi.createSession).not.toHaveBeenCalled();
  });

  it('bills a year up front and returns to Billing, for a plan chosen there', async () => {
    const res = await post({
      planId: 'growth',
      organizationId: 'org1',
      interval: 'year',
      returnTo: 'billing',
    });
    expect(res.status).toBe(200);
    expect(session().line_items).toEqual([{ price: 'price_growth_year', quantity: 1 }]);
    expect(session().cancel_url).toBe('http://localhost:3000/dashboard/settings/billing');
    expect(session().subscription_data.metadata).toEqual({
      organization_id: 'org1',
      plan_id: 'growth',
    });
  });

  it('starts a new account’s first subscription, with no subscription yet', async () => {
    // A customer from an earlier Checkout that was left, and no subscription.
    org = {
      stripe_customer_id: 'cus_1',
      stripe_subscription_id: null,
      subscription_status: 'incomplete',
    };
    stripeApi.listSubscriptions.mockResolvedValue({ data: [] });
    const res = await post({ planId: 'starter', organizationId: 'org1' });
    expect(res.status).toBe(200);
  });

  it("refuses another organization's checkout", async () => {
    const res = await post({ planId: 'starter', organizationId: 'org2' });
    expect(res.status).toBe(403);
    expect(stripeApi.createSession).not.toHaveBeenCalled();
  });

  it('leaves buying a plan to admins', async () => {
    role = 'manager';
    const res = await post({ planId: 'starter', organizationId: 'org1' });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: 'Only admins can change the plan',
      code: 'admin_only',
    });
    expect(stripeApi.createSession).not.toHaveBeenCalled();
  });

  it('starts no second subscription beside one still there', async () => {
    for (const status of ['active', 'trialing', 'past_due', 'unpaid']) {
      org = { ...org, subscription_status: status };
      const res = await post({ planId: 'growth', organizationId: 'org1', returnTo: 'billing' });
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ code: 'subscription_exists' });
    }
    expect(stripeApi.createSession).not.toHaveBeenCalled();
  });

  it('refuses a period or a return it does not know', async () => {
    expect(
      (await post({ planId: 'growth', organizationId: 'org1', interval: 'week' })).status,
    ).toBe(400);
    expect(
      (await post({ planId: 'growth', organizationId: 'org1', returnTo: 'https://evil.example' }))
        .status,
    ).toBe(400);
    expect((await post({ planId: 'enterprise', organizationId: 'org1' })).status).toBe(400);
    expect(stripeApi.createSession).not.toHaveBeenCalled();
  });

  it("leaves a code to Stripe's own box when none was applied", async () => {
    await post({ planId: 'starter', organizationId: 'org1', returnTo: 'billing' });
    expect(session().allow_promotion_codes).toBe(true);
    expect(session().discounts).toBeUndefined();
    expect(stripeApi.listCodes).not.toHaveBeenCalled();
  });

  it('opens Checkout with a code it checked with Stripe again, on a monthly plan', async () => {
    const res = await post({
      planId: 'growth',
      organizationId: 'org1',
      interval: 'month',
      returnTo: 'billing',
      promotionCode: 'save50',
    });
    expect(res.status).toBe(200);
    expect(stripeApi.listCodes).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'save50', active: true, limit: 1 }),
    );
    expect(session().discounts).toEqual([{ promotion_code: 'promo_save50' }]);
    // Stripe refuses a code applied and its own code box together.
    expect(session().allow_promotion_codes).toBeUndefined();
    expect(session().line_items).toEqual([{ price: 'price_growth_month', quantity: 1 }]);
  });

  it('refuses a code Stripe does not take, before opening anything', async () => {
    stripeApi.listCodes.mockResolvedValue({ data: [] });
    const res = await post({ planId: 'starter', organizationId: 'org1', promotionCode: 'NOPE' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "That promo code isn't valid",
      code: 'invalid_promo_code',
    });
    expect(stripeApi.createSession).not.toHaveBeenCalled();
  });

  it('refuses a code kept for another customer', async () => {
    stripeApi.listCodes.mockResolvedValue({
      data: [{ ...save50, code: 'WELCOME10', customer: 'cus_other' }],
    });
    const res = await post({
      planId: 'starter',
      organizationId: 'org1',
      promotionCode: 'WELCOME10',
    });
    expect(res.status).toBe(400);
    expect(stripeApi.createSession).not.toHaveBeenCalled();
  });

  it("buys at the plan's price, with Checkout's code box, once Stripe no longer takes the offer's code", async () => {
    stripeApi.listCodes.mockResolvedValue({ data: [] });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await post({ planId: 'starter', organizationId: 'org1', promotionCode: 'SAVE50' });
    expect(res.status).toBe(200);
    expect(session().discounts).toBeUndefined();
    expect(session().allow_promotion_codes).toBe(true);
    expect(session().subscription_data.trial_period_days).toBeUndefined();
    warn.mockRestore();
  });

  it('keeps a code to monthly plans: a year has its own discount', async () => {
    const res = await post({
      planId: 'starter',
      organizationId: 'org1',
      interval: 'year',
      promotionCode: 'SAVE50',
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'promo_code_monthly_only' });
    expect(stripeApi.listCodes).not.toHaveBeenCalled();
    expect(stripeApi.createSession).not.toHaveBeenCalled();
  });

  it('refuses a code that is not a string, or too long', async () => {
    for (const promotionCode of [50, '', 'X'.repeat(65)]) {
      const res = await post({ planId: 'starter', organizationId: 'org1', promotionCode });
      expect(res.status).toBe(400);
    }
    expect(stripeApi.createSession).not.toHaveBeenCalled();
  });

  it('refuses a year when its price is not set up', async () => {
    stripeApi.annual = false;
    const res = await post({ planId: 'growth', organizationId: 'org1', interval: 'year' });
    expect(res.status).toBe(400);
    expect(stripeApi.createSession).not.toHaveBeenCalled();
  });
});

describe('POST /api/stripe/checkout, the two ways to start', () => {
  beforeEach(() => {
    // A new account: no subscription, and none on its Stripe customer.
    org = { stripe_customer_id: 'cus_1', stripe_subscription_id: null, subscription_status: null };
    stripeApi.listSubscriptions.mockResolvedValue({ data: [] });
  });

  it('buys now with the first-month offer: the code applied, no trial, a card', async () => {
    const res = await post({ planId: 'growth', organizationId: 'org1', promotionCode: 'SAVE50' });
    expect(res.status).toBe(200);
    expect(session().discounts).toEqual([{ promotion_code: 'promo_save50' }]);
    expect(session().subscription_data.trial_period_days).toBeUndefined();
    expect(session().payment_method_collection).toBe('always');
  });

  it('buys a year at its price: no offer, no trial', async () => {
    const res = await post({ planId: 'growth', organizationId: 'org1', interval: 'year' });
    expect(res.status).toBe(200);
    expect(session().line_items).toEqual([{ price: 'price_growth_year', quantity: 1 }]);
    expect(session().discounts).toBeUndefined();
    expect(session().subscription_data.trial_period_days).toBeUndefined();
  });

  it('starts the free trial with no code at all, a card taken', async () => {
    const res = await post({ planId: 'starter', organizationId: 'org1', mode: 'trial' });
    expect(res.status).toBe(200);
    expect(session().subscription_data.trial_period_days).toBe(14);
    expect(session().payment_method_collection).toBe('always');
    expect(session().discounts).toBeUndefined();
    expect(session().allow_promotion_codes).toBeUndefined();
    expect(stripeApi.listCodes).not.toHaveBeenCalled();
  });

  it('starts the trial on a year too', async () => {
    const res = await post({
      planId: 'growth',
      organizationId: 'org1',
      mode: 'trial',
      interval: 'year',
    });
    expect(res.status).toBe(200);
    expect(session().line_items).toEqual([{ price: 'price_growth_year', quantity: 1 }]);
    expect(session().subscription_data.trial_period_days).toBe(14);
  });

  it('refuses a code with the trial', async () => {
    const res = await post({
      planId: 'starter',
      organizationId: 'org1',
      mode: 'trial',
      promotionCode: 'SAVE50',
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'promo_with_trial' });
    expect(stripeApi.createSession).not.toHaveBeenCalled();
  });

  it('refuses the trial to an organization that had a subscription', async () => {
    org = {
      stripe_customer_id: 'cus_1',
      stripe_subscription_id: 'sub_old',
      subscription_status: 'canceled',
    };
    let res = await post({ planId: 'starter', organizationId: 'org1', mode: 'trial' });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'trial_unavailable' });

    // Or whose Stripe customer had one (a trial taken and canceled).
    org = { stripe_customer_id: 'cus_1', stripe_subscription_id: null, subscription_status: null };
    stripeApi.listSubscriptions.mockResolvedValue({ data: [{ id: 'sub_old' }] });
    res = await post({ planId: 'starter', organizationId: 'org1', mode: 'trial' });
    expect(res.status).toBe(409);
    expect(stripeApi.createSession).not.toHaveBeenCalled();
  });

  it('never gives a trial with buying now, even to a first subscription', async () => {
    await post({ planId: 'starter', organizationId: 'org1' });
    expect(session().subscription_data.trial_period_days).toBeUndefined();
  });
});
