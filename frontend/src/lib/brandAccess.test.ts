// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeSupabase } from '@/lib/chat/testing/fakeSupabase';

/**
 * Brand access on the web's server paths (BRAND-ACCESS §5.3): All brands
 * reaches every brand of the person's organization, Selected brands the
 * ones shared with them and the demo brand, an Admin always all; read
 * fresh, with the service role, and as All brands before 00388.
 */

const fake = vi.hoisted(() => ({ db: null as unknown as FakeSupabase }));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: (table: string) => fake.db.from(table),
    rpc: (name: string, args?: Record<string, unknown>) => fake.db.rpc(name, args),
  },
}));

const { createFakeSupabase } = await import('@/lib/chat/testing/fakeSupabase');
const { supabaseAdmin } = await import('@/lib/supabase/admin');
const {
  allowedBrands,
  brandAccessFor,
  brandAccessOf,
  brandReaders,
  canAccessBrand,
  hasBrandAccess,
  readAccessProfile,
  readBrandAccess,
} = await import('./brandAccess');

const ORG = 'org-1';
const OTHER_ORG = 'org-2';
const PERSON = 'person-1';
const BRAND = '11111111-1111-4111-8111-111111111111';
const SHARED = '22222222-2222-4222-8222-222222222222';
const DEMO = '33333333-3333-4333-8333-333333333333';
const OTHERS = '44444444-4444-4444-8444-444444444444';

/** can_access_brand (00388) over the fake's tables. */
function seed(db: FakeSupabase) {
  Object.assign(db.tables, {
    brands: [
      { id: BRAND, organization_id: ORG, is_demo: false },
      { id: SHARED, organization_id: ORG, is_demo: false },
      { id: DEMO, organization_id: ORG, is_demo: true },
      { id: OTHERS, organization_id: OTHER_ORG, is_demo: false },
    ],
    profiles: [{ id: PERSON, organization_id: ORG, role: 'manager', brand_scope: 'all' }],
    member_brands: [],
  });
  db.rpcs.can_access_brand = ({ p_brand_id, p_user_id }) => {
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

const person = (patch: Record<string, unknown>) => Object.assign(fake.db.tables.profiles[0], patch);
const share = (...brandIds: string[]) => {
  fake.db.tables.member_brands = brandIds.map((brand_id) => ({
    user_id: PERSON,
    organization_id: ORG,
    brand_id,
  }));
};

/** The first profiles read answers that brand_scope isn't there (a database before 00388). */
function before00388() {
  const real = supabaseAdmin.from.bind(supabaseAdmin);
  vi.spyOn(supabaseAdmin, 'from').mockImplementationOnce(((table: string) =>
    table === 'profiles'
      ? {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: null,
                error: { code: '42703', message: 'column profiles.brand_scope does not exist' },
              }),
            }),
          }),
        }
      : real(table)) as never);
}

beforeEach(() => {
  fake.db = createFakeSupabase();
  seed(fake.db);
});
afterEach(() => vi.restoreAllMocks());

