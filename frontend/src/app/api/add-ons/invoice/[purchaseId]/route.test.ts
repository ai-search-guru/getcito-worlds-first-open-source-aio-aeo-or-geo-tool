// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { FakeSupabase } from '@/lib/chat/testing/fakeSupabase';

/**
 * A pack's invoice from Billing's purchases: Admins of the purchase's
 * workspace only, sent on to the PDF. Stripe is mocked.
 */

vi.mock('@/lib/supabase/admin', async () => ({
  supabaseAdmin: (await import('@/lib/chat/testing/fakeSupabase')).createFakeSupabase(),
}));
const auth = vi.hoisted(() => ({ userId: 'u_admin' }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: auth.userId } } }) },
  }),
}));
const retrieve = vi.hoisted(() => vi.fn());
vi.mock('@/lib/stripe', () => ({ stripe: { invoices: { retrieve } } }));

const { supabaseAdmin } = await import('@/lib/supabase/admin');
const db = supabaseAdmin as unknown as FakeSupabase;
const { GET } = await import('./route');

const ORG = '11111111-1111-4111-8111-111111111111';
const OURS = 'a0000000-0000-4000-8000-000000000001';
const THEIRS = 'a0000000-0000-4000-8000-000000000002';

const get = (purchaseId: string) =>
  GET(new Request('http://localhost/api/add-ons/invoice/x'), {
    params: Promise.resolve({ purchaseId }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('CHAT_AGENTIC', 'true');
  vi.stubEnv('CHAT_AGENTIC_ORGS', '');
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_x');
  auth.userId = 'u_admin';
  db.failures = {};
  db.tables = {
    profiles: [
      { id: 'u_admin', organization_id: ORG, role: 'admin' },
      { id: 'u_analyst', organization_id: ORG, role: 'analyst' },
    ],
    add_on_purchases: [
      { id: OURS, organization_id: ORG, stripe_invoice_id: 'in_1' },
      {
        id: THEIRS,
        organization_id: '99999999-9999-4999-8999-999999999999',
        stripe_invoice_id: 'in_2',
      },
    ],
  };
  retrieve.mockResolvedValue({
    invoice_pdf: 'https://pay.stripe.com/invoice/in_1/pdf',
    hosted_invoice_url: null,
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

it('sends an Admin on to the invoice’s PDF', async () => {
  const res = await get(OURS);
  expect(res.status).toBe(307);
  expect(res.headers.get('location')).toBe('https://pay.stripe.com/invoice/in_1/pdf');
  expect(retrieve).toHaveBeenCalledWith('in_1');
});

it('is the Admins’ only, and only their own workspace’s', async () => {
  expect((await get(THEIRS)).status).toBe(404);
  expect((await get('not-an-id')).status).toBe(404);
  auth.userId = 'u_analyst';
  expect((await get(OURS)).status).toBe(403);
  expect(retrieve).not.toHaveBeenCalled();
});

it('is off while Chat is off', async () => {
  vi.stubEnv('CHAT_AGENTIC', 'false');
  expect((await get(OURS)).status).toBe(404);
});

it('is not found on a deployment without Stripe', async () => {
  vi.stubEnv('STRIPE_SECRET_KEY', '');
  expect((await get(OURS)).status).toBe(404);
  expect(retrieve).not.toHaveBeenCalled();
});
