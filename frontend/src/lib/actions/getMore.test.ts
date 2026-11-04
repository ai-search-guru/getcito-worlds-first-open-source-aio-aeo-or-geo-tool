// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Get more window's read (CHAT-18 §C): Billing's packs, the workspace's
 * plan card and its storage, on the cloud with Chat on; `off` otherwise and
 * `failed` when a read throws, never a throw (#1777).
 */

const ORG = 'org-1';
let org: Record<string, unknown> | null;
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
  }),
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () =>
          table === 'profiles'
            ? { data: { organization_id: ORG }, error: null }
            : { data: org, error: null },
      };
      return query;
    },
  },
}));
const flag = vi.hoisted(() => ({ on: true }));
vi.mock('@/lib/chat/flag', () => ({ chatAgenticEnabled: () => flag.on }));
const storage = vi.hoisted(() => ({
  readChatStorage: vi.fn(async () => ({ usedBytes: 10, limitBytes: 100, fileCount: 1 })),
}));
vi.mock('@/lib/chat/fileOutput', () => storage);
const addOns = vi.hoisted(() => ({ getBillingAddOns: vi.fn() }));
vi.mock('./addOns', () => addOns);

const { getGetMore } = await import('./getMore');

const BILLING = { isAdmin: true, buy: 'open', packs: [], credit: null, purchases: [] };

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
  flag.on = true;
  org = { plan: 'growth', subscription_status: 'active', plan_overrides: null };
  addOns.getBillingAddOns.mockReset().mockResolvedValue({ ok: true, addOns: BILLING });
  storage.readChatStorage.mockClear();
});
afterEach(() => vi.unstubAllEnvs());

describe('getGetMore', () => {
  it('reads the packs, the plan card and the storage together', async () => {
    const read = await getGetMore();
    if (!read.ok) throw new Error(read.failure);
    expect(read.window.addOns).toEqual(BILLING);
    expect(read.window.plan).toMatchObject({ planId: 'growth', planName: 'Growth' });
    expect(read.window.storage).toEqual({ usedBytes: 10, limitBytes: 100, fileCount: 1 });
    expect(storage.readChatStorage).toHaveBeenCalledWith(ORG);
  });

  it('has no window self-hosted or with Chat off, and says a failed read', async () => {
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'false');
    expect(await getGetMore()).toEqual({ ok: false, failure: 'off' });
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
    addOns.getBillingAddOns.mockResolvedValueOnce({ ok: false, failure: 'off' });
    flag.on = false;
    expect(await getGetMore()).toEqual({ ok: false, failure: 'off' });
    flag.on = true;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    storage.readChatStorage.mockRejectedValueOnce(new Error('connection reset'));
    expect(await getGetMore()).toEqual({ ok: false, failure: 'failed' });
  });
});
