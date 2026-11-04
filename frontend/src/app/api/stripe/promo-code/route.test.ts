import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * POST /api/stripe/promo-code: whether a code typed in the plan dialog can be
 * redeemed, read from Stripe, and what it takes off. Admins only.
 */

let role: string;
let user: { id: string } | null;

/** A Supabase query that answers `single()` with the row given. */
const row = (data: unknown) => {
  const query = { select: () => query, eq: () => query, single: async () => ({ data }) };
  return query;
};

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user } }) },
    from: (table: string) =>
      row(
        table === 'profiles' ? { organization_id: 'org1', role } : { stripe_customer_id: 'cus_1' },
      ),
  }),
}));

const listCodes = vi.hoisted(() => vi.fn());
vi.mock('@/lib/stripe', () => ({ stripe: { promotionCodes: { list: listCodes } } }));

const { POST } = await import('./route');

const post = (body: unknown) =>
  POST(
    new Request('http://localhost/api/stripe/promo-code', {
      method: 'POST',
      body: JSON.stringify(body),
    }) as unknown as NextRequest,
  );

/** SAVE50 as Stripe lists it: 50% off the first invoice. */
const save50 = {
  id: 'promo_save50',
  code: 'SAVE50',
  active: true,
  customer: null,
  expires_at: null,
  max_redemptions: null,
  times_redeemed: 3,
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

beforeEach(() => {
  vi.clearAllMocks();
  role = 'admin';
  user = { id: 'u1' };
  listCodes.mockResolvedValue({ data: [save50] });
});

describe('POST /api/stripe/promo-code', () => {
  it('reads a valid code from Stripe: 50% off the first month, monthly plans only', async () => {
    const res = await post({ code: 'save50' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      valid: true,
      code: 'SAVE50',
      percentOff: 50,
      amountOff: null,
      duration: 'once',
      durationInMonths: null,
      monthlyOnly: true,
    });
    expect(listCodes).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'save50', active: true, limit: 1 }),
    );
  });

  it('answers not valid for a code Stripe does not have', async () => {
    listCodes.mockResolvedValue({ data: [] });
    const res = await post({ code: 'NOPE' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ valid: false });
  });

  it('answers not valid for a code kept for another customer', async () => {
    listCodes.mockResolvedValue({ data: [{ ...save50, customer: 'cus_other' }] });
    expect(await (await post({ code: 'SAVE50' })).json()).toEqual({ valid: false });
  });

  it('leaves codes to admins, as buying a plan is', async () => {
    role = 'analyst';
    const res = await post({ code: 'SAVE50' });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'admin_only' });
    expect(listCodes).not.toHaveBeenCalled();
  });

  it('asks for a signed-in caller and a code', async () => {
    expect((await post({})).status).toBe(400);
    user = null;
    expect((await post({ code: 'SAVE50' })).status).toBe(401);
    expect(listCodes).not.toHaveBeenCalled();
  });
});
