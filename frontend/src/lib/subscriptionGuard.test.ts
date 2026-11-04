// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The web app's own writes on a read-only workspace (GetCito Cloud, plan not
 * active): assertWritable reads the signed-in person's organization, with
 * their profile in one query, and refuses unless its plan is active; setup's
 * writes stay open to an organization that never subscribed; a plan it can't
 * read refuses too. Self-hosted reads nothing.
 */

let user: { id: string } | null;
let profile: { organization_id: string | null } | null;
let profileError: { message: string } | null;
/** The profile's organization, as the embed reads it (null when RLS hides it). */
let org: { subscription_status: string | null; stripe_subscription_id: string | null } | null;
/** The brand an action names, as the person's session reads it (null when RLS hides it). */
let brand: { is_demo: boolean } | null;
let brandError: { message: string } | null;
let reads: string[];

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: async () => ({ data: { user } }) },
    from: (table: string) => {
      const query = {
        select: (columns: string) => {
          reads.push(`${table}: ${columns}`);
          return query;
        },
        eq: (column: string, value: unknown) => {
          if (table === 'brands') reads.push(`brands: ${column} = ${String(value)}`);
          return query;
        },
        maybeSingle: async () =>
          table === 'brands'
            ? { data: brand, error: brandError }
            : {
                data: profile && {
                  ...profile,
                  organizations: profile.organization_id ? org : null,
                },
                error: profileError,
              },
      };
      return query;
    },
  })),
}));

const {
  assertWritable,
  DemoBrandError,
  SubscriptionInactiveError,
  failedCallResponse,
  writeRefusal,
} = await import('./subscriptionGuard');

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
  user = { id: 'user-1' };
  profile = { organization_id: 'org-1' };
  profileError = null;
  org = { subscription_status: 'canceled', stripe_subscription_id: 'sub_1' };
  brand = { is_demo: false };
  brandError = null;
  reads = [];
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('assertWritable', () => {
  it('lets an active or trialing plan write', async () => {
    for (const status of ['active', 'trialing']) {
      org = { subscription_status: status, stripe_subscription_id: 'sub_1' };
      await expect(assertWritable()).resolves.toBeUndefined();
    }
  });

  it('reads the organization with the profile, in one query', async () => {
    await assertWritable().catch(() => {});
    expect(reads).toEqual([
      'profiles: organization_id, organizations!profiles_organization_id_fkey(subscription_status, stripe_subscription_id)',
    ]);
  });

  it('refuses a plan that ended, a failed payment and an unfinished first payment', async () => {
    for (const status of ['canceled', 'past_due', 'unpaid', 'incomplete_expired', null]) {
      org = { subscription_status: status, stripe_subscription_id: 'sub_1' };
      await expect(assertWritable()).rejects.toBeInstanceOf(SubscriptionInactiveError);
      // An ended plan's setup writes are refused too.
      await expect(assertWritable({ onboarding: true })).rejects.toBeInstanceOf(
        SubscriptionInactiveError,
      );
    }
  });

  it("opens setup's writes to an organization that never subscribed, and only those", async () => {
    org = { subscription_status: null, stripe_subscription_id: null };
    await expect(assertWritable({ onboarding: true })).resolves.toBeUndefined();
    await expect(assertWritable()).rejects.toBeInstanceOf(SubscriptionInactiveError);
  });

  it('opens setup to a person with no organization yet', async () => {
    profile = { organization_id: null };
    await expect(assertWritable({ onboarding: true })).resolves.toBeUndefined();
    await expect(assertWritable()).rejects.toBeInstanceOf(SubscriptionInactiveError);
  });

  it("refuses when the plan can't be read, without calling it read-only", async () => {
    profileError = { message: 'connection reset' };
    for (const call of [() => assertWritable(), () => assertWritable({ onboarding: true })]) {
      const failure = await call().catch((err: unknown) => err);
      expect(failure).toBeInstanceOf(Error);
      expect(failure).not.toBeInstanceOf(SubscriptionInactiveError);
      expect((failure as Error).message).toContain('connection reset');
    }
  });

  it('refuses a missing profile or organization, and no one signed in', async () => {
    profile = null;
    await expect(assertWritable()).rejects.toBeInstanceOf(SubscriptionInactiveError);
    profile = { organization_id: 'org-1' };
    org = null;
    await expect(assertWritable()).rejects.toBeInstanceOf(SubscriptionInactiveError);
    user = null;
    await expect(assertWritable()).rejects.toThrow('Unauthorized');
  });

  it('never gates self-hosted, and reads nothing there', async () => {
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'false');
    user = null;
    await expect(assertWritable()).resolves.toBeUndefined();
    expect(reads).toEqual([]);
  });

  it("carries the code as its digest, which production keeps of a server action's error", () => {
    const err = new SubscriptionInactiveError();
    expect(err.digest).toBe('subscription_inactive');
    expect(err.code).toBe('subscription_inactive');
  });
});