describe('readBrandAccess', () => {
  it('is all for everyone as they start: All brands, and an Admin always', async () => {
    expect(await readBrandAccess(PERSON, ORG)).toBe('all');
    person({ role: 'admin', brand_scope: 'selected' });
    expect(await readBrandAccess(PERSON, ORG)).toBe('all');
    // Nothing else is read for them.
    expect(fake.db.log.map(([table]) => table)).toEqual(['profiles', 'profiles']);
  });

  it('is the brands shared with a Selected-brands person in their organization, and the demo brand', async () => {
    person({ brand_scope: 'selected' });
    share(SHARED);
    // A grant of another organization (a move the trigger hasn't cleaned yet) doesn't count.
    fake.db.tables.member_brands.push({
      user_id: PERSON,
      organization_id: OTHER_ORG,
      brand_id: OTHERS,
    });
    expect(await readBrandAccess(PERSON, ORG)).toEqual([SHARED, DEMO]);
    share();
    expect(await readBrandAccess(PERSON, ORG)).toEqual([DEMO]);
  });

  it('is null for someone who is not a member of the organization', async () => {
    expect(await readBrandAccess(PERSON, OTHER_ORG)).toBeNull();
    person({ organization_id: null });
    expect(await readBrandAccess(PERSON, ORG)).toBeNull();
    fake.db.tables.profiles = [];
    expect(await readBrandAccess(PERSON, ORG)).toBeNull();
  });

  it('reads All brands before 00388, and throws on a read that fails', async () => {
    person({ brand_scope: 'selected' });
    before00388();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await readAccessProfile(PERSON)).toEqual({
      id: PERSON,
      organization_id: ORG,
      role: 'manager',
      brand_scope: 'all',
    });
    fake.db.failures.member_brands = { message: 'timeout' };
    await expect(readBrandAccess(PERSON, ORG)).rejects.toThrow(/timeout/);
    fake.db.failures = { profiles: { message: 'timeout' } };
    await expect(readBrandAccess(PERSON, ORG)).rejects.toThrow(/timeout/);
  });

  it('decides from a profile already read, without reading it again', async () => {
    expect(
      await brandAccessOf(
        { role: 'analyst', organization_id: ORG, brand_scope: 'all' },
        PERSON,
        ORG,
      ),
    ).toBe('all');
    share(BRAND);
    expect(
      await brandAccessOf(
        { role: 'analyst', organization_id: ORG, brand_scope: 'selected' },
        PERSON,
        ORG,
      ),
    ).toEqual([BRAND, DEMO]);
    expect(fake.db.log.map(([table]) => table)).not.toContain('profiles');
  });

  it('reads a scope it doesn’t know, or none, as Selected brands: the closed side', async () => {
    share(SHARED);
    for (const brand_scope of [undefined, null, 'everything']) {
      expect(
        await brandAccessOf({ role: 'manager', organization_id: ORG, brand_scope }, PERSON, ORG),
      ).toEqual([SHARED, DEMO]);
    }
  });
});

describe('brandAccessFor', () => {
  it('takes the access its caller read already, and reads it otherwise', async () => {
    const auth = { userId: PERSON, organizationId: ORG };
    expect(await brandAccessFor({ ...auth, brandAccess: [SHARED] })).toEqual([SHARED]);
    expect(await brandAccessFor({ ...auth, brandAccess: null })).toBeNull();
    expect(fake.db.log).toEqual([]);
    expect(await brandAccessFor(auth)).toBe('all');
    expect(await brandAccessFor({ ...auth, organizationId: null })).toBeNull();
  });
});

describe('hasBrandAccess and allowedBrands', () => {
  it('reach every brand with all, the listed ones with Selected brands, none without a membership', () => {
    const brands = [{ id: BRAND }, { id: SHARED }, { id: DEMO }];
    expect(hasBrandAccess('all', BRAND)).toBe(true);
    expect(hasBrandAccess([SHARED], BRAND)).toBe(false);
    expect(hasBrandAccess([SHARED], SHARED)).toBe(true);
    expect(hasBrandAccess(null, BRAND)).toBe(false);
    expect(allowedBrands('all', brands)).toEqual(brands);
    expect(allowedBrands([DEMO, SHARED], brands)).toEqual([{ id: SHARED }, { id: DEMO }]);
    expect(allowedBrands(null, brands)).toEqual([]);
  });
});

