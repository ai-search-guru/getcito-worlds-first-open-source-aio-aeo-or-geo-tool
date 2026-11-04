// @vitest-environment node
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { FakeSupabase } from '@/lib/chat/testing/fakeSupabase';

/**
 * Without STRIPE_SECRET_KEY (local development, self-hosted), lib/stripe.ts
 * throws when it is loaded. The add-on actions never load it until a
 * purchase starts, so their module, and every action bundled with it on
 * Settings, still loads; a purchase answers "unavailable". The real
 * lib/stripe.ts here: nothing mocks it.
 */

const savedKey = process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_SECRET_KEY;

vi.mock('@/lib/supabase/admin', async () => ({
  supabaseAdmin: (await import('@/lib/chat/testing/fakeSupabase')).createFakeSupabase(),
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u_admin', email: 'a@example.com' } } }) },
  }),
}));

const ORG = '11111111-1111-4111-8111-111111111111';

afterAll(() => {
  if (savedKey !== undefined) process.env.STRIPE_SECRET_KEY = savedKey;
  vi.unstubAllEnvs();
});

describe('the add-on actions without a Stripe key', () => {
  it('load, though lib/stripe.ts itself can’t', async () => {
    await expect(import('@/lib/stripe')).rejects.toThrow();
    await expect(import('./addOns')).resolves.toMatchObject({
      startAddOnPurchase: expect.any(Function),
      getBillingAddOns: expect.any(Function),
    });
  });

  it('answer a purchase "unavailable", with nothing written, and still list the packs', async () => {
    vi.stubEnv('CHAT_AGENTIC', 'true');
    vi.stubEnv('CHAT_AGENTIC_ORGS', '');
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
    const { supabaseAdmin } = await import('@/lib/supabase/admin');
    const db = supabaseAdmin as unknown as FakeSupabase;
    db.tables = {
      profiles: [{ id: 'u_admin', organization_id: ORG, role: 'admin' }],
      organizations: [
        {
          id: ORG,
          subscription_status: 'active',
          stripe_customer_id: 'cus_1',
          stripe_subscription_id: 'sub_1',
        },
      ],
      add_on_products: [
        {
          id: 'ai_50',
          kind: 'ai',
          name: 'AI credits $50',
          price_cents: 5000,
          currency: 'usd',
          billing: 'one_time',
          grant_ai_usd: 25,
          grant_bytes: null,
          valid_months: 12,
          stripe_price_id: 'price_ai50',
          active: true,
          highlight: true,
          sort: 2,
        },
      ],
      add_on_purchases: [],
    };
    const { getBillingAddOns, startAddOnPurchase } = await import('./addOns');
    await expect(startAddOnPurchase('ai_50')).resolves.toEqual({
      ok: false,
      failure: 'unavailable',
    });
    expect(db.tables.add_on_purchases).toEqual([]);

    // Billing's packs and credit line are read without Stripe.
    db.tables.organizations[0] = {
      ...db.tables.organizations[0],
      plan: 'growth',
      plan_overrides: null,
    };
    db.tables.ai_credit_grants = [];
    db.tables.storage_grants = [];
    const read = await getBillingAddOns();
    expect(read).toMatchObject({
      ok: true,
      addOns: {
        isAdmin: true,
        buy: 'open',
        credit: null,
        purchases: [],
        packs: [{ id: 'ai_50', adds: { kind: 'limits', count: 1 }, mostPicked: true }],
      },
    });
  });
});