describe('assertWritable and the demo brand', () => {
  beforeEach(() => {
    org = { subscription_status: 'active', stripe_subscription_id: 'sub_1' };
  });

  it('refuses a write on the demo brand, whatever the plan', async () => {
    brand = { is_demo: true };
    const failure = await assertWritable({ brandId: 'demo-1' }).catch((err: unknown) => err);
    expect(failure).toBeInstanceOf(DemoBrandError);
    // The digest production keeps, for the browser's plan dialog.
    expect((failure as InstanceType<typeof DemoBrandError>).digest).toBe('demo_brand');
    // Setup's writes, and a plan that ended, refuse it the same way.
    await expect(assertWritable({ onboarding: true, brandId: 'demo-1' })).rejects.toBeInstanceOf(
      DemoBrandError,
    );
    org = { subscription_status: 'canceled', stripe_subscription_id: 'sub_1' };
    await expect(assertWritable({ brandId: 'demo-1' })).rejects.toBeInstanceOf(DemoBrandError);
  });

  it('reads the brand beside the plan, and lets another brand write', async () => {
    await expect(assertWritable({ brandId: 'brand-1' })).resolves.toBeUndefined();
    expect(reads).toEqual([
      'profiles: organization_id, organizations!profiles_organization_id_fkey(subscription_status, stripe_subscription_id)',
      'brands: is_demo',
      'brands: id = brand-1',
    ]);
  });

  it('reads no brand when the action names none', async () => {
    brand = { is_demo: true };
    await expect(assertWritable()).resolves.toBeUndefined();
    expect(reads.some((read) => read.startsWith('brands'))).toBe(false);
  });

  it("leaves a brand the person can't read to the write's own row-level security", async () => {
    brand = null;
    await expect(assertWritable({ brandId: 'elsewhere' })).resolves.toBeUndefined();
  });

  it("refuses when the brand can't be read, without calling it the demo", async () => {
    brandError = { message: 'connection reset' };
    const failure = await assertWritable({ brandId: 'brand-1' }).catch((err: unknown) => err);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(DemoBrandError);
    expect((failure as Error).message).toContain('connection reset');
  });

  it('reads nothing self-hosted', async () => {
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'false');
    brand = { is_demo: true };
    await expect(assertWritable({ brandId: 'demo-1' })).resolves.toBeUndefined();
    expect(reads).toEqual([]);
  });

  it("answers a route's refusal with 402 demo_brand", async () => {
    const res = failedCallResponse(new DemoBrandError());
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ error: 'demo_brand', code: 'demo_brand' });
  });
});

describe('writeRefusal', () => {
  it('lets an active plan through', async () => {
    org = { subscription_status: 'active', stripe_subscription_id: 'sub_1' };
    expect(await writeRefusal()).toBeNull();
  });

  it('answers 402 subscription_inactive while read-only', async () => {
    const res = await writeRefusal();
    expect(res?.status).toBe(402);
    expect(await res?.json()).toMatchObject({
      error: 'plan_limit',
      code: 'subscription_inactive',
    });
  });

  it("answers 500 when the plan can't be read", async () => {
    profileError = { message: 'timeout' };
    const res = await writeRefusal();
    expect(res?.status).toBe(500);
  });
});