describe('canAccessBrand', () => {
  it("answers the database's rule: All brands, a shared brand, the demo brand", async () => {
    expect(await canAccessBrand(PERSON, BRAND)).toBe(true);
    person({ brand_scope: 'selected' });
    share(SHARED);
    expect(await canAccessBrand(PERSON, BRAND)).toBe(false);
    expect(await canAccessBrand(PERSON, SHARED, ORG)).toBe(true);
    expect(await canAccessBrand(PERSON, DEMO, ORG)).toBe(true);
  });

  it('refuses another organization’s brand, and a brand of another than the one asked about', async () => {
    expect(await canAccessBrand(PERSON, OTHERS)).toBe(false);
    // The person may see BRAND, but the run or key acts in another workspace.
    expect(await canAccessBrand(PERSON, BRAND, OTHER_ORG)).toBe(false);
  });

  it('refuses an id that isn’t one without reading, and throws when it can’t read', async () => {
    expect(await canAccessBrand(PERSON, 'not-a-brand')).toBe(false);
    expect(fake.db.log).toEqual([]);
    fake.db.failures.brands = { message: 'timeout' };
    await expect(canAccessBrand(PERSON, BRAND, ORG)).rejects.toThrow(/timeout/);
  });

  it('answers nothing on a guess: without can_access_brand (before 00388) it throws', async () => {
    delete fake.db.rpcs.can_access_brand;
    await expect(canAccessBrand(PERSON, BRAND)).rejects.toThrow(/brand's access/);
  });
});

describe('brandReaders', () => {
  const ADMIN = 'admin-1';
  const NARROW = 'narrow-1';
  const ELSEWHERE = 'elsewhere-1';
  beforeEach(() => {
    fake.db.tables.profiles.push(
      { id: ADMIN, organization_id: ORG, role: 'admin', brand_scope: 'selected' },
      { id: NARROW, organization_id: ORG, role: 'analyst', brand_scope: 'selected' },
      { id: ELSEWHERE, organization_id: OTHER_ORG, role: 'admin', brand_scope: 'all' },
    );
  });
  const ids = (readers: Map<string, Set<string>>, brandId: string) =>
    [...readers].filter(([, brands]) => brands.has(brandId)).map(([id]) => id);

  it('lists everyone in the organization who has All brands, an Admin always', async () => {
    const readers = await brandReaders(ORG, [BRAND]);
    expect(ids(readers, BRAND)).toEqual([PERSON, ADMIN]);
    // A Selected-brands person without a grant, and another organization's people, aren't.
    expect(readers.has(NARROW)).toBe(false);
    expect(readers.has(ELSEWHERE)).toBe(false);
  });

  it('adds a Selected-brands person for the brands shared with them, and the demo brand', async () => {
    fake.db.tables.member_brands = [{ user_id: NARROW, organization_id: ORG, brand_id: SHARED }];
    const readers = await brandReaders(ORG, [BRAND, SHARED, DEMO]);
    expect(ids(readers, BRAND)).toEqual([PERSON, ADMIN]);
    expect(ids(readers, SHARED)).toEqual([PERSON, ADMIN, NARROW]);
    expect(ids(readers, DEMO)).toEqual([PERSON, ADMIN, NARROW]);
    expect(readers.get(NARROW)).toEqual(new Set([SHARED, DEMO]));
  });

  it('reads no grant while everyone has All brands', async () => {
    fake.db.tables.profiles = fake.db.tables.profiles.filter((p) => p.id !== NARROW);
    await brandReaders(ORG, [BRAND]);
    expect(fake.db.log.map(([table]) => table)).not.toContain('member_brands');
  });

  it('counts no one for another organization’s brand, or an id that isn’t one', async () => {
    expect((await brandReaders(ORG, [OTHERS])).size).toBe(0);
    expect((await brandReaders(ORG, ['not-a-brand'])).size).toBe(0);
    expect((await brandReaders(ORG, [])).size).toBe(0);
  });

  it('reads everyone as All brands before 00388', async () => {
    const real = supabaseAdmin.from.bind(supabaseAdmin);
    vi.spyOn(supabaseAdmin, 'from').mockImplementation(((table: string) =>
      table === 'profiles'
        ? {
            select: (columns: string) =>
              columns.includes('brand_scope')
                ? {
                    eq: async () => ({
                      data: null,
                      error: {
                        code: '42703',
                        message: 'column profiles.brand_scope does not exist',
                      },
                    }),
                  }
                : real(table).select(columns),
          }
        : real(table)) as never);
    expect(ids(await brandReaders(ORG, [BRAND]), BRAND)).toEqual([PERSON, ADMIN, NARROW]);
  });

  it('throws on a read that fails', async () => {
    fake.db.failures.profiles = { message: 'timeout' };
    await expect(brandReaders(ORG, [BRAND])).rejects.toThrow(/timeout/);
  });
});
