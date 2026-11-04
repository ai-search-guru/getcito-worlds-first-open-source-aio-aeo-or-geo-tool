// @vitest-environment node
import type Stripe from 'stripe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeSupabase } from '@/lib/chat/testing/fakeSupabase';

/**
 * Add-on packs are granted by the Stripe webhook only, once each: AI credits
 * from a paid Checkout (or its invoice), storage from the invoices that pay
 * for its item; a full refund takes back what wasn't used. No call reaches
 * Stripe: its objects are written here, its two lookups mocked.
 */

vi.mock('@/lib/supabase/admin', async () => ({
  supabaseAdmin: (await import('@/lib/chat/testing/fakeSupabase')).createFakeSupabase(),
}));

const stripeApi = vi.hoisted(() => ({
  retrieveIntent: vi.fn(),
  listInvoicePayments: vi.fn(),
  listLineItems: vi.fn(),
  deleteItem: vi.fn(),
}));
vi.mock('@/lib/stripe', () => ({
  stripe: {
    paymentIntents: { retrieve: stripeApi.retrieveIntent },
    invoicePayments: { list: stripeApi.listInvoicePayments },
    invoices: { listLineItems: stripeApi.listLineItems },
    subscriptionItems: { del: stripeApi.deleteItem },
  },
}));

const { supabaseAdmin } = await import('@/lib/supabase/admin');
const db = supabaseAdmin as unknown as FakeSupabase;
const { handleAddOnEvent } = await import('./addOnWebhook');

const ORG = '11111111-1111-4111-8111-111111111111';
const AI_PURCHASE = 'a0000000-0000-4000-8000-000000000001';
const STORAGE_PURCHASE = 'a0000000-0000-4000-8000-000000000002';
// 2026-10-30 10:00 UTC, in Stripe's seconds.
const PAID_AT = Date.UTC(2026, 9, 30, 10) / 1000;
const PERIOD_END = Date.UTC(2026, 10, 20, 9) / 1000;
const NEXT_PERIOD_END = Date.UTC(2026, 11, 20, 9) / 1000;

