// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeSupabase } from '@/lib/chat/testing/fakeSupabase';

/**
 * What a run with no session checks before it writes as its person: the
 * brand theirs to see (00388), their live role, and the brand's and plan's
 * read-only rules, each read with the service role about that person, and
 * each refusing what the person's own session would be refused.
 */

const fake = vi.hoisted(() => ({ db: null as unknown as FakeSupabase }));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: (table: string) => fake.db.from(table),
    rpc: (name: string, args?: Record<string, unknown>) => fake.db.rpc(name, args),
  },
}));

const { createFakeSupabase } = await import('@/lib/chat/testing/fakeSupabase');
const { DemoBrandError, SubscriptionInactiveError } = await import('@/lib/subscriptionGuard');
const { actorOf, assertWritableFor, canAccessBrandFor, isManagerFor } = await import('./access');

const ORG = 'org-1';
const OTHER_ORG = 'org-2';
const PERSON = 'person-1';
const BRAND = '11111111-1111-4111-8111-111111111111';
const SHARED = '22222222-2222-4222-8222-222222222222';
const DEMO = '33333333-3333-4333-8333-333333333333';
const OTHERS = '44444444-4444-4444-8444-444444444444';
const OTHERS_DEMO = '55555555-5555-4555-8555-555555555555';
const actor = { userId: PERSON, organizationId: ORG };

/** can_access_brand (00388) over the fake's tables, recording whom it was asked about. */
let askedAbout: unknown[];
function seed(db: FakeSupabase) {
  Object.assign(db.tables, {
    brands: [
      { id: BRAND, organization_id: ORG, is_demo: false },
      { id: SHARED, organization_id: ORG, is_demo: false },
      { id: DEMO, organization_id: ORG, is_demo: true },
      { id: OTHERS, organization_id: OTHER_ORG, is_demo: false },
      { id: OTHERS_DEMO, organization_id: OTHER_ORG, is_demo: true },
    ],
    profiles: [{ id: PERSON, organization_id: ORG, role: 'analyst', brand_scope: 'all' }],
    member_brands: [],
    organizations: [{ id: ORG, subscription_status: 'active' }],
  });
  db.rpcs.can_access_brand = ({ p_brand_id, p_user_id }) => {
    askedAbout.push(p_user_id);
    const brand = db.tables.brands.find((b) => b.id === p_brand_id);
    const person = db.tables.profiles.find((p) => p.id === p_user_id);
    if (!brand || !person || person.organization_id !== brand.organization_id) return false;
    return (
      person.role === 'admin' ||
      person.brand_scope === 'all' ||
      brand.is_demo === true ||
      db.tables.member_brands.some((m) => m.user_id === person.id && m.brand_id === brand.id)
    );
  };
}
const person = (fields: Record<string, unknown>) =>
  Object.assign(fake.db.tables.profiles[0], fields);

beforeEach(() => {
  askedAbout = [];
  fake.db = createFakeSupabase();
  seed(fake.db);
});
afterEach(() => vi.unstubAllEnvs());

describe('actorOf', () => {
  it('takes the run’s person and workspace from the tool’s context, and refuses one with none', () => {
    const ctx = { userId: PERSON, organizationId: ORG, email: null, role: 'admin', apiKeyId: 'x' };
    expect(actorOf(ctx)).toEqual(actor);
    expect(() => actorOf({ userId: PERSON, organizationId: null })).toThrow(/workspace/);
  });
});