const purchase = (id: string, product_id: string, over: Record<string, unknown> = {}) => ({
  id,
  organization_id: ORG,
  product_id,
  bought_by: 'u1',
  status: 'pending',
  stripe_checkout_session_id: null,
  stripe_invoice_id: null,
  stripe_subscription_item_id: null,
  amount_paid_cents: null,
  currency: 'usd',
  granted_at: null,
  expires_at: null,
  created_at: '2026-10-30T09:59:00.000Z',
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  // The webhook's deployment has Stripe (mocked above).
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_x');
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  db.failures = {};
  db.log = [];
  db.defaults = {};
  // 00413's unique keys: one grant per purchase.
  db.unique = { ai_credit_grants: [['purchase_id']], storage_grants: [['purchase_id']] };
  db.tables = {
    organizations: [{ id: ORG, stripe_customer_id: 'cus_1' }],
    add_on_products: [
      {
        id: 'ai_50',
        kind: 'ai',
        grant_ai_usd: 25,
        grant_bytes: null,
        valid_months: 12,
        stripe_price_id: 'price_ai50',
      },
      {
        id: 'storage_25',
        kind: 'storage',
        grant_ai_usd: null,
        grant_bytes: 26843545600,
        valid_months: null,
        stripe_price_id: 'price_st25',
      },
    ],
    add_on_purchases: [
      purchase(AI_PURCHASE, 'ai_50'),
      purchase(STORAGE_PURCHASE, 'storage_25', { stripe_subscription_item_id: 'si_pack' }),
    ],
    ai_credit_grants: [],
    storage_grants: [],
  };
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const event = (type: string, object: unknown, created = PAID_AT) =>
  ({ id: `evt_${type}`, type, created, data: { object } }) as unknown as Stripe.Event;

/** The AI pack's Checkout as Stripe completes it. */
const checkout = (over: Record<string, unknown> = {}) => ({
  id: 'cs_test_1',
  mode: 'payment',
  payment_status: 'paid',
  amount_total: 5000,
  currency: 'usd',
  invoice: 'in_ai',
  subscription: null,
  customer: 'cus_1',
  metadata: { add_on_purchase_id: AI_PURCHASE, organization_id: ORG, product_id: 'ai_50' },
  ...over,
});

/** An invoice line: a subscription item's, at a price, for the period ending `end`. */
const line = (item: string | null, price: string, amount: number, end = PERIOD_END) => ({
  amount,
  currency: 'usd',
  period: { start: PAID_AT, end },
  pricing: { type: 'price_details', price_details: { price, product: 'prod_x' } },
  parent: item
    ? {
        type: 'subscription_item_details',
        subscription_item_details: { subscription_item: item, proration: true },
      }
    : { type: 'invoice_item_details', invoice_item_details: { invoice_item: 'ii_1' } },
});

const invoice = (id: string, lines: unknown[], over: Record<string, unknown> = {}) => ({
  id,
  customer: 'cus_1',
  metadata: {},
  amount_paid: 500,
  currency: 'usd',
  lines: { data: lines, has_more: false },
  ...over,
});

const row = (table: string, id: string) =>
  (db.tables[table] ?? []).find((r) => r.id === id) as Record<string, unknown>;
const grantsOf = (table: string, purchaseId: string) =>
  (db.tables[table] ?? []).filter((r) => r.purchase_id === purchaseId);

describe('AI credits', () => {
  it('are granted when the Checkout is paid: half the price in budget, for 12 months', async () => {
    await expect(handleAddOnEvent(event('checkout.session.completed', checkout()))).resolves.toBe(
      true,
    );

    expect(grantsOf('ai_credit_grants', AI_PURCHASE)).toEqual([
      expect.objectContaining({
        organization_id: ORG,
        usd_total: 25,
        usd_used: 0,
        expires_at: '2027-10-30T10:00:00.000Z',
      }),
    ]);
    expect(row('add_on_purchases', AI_PURCHASE)).toMatchObject({
      status: 'paid',
      granted_at: '2026-10-30T10:00:00.000Z',
      expires_at: '2027-10-30T10:00:00.000Z',
      stripe_checkout_session_id: 'cs_test_1',
      stripe_invoice_id: 'in_ai',
      amount_paid_cents: 5000,
    });
  });

  it('are granted once, however often and however close together Stripe sends the event', async () => {
    const paid = event('checkout.session.completed', checkout());
    await Promise.all([handleAddOnEvent(paid), handleAddOnEvent(paid)]);
    await handleAddOnEvent(paid);
    // Its invoice's own event too.
    await handleAddOnEvent(
      event(
        'invoice.paid',
        invoice('in_ai', [], { metadata: checkout().metadata, amount_paid: 5000 }),
      ),
    );

    expect(grantsOf('ai_credit_grants', AI_PURCHASE)).toHaveLength(1);
    expect(row('add_on_purchases', AI_PURCHASE).status).toBe('paid');
  });

  it('wait for a delayed payment, and are never granted for one that fails or expires', async () => {
    await handleAddOnEvent(
      event('checkout.session.completed', checkout({ payment_status: 'unpaid' })),
    );
    expect(grantsOf('ai_credit_grants', AI_PURCHASE)).toEqual([]);
    expect(row('add_on_purchases', AI_PURCHASE).status).toBe('pending');

    await handleAddOnEvent(event('checkout.session.async_payment_failed', checkout()));
    expect(row('add_on_purchases', AI_PURCHASE).status).toBe('failed');
    // Even a late success can't grant a failed purchase.
    await handleAddOnEvent(event('checkout.session.async_payment_succeeded', checkout()));
    expect(grantsOf('ai_credit_grants', AI_PURCHASE)).toEqual([]);
  });

  it('are never granted for a Checkout that needed no payment', async () => {
    await expect(
      handleAddOnEvent(
        event(
          'checkout.session.completed',
          checkout({ payment_status: 'no_payment_required', amount_total: 0 }),
        ),
      ),
    ).resolves.toBe(true);
    expect(grantsOf('ai_credit_grants', AI_PURCHASE)).toEqual([]);
    expect(row('add_on_purchases', AI_PURCHASE).status).toBe('pending');
  });

  it('are granted by the delayed payment once it succeeds', async () => {
    await handleAddOnEvent(event('checkout.session.async_payment_succeeded', checkout()));
    expect(grantsOf('ai_credit_grants', AI_PURCHASE)).toHaveLength(1);
  });

  it('note the invoice from its own event when the Checkout came without one', async () => {
    await handleAddOnEvent(event('checkout.session.completed', checkout({ invoice: null })));
    expect(row('add_on_purchases', AI_PURCHASE).stripe_invoice_id).toBeNull();
    await handleAddOnEvent(
      event('invoice.paid', invoice('in_ai', [], { metadata: checkout().metadata })),
    );
    expect(row('add_on_purchases', AI_PURCHASE).stripe_invoice_id).toBe('in_ai');
  });

  it('leave a plan’s Checkout to the plan’s handlers', async () => {
    await expect(
      handleAddOnEvent(
        event('checkout.session.completed', { id: 'cs_plan', subscription: 'sub_1', metadata: {} }),
      ),
    ).resolves.toBe(false);
    expect(db.log).toEqual([]);
  });
});

describe('storage', () => {
  it('is granted by the invoice that pays for its item, until the end of the period paid for', async () => {
    const paid = invoice('in_prorated', [line('si_pack', 'price_st25', 350)]);
    await expect(handleAddOnEvent(event('invoice.paid', paid))).resolves.toBe(true);

    expect(grantsOf('storage_grants', STORAGE_PURCHASE)).toEqual([
      expect.objectContaining({
        organization_id: ORG,
        bytes: 26843545600,
        active_until: '2026-11-20T09:00:00.000Z',
      }),
    ]);
    expect(row('add_on_purchases', STORAGE_PURCHASE)).toMatchObject({
      status: 'paid',
      stripe_invoice_id: 'in_prorated',
      amount_paid_cents: 350,
      expires_at: null,
    });

    // Delivered again: still one grant.
    await handleAddOnEvent(event('invoice.paid', paid));
    expect(grantsOf('storage_grants', STORAGE_PURCHASE)).toHaveLength(1);
  });

  it('is moved on by each renewal, and never back by an older invoice delivered late', async () => {
    const first = invoice('in_prorated', [line('si_pack', 'price_st25', 350)]);
    const renewal = invoice('in_renewal', [
      line('si_plan', 'price_growth', 24900, NEXT_PERIOD_END),
      line('si_pack', 'price_st25', 500, NEXT_PERIOD_END),
    ]);
    await handleAddOnEvent(event('invoice.paid', first));
    await handleAddOnEvent(event('invoice.paid', renewal));
    await handleAddOnEvent(event('invoice.paid', first));

    expect(grantsOf('storage_grants', STORAGE_PURCHASE)).toEqual([
      expect.objectContaining({ active_until: '2026-12-20T09:00:00.000Z' }),
    ]);
    // The first invoice stays the purchase's.
    expect(row('add_on_purchases', STORAGE_PURCHASE).stripe_invoice_id).toBe('in_prorated');
  });

  it('finds its purchase by the pack’s price when the invoice comes before the item was written down', async () => {
    row('add_on_purchases', STORAGE_PURCHASE).stripe_subscription_item_id = null;
    await handleAddOnEvent(
      event('invoice.paid', invoice('in_prorated', [line('si_new', 'price_st25', 350)])),
    );

    expect(row('add_on_purchases', STORAGE_PURCHASE)).toMatchObject({
      status: 'paid',
      stripe_subscription_item_id: 'si_new',
    });
    expect(grantsOf('storage_grants', STORAGE_PURCHASE)).toHaveLength(1);
  });

  it('leaves a plan’s invoice alone', async () => {
    await expect(
      handleAddOnEvent(
        event('invoice.paid', invoice('in_plan', [line('si_plan', 'price_growth', 24900)])),
      ),
    ).resolves.toBe(false);
    expect(db.tables.storage_grants).toEqual([]);
    expect(row('add_on_purchases', STORAGE_PURCHASE).status).toBe('pending');
  });

  it('keeps a pack’s payment, paid or declined, from changing the plan’s status', async () => {
    const packOnly = invoice('in_prorated', [line('si_pack', 'price_st25', 350)]);
    const plan = invoice('in_plan', [line('si_plan', 'price_growth', 24900)]);
    await expect(handleAddOnEvent(event('invoice.payment_failed', packOnly))).resolves.toBe(true);
    await expect(handleAddOnEvent(event('invoice.payment_succeeded', packOnly))).resolves.toBe(
      true,
    );
    await expect(handleAddOnEvent(event('invoice.payment_failed', plan))).resolves.toBe(false);
    await expect(
      handleAddOnEvent(
        event('invoice.payment_succeeded', invoice('in_ai', [], { metadata: checkout().metadata })),
      ),
    ).resolves.toBe(true);
  });
});

describe('a refund', () => {
  /** A charge refunded in full (or in part), and the payment it was for. */
  const charge = (refunded = true, metadata: Record<string, string> = {}) => ({
    id: 'ch_1',
    amount: 5000,
    amount_refunded: refunded ? 5000 : 1000,
    refunded,
    payment_intent: 'pi_1',
    metadata,
  });

  it('takes back the AI credits not yet used, once', async () => {
    await handleAddOnEvent(event('checkout.session.completed', checkout()));
    const grant = grantsOf('ai_credit_grants', AI_PURCHASE)[0];
    grant.usd_used = 4.5;
    stripeApi.retrieveIntent.mockResolvedValue({ id: 'pi_1', metadata: checkout().metadata });

    const refunded = event('charge.refunded', charge(), PAID_AT + 86_400);
    await expect(handleAddOnEvent(refunded)).resolves.toBe(true);
    await handleAddOnEvent(refunded);

    expect(grantsOf('ai_credit_grants', AI_PURCHASE)).toEqual([
      expect.objectContaining({ usd_total: 4.5, usd_used: 4.5 }),
    ]);
    expect(row('add_on_purchases', AI_PURCHASE).status).toBe('refunded');
    expect(stripeApi.listInvoicePayments).not.toHaveBeenCalled();
  });

  it('ends the storage from the refund on, and no renewal brings it back', async () => {
    await handleAddOnEvent(
      event('invoice.paid', invoice('in_prorated', [line('si_pack', 'price_st25', 350)])),
    );
    stripeApi.retrieveIntent.mockResolvedValue({ id: 'pi_1', metadata: {} });
    stripeApi.listInvoicePayments.mockResolvedValue({ data: [{ invoice: 'in_prorated' }] });

    await handleAddOnEvent(event('charge.refunded', charge(), PAID_AT + 3600));
    expect(stripeApi.listInvoicePayments).toHaveBeenCalledWith({
      payment: { type: 'payment_intent', payment_intent: 'pi_1' },
      limit: 1,
    });
    expect(row('add_on_purchases', STORAGE_PURCHASE).status).toBe('refunded');
    expect(grantsOf('storage_grants', STORAGE_PURCHASE)[0].active_until).toBe(
      '2026-10-30T11:00:00.000Z',
    );
    // Its item comes off the plan's subscription: no more monthly charges for it.
    expect(stripeApi.deleteItem).toHaveBeenCalledWith('si_pack', { proration_behavior: 'none' });

    await handleAddOnEvent(
      event(
        'invoice.paid',
        invoice('in_renewal', [line('si_pack', 'price_st25', 500, NEXT_PERIOD_END)]),
      ),
    );
    expect(grantsOf('storage_grants', STORAGE_PURCHASE)[0].active_until).toBe(
      '2026-10-30T11:00:00.000Z',
    );
  });

  it('of a storage pack whose item is already gone still settles, once', async () => {
    await handleAddOnEvent(
      event('invoice.paid', invoice('in_prorated', [line('si_pack', 'price_st25', 350)])),
    );
    stripeApi.retrieveIntent.mockResolvedValue({ id: 'pi_1', metadata: {} });
    stripeApi.listInvoicePayments.mockResolvedValue({ data: [{ invoice: 'in_prorated' }] });
    stripeApi.deleteItem.mockRejectedValueOnce(
      Object.assign(new Error('No such subscription item'), {
        code: 'resource_missing',
        statusCode: 404,
      }),
    );
    const refunded = event('charge.refunded', charge(), PAID_AT + 3600);
    await expect(handleAddOnEvent(refunded)).resolves.toBe(true);
    expect(row('add_on_purchases', STORAGE_PURCHASE).status).toBe('refunded');
    await handleAddOnEvent(refunded);
    expect(stripeApi.deleteItem).toHaveBeenCalledTimes(1);
  });

  it('of a storage pack whose item Stripe can’t remove now is sent again', async () => {
    await handleAddOnEvent(
      event('invoice.paid', invoice('in_prorated', [line('si_pack', 'price_st25', 350)])),
    );
    stripeApi.retrieveIntent.mockResolvedValue({ id: 'pi_1', metadata: {} });
    stripeApi.listInvoicePayments.mockResolvedValue({ data: [{ invoice: 'in_prorated' }] });
    stripeApi.deleteItem.mockRejectedValueOnce(
      Object.assign(new Error('down'), { statusCode: 500 }),
    );
    const refunded = event('charge.refunded', charge(), PAID_AT + 3600);
    await expect(handleAddOnEvent(refunded)).rejects.toThrow('down');
    expect(row('add_on_purchases', STORAGE_PURCHASE).status).toBe('paid');
    stripeApi.deleteItem.mockResolvedValueOnce({ id: 'si_pack', deleted: true });
    await handleAddOnEvent(refunded);
    expect(row('add_on_purchases', STORAGE_PURCHASE).status).toBe('refunded');
  });

  it('before the payment’s own event: nothing is granted, then or later', async () => {
    await handleAddOnEvent(event('charge.refunded', charge(true, checkout().metadata)));
    expect(row('add_on_purchases', AI_PURCHASE).status).toBe('failed');
    await handleAddOnEvent(event('checkout.session.completed', checkout()));
    expect(grantsOf('ai_credit_grants', AI_PURCHASE)).toEqual([]);
  });

  it('in part is left to staff', async () => {
    await handleAddOnEvent(event('checkout.session.completed', checkout()));
    await expect(handleAddOnEvent(event('charge.refunded', charge(false)))).resolves.toBe(false);
    expect(stripeApi.retrieveIntent).not.toHaveBeenCalled();
    expect(grantsOf('ai_credit_grants', AI_PURCHASE)[0]).toMatchObject({ usd_total: 25 });
    expect(row('add_on_purchases', AI_PURCHASE).status).toBe('paid');
  });

  it('of a plan’s charge touches no pack', async () => {
    stripeApi.retrieveIntent.mockResolvedValue({ id: 'pi_1', metadata: {} });
    stripeApi.listInvoicePayments.mockResolvedValue({ data: [{ invoice: 'in_plan' }] });
    await expect(handleAddOnEvent(event('charge.refunded', charge()))).resolves.toBe(false);
    expect(db.tables.add_on_purchases.map((p) => p.status)).toEqual(['pending', 'pending']);
  });
});

it('throws on a database failure, so Stripe sends the event again', async () => {
  db.failures = { ai_credit_grants: { message: 'down' } };
  await expect(handleAddOnEvent(event('checkout.session.completed', checkout()))).rejects.toThrow(
    'down',
  );
  // Nothing was marked paid without its grant.
  expect(row('add_on_purchases', AI_PURCHASE).status).toBe('pending');
  db.failures = {};
  await handleAddOnEvent(event('checkout.session.completed', checkout()));
  expect(grantsOf('ai_credit_grants', AI_PURCHASE)).toHaveLength(1);
});