describe('canAccessBrandFor', () => {
  it('lets the person see their workspace’s brands with All brands, asking about them', async () => {
    expect(await canAccessBrandFor(actor, BRAND)).toBe(true);
    expect(askedAbout).toEqual([PERSON]);
  });

  it('with Selected brands, only the brands shared with them and the demo brand', async () => {
    person({ brand_scope: 'selected' });
    fake.db.tables.member_brands = [{ user_id: PERSON, brand_id: SHARED }];
    expect(await canAccessBrandFor(actor, SHARED)).toBe(true);
    expect(await canAccessBrandFor(actor, DEMO)).toBe(true);
    expect(await canAccessBrandFor(actor, BRAND)).toBe(false);
    // An Admin has every brand, whatever was stored.
    person({ role: 'admin' });
    expect(await canAccessBrandFor(actor, BRAND)).toBe(true);
  });

  it('refuses another workspace’s brand, and every brand once the person left the run’s', async () => {
    expect(await canAccessBrandFor(actor, OTHERS)).toBe(false);
    // Their run is still the old workspace's: a brand of the new one isn't its to write.
    expect(await canAccessBrandFor({ ...actor, organizationId: OTHER_ORG }, OTHERS)).toBe(false);
    person({ organization_id: OTHER_ORG });
    expect(await canAccessBrandFor(actor, BRAND)).toBe(false);
    fake.db.tables.profiles = [];
    expect(await canAccessBrandFor(actor, BRAND)).toBe(false);
  });

  it('refuses an id that isn’t one without reading, and throws when it can’t read', async () => {
    expect(await canAccessBrandFor(actor, 'not-a-brand')).toBe(false);
    expect(fake.db.log).toEqual([]);
    fake.db.failures.brands = { message: 'timeout' };
    await expect(canAccessBrandFor(actor, BRAND)).rejects.toThrow(/timeout/);
  });
});

describe('isManagerFor', () => {
  it('says yes for an Admin or a Manager, and no for an Analyst or an Agency partner', async () => {
    for (const [role, manager] of [
      ['admin', true],
      ['manager', true],
      ['analyst', false],
      ['agency_partner', false],
    ] as const) {
      person({ role });
      expect(await isManagerFor(actor, ORG)).toBe(manager);
    }
  });

  it('says no for another organization than the run’s, or once the person left it', async () => {
    person({ role: 'admin' });
    expect(await isManagerFor(actor, OTHER_ORG)).toBe(false);
    person({ organization_id: OTHER_ORG });
    expect(await isManagerFor(actor, ORG)).toBe(false);
    expect(await isManagerFor({ ...actor, organizationId: OTHER_ORG }, OTHER_ORG)).toBe(true);
  });
});

describe('assertWritableFor', () => {
  it('lets an active or trialing plan write on the cloud', async () => {
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
    await expect(assertWritableFor(actor, BRAND)).resolves.toBeUndefined();
    fake.db.tables.organizations[0].subscription_status = 'trialing';
    await expect(assertWritableFor(actor, BRAND)).resolves.toBeUndefined();
  });

  it('refuses a read-only workspace on the cloud: a plan canceled, unpaid or not found', async () => {
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
    for (const status of ['canceled', 'past_due', 'incomplete', null]) {
      fake.db.tables.organizations[0].subscription_status = status;
      await expect(assertWritableFor(actor, BRAND)).rejects.toBeInstanceOf(
        SubscriptionInactiveError,
      );
    }
    fake.db.tables.organizations = [];
    await expect(assertWritableFor(actor, BRAND)).rejects.toBeInstanceOf(SubscriptionInactiveError);
  });

  it('refuses the demo brand on the cloud and off it, whatever the plan', async () => {
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
    await expect(assertWritableFor(actor, DEMO)).rejects.toBeInstanceOf(DemoBrandError);
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'false');
    await expect(assertWritableFor(actor, DEMO)).rejects.toBeInstanceOf(DemoBrandError);
  });

  it('refuses a brand that isn’t the run’s workspace’s, saying nothing of it', async () => {
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
    // Another workspace's demo brand is not found, not the demo brand.
    for (const brand of [OTHERS, OTHERS_DEMO, '66666666-6666-4666-8666-666666666666']) {
      await expect(assertWritableFor(actor, brand)).rejects.toThrow('not_found');
    }
  });

  it('never reads the plan self-hosted, and refuses what it can’t read', async () => {
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'false');
    fake.db.tables.organizations[0].subscription_status = 'canceled';
    await expect(assertWritableFor(actor, BRAND)).resolves.toBeUndefined();
    expect(fake.db.log.map(([table]) => table)).toEqual(['brands']);
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
    fake.db.tables.organizations[0].subscription_status = 'active';
    fake.db.failures.organizations = { message: 'timeout' };
    await expect(assertWritableFor(actor, BRAND)).rejects.toThrow(/plan: timeout/);
    fake.db.failures = { brands: { message: 'timeout' } };
    await expect(assertWritableFor(actor, BRAND)).rejects.toThrow(/brand: timeout/);
  });
});
