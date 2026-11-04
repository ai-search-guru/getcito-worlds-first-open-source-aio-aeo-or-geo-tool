import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Who reaches a brand (BRAND-ACCESS spec §5.2, 00388's can_access_brand):
 * the organization's people, and with Selected brands only the brands
 * granted to them, an Admin and the demo brand always. With All brands, the
 * default, every answer is the organization check's; a caller without an
 * organization reaches none. The caller is read once a request.
 */

// The database's answers: the brand (or brands), the caller's profile, their grants, the prompts.
const state = vi.hoisted(() => ({
  brand: null,
  brandError: null,
  brands: [],
  profile: null,
  profileError: null,
  // Before 00388: profiles has no brand_scope (42703 for a select naming it).
  noBrandScope: false,
  grants: [],
  grantsError: null,
  opps: [],
  prompts: [],
  // The organization's people, and their grants, as brandReaders reads them:
  // filtered, and the grants paged, as the database would.
  members: [],
  membersError: null,
  memberGrants: [],
  memberGrantsError: null,
  brandsError: null,
  reads: [],
  filters: [],
}));

/** The rows a read's filters keep: each `eq`/`in` as the database applies it. */
const filtered = (rows, where) =>
  rows.filter((row) => where.every(([column, values]) => values.includes(row[column])));

const logger = vi.hoisted(() => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }));
vi.mock('./logger.js', () => ({ logger, default: logger }));

vi.mock('../config/supabase.js', () => ({
  default: {
    from: (table) => {
      let selected = '';
      const where = [];
      let slice = null;
      const chain = {
        select: (columns) => {
          selected = columns;
          state.reads.push([table, columns]);
          return chain;
        },
        eq: (column, value) => (
          state.filters.push([table, column, value]),
          where.push([column, [value]]),
          chain
        ),
        in: (column, values) => (
          state.filters.push([table, column, values]),
          where.push([column, values]),
          chain
        ),
        order: () => chain,
        range: (from, to) => ((slice = [from, to + 1]), chain),
        single: async () => ({ data: state.opps[0] ?? null, error: null }),
        maybeSingle: async () => {
          if (table === 'brands') return { data: state.brand, error: state.brandError };
          if (!state.noBrandScope) return { data: state.profile, error: state.profileError };
          // Before 00388: naming brand_scope fails; the row comes back without it.
          if (selected.includes('brand_scope')) {
            return { data: null, error: { code: '42703', message: 'column does not exist' } };
          }
          const { organization_id, role } = state.profile;
          return { data: { organization_id, role }, error: null };
        },
        then: (resolve) =>
          resolve(
            table === 'profiles'
              ? state.noBrandScope && selected.includes('brand_scope')
                ? { data: null, error: { code: '42703', message: 'column does not exist' } }
                : state.membersError
                  ? { data: null, error: state.membersError }
                  : {
                      // PostgREST's max_rows: 1000 a read, the rest dropped.
                      data: filtered(state.members, where)
                        .slice(...(slice ?? [0, 1000]))
                        .map(({ brand_scope, ...rest }) =>
                          state.noBrandScope ? rest : { ...rest, brand_scope },
                        ),
                      error: null,
                    }
              : table === 'member_brands' && selected.includes('user_id')
                ? state.memberGrantsError
                  ? { data: null, error: state.memberGrantsError }
                  : {
                      data: filtered(state.memberGrants, where).slice(...(slice ?? [0])),
                      error: null,
                    }
                : table === 'member_brands'
                  ? {
                      data: state.grantsError
                        ? null
                        : state.grants.map((brand_id) => ({ brand_id })),
                      error: state.grantsError,
                    }
                  : table === 'brands'
                    ? state.brandsError
                      ? { data: null, error: state.brandsError }
                      : { data: filtered(state.brands, where), error: null }
                    : table === 'content_opportunities'
                      ? { data: state.opps, error: null }
                      : { data: state.prompts, error: null },
          ),
      };
      return chain;
    },
  },
}));

const {
  assertAllBrands,
  assertBrandAccess,
  assertEveryBrand,
  assertOpportunitiesAccess,
  assertPromptAccess,
  assertRole,
  brandOutsiders,
  brandReaders,
  MANAGER_ROLES,
  NOT_IN_WORKSPACE,
  NO_BRAND_ACCESS,
} = await import('./access.js');
const { requestScope } = await import('./requestScope.js');

/** Runs `fn` inside one request's store, as server.js mounts it on /api. */
const inRequest = (fn) =>
  new Promise((resolve, reject) =>
    requestScope({}, new EventEmitter(), () => fn().then(resolve, reject)),
  );

const profileReads = () => state.reads.filter(([table]) => table === 'profiles').length;
const grantReads = () => state.reads.filter(([table]) => table === 'member_brands').length;

beforeEach(() => {
  state.brand = { id: 'b1', organization_id: 'org-1', is_demo: false };
  state.brandError = null;
  state.brands = [];
  state.profile = { organization_id: 'org-1', role: 'manager', brand_scope: 'all' };
  state.profileError = null;
  state.noBrandScope = false;
  state.grants = [];
  state.grantsError = null;
  state.opps = [];
  state.prompts = [];
  state.members = [];
  state.membersError = null;
  state.memberGrants = [];
  state.memberGrantsError = null;
  state.brandsError = null;
  state.reads = [];
  state.filters = [];
  logger.warn.mockClear();
});

describe('assertBrandAccess', () => {
  it('lets a brand of the caller’s organization through, with their role', async () => {
    await expect(assertBrandAccess('b1', 'u1')).resolves.toMatchObject({
      orgId: 'org-1',
      role: 'manager',
      brand: { id: 'b1' },
    });
    // All brands reads no grants.
    expect(state.reads.some(([table]) => table === 'member_brands')).toBe(false);
  });

  // BUG-001: a bare "Unauthorized" read as a session problem, with no reason.
  it('says in plain words that another organization’s brand isn’t in the workspace, as a 403', async () => {
    state.profile.organization_id = 'org-2';
    await expect(assertBrandAccess('b1', 'u1')).rejects.toMatchObject({
      message: NOT_IN_WORKSPACE,
      status: 403,
      code: 'not_in_workspace',
    });
  });

  it('says a brand that is gone, or an id that names none, is not found', async () => {
    state.brand = null;
    await expect(assertBrandAccess('b1', 'u1')).rejects.toMatchObject({ status: 404 });
    // Postgres' invalid text: 'undefined' is no uuid.
    state.brandError = { code: '22P02', message: 'invalid input syntax for type uuid' };
    await expect(assertBrandAccess('undefined', 'u1')).rejects.toMatchObject({ status: 404 });
  });

  it('fails, not says not found, when the brand cannot be read', async () => {
    state.brandError = { code: '08006', message: 'connection reset' };
    const err = await assertBrandAccess('b1', 'u1').catch((e) => e);
    expect(err.message).toBe('connection reset');
    expect(err.status).toBeUndefined();
  });

  it('refuses a caller without an organization, or without a profile, as not in the workspace', async () => {
    state.profile.organization_id = null;
    await expect(assertBrandAccess('b1', 'u1')).rejects.toMatchObject({
      status: 403,
      code: 'not_in_workspace',
    });
    state.profile = null;
    await expect(assertBrandAccess('b1', 'u1')).rejects.toMatchObject({
      status: 403,
      code: 'not_in_workspace',
    });
  });

  it('lets Selected brands reach only the brands granted, and the demo brand', async () => {
    state.profile.brand_scope = 'selected';
    state.grants = ['b2'];
    await expect(assertBrandAccess('b1', 'u1')).rejects.toMatchObject({
      message: NO_BRAND_ACCESS,
      status: 403,
      code: 'no_brand_access',
    });
    state.brand = { id: 'b2', organization_id: 'org-1', is_demo: false };
    await expect(assertBrandAccess('b2', 'u1')).resolves.toMatchObject({ brand: { id: 'b2' } });
    state.brand = { id: 'demo', organization_id: 'org-1', is_demo: true };
    await expect(assertBrandAccess('demo', 'u1')).resolves.toMatchObject({ brand: { id: 'demo' } });
    // Another organization's brand, granted or not, is still not in the workspace.
    state.brand = { id: 'b2', organization_id: 'org-2', is_demo: false };
    await expect(assertBrandAccess('b2', 'u1')).rejects.toMatchObject({
      code: 'not_in_workspace',
    });
    // The grants read is kept to the person's own organization.
    expect(state.filters).toContainEqual(['member_brands', 'organization_id', 'org-1']);
    expect(state.filters).toContainEqual(['member_brands', 'user_id', 'u1']);
  });

  it('fails, not refuses, when the grants cannot be read, and keeps no failed read', async () => {
    state.profile.brand_scope = 'selected';
    state.grants = ['b1'];
    state.grantsError = { message: 'connection reset' };
    await inRequest(async () => {
      await expect(assertBrandAccess('b1', 'u1')).rejects.toThrow('connection reset');
      state.grantsError = null;
      await expect(assertBrandAccess('b1', 'u1')).resolves.toMatchObject({ brand: { id: 'b1' } });
    });
    expect(grantReads()).toBe(2);
  });

  it('lets an Admin reach every brand of the organization, whatever the scope says', async () => {
    state.profile = { organization_id: 'org-1', role: 'admin', brand_scope: 'selected' };
    await expect(assertBrandAccess('b1', 'u1')).resolves.toMatchObject({ role: 'admin' });
    expect(state.reads.some(([table]) => table === 'member_brands')).toBe(false);
  });

  it('returns the brand’s other columns when asked', async () => {
    await assertBrandAccess('b1', 'u1', { columns: 'name, is_active' });
    expect(state.reads).toContainEqual(['brands', 'id, organization_id, is_demo, name, is_active']);
  });

  it('fails, not refuses, when the caller cannot be read', async () => {
    state.profileError = { message: 'connection reset' };
    await expect(assertBrandAccess('b1', 'u1')).rejects.toThrow('connection reset');
  });

  it('reads the caller once a request, and again in the next', async () => {
    await inRequest(async () => {
      await assertBrandAccess('b1', 'u1');
      await assertBrandAccess('b1', 'u1');
      await assertAllBrands('u1');
    });
    expect(profileReads()).toBe(1);
    await inRequest(() => assertBrandAccess('b1', 'u1'));
    expect(profileReads()).toBe(2);
    // Outside a request (a job, a socket), every check reads afresh.
    await assertBrandAccess('b1', 'u1');
    await assertBrandAccess('b1', 'u1');
    expect(profileReads()).toBe(4);
  });

  it('reads the caller once for checks running side by side, and each caller apart', async () => {
    await inRequest(async () => {
      await Promise.all([assertBrandAccess('b1', 'u1'), assertBrandAccess('b1', 'u1')]);
      expect(profileReads()).toBe(1);
      await Promise.all([assertBrandAccess('b1', 'u1'), assertBrandAccess('b1', 'u2')]);
    });
    expect(profileReads()).toBe(2);
    expect(state.filters.filter(([table]) => table === 'profiles').map(([, , id]) => id)).toEqual([
      'u1',
      'u2',
    ]);
  });

  it('counts everyone as All brands before 00388, and says so once, without who', async () => {
    state.noBrandScope = true;
    state.profile = { organization_id: 'org-1', role: 'manager', brand_scope: 'selected' };
    await expect(assertBrandAccess('b1', 'u1')).resolves.toMatchObject({ orgId: 'org-1' });
    await expect(assertAllBrands('u1')).resolves.toMatchObject({ role: 'manager' });
    expect(grantReads()).toBe(0);
    // Another organization's brand is still not in the workspace.
    state.brand.organization_id = 'org-2';
    await expect(assertBrandAccess('b1', 'u1')).rejects.toMatchObject({
      code: 'not_in_workspace',
    });
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0][0]).toEqual({ code: '42703', migration: '00388' });
    expect(JSON.stringify(logger.warn.mock.calls[0])).not.toContain('u1');
  });
});

describe('assertAllBrands', () => {
  it('lets All brands and Admins through, and refuses Selected brands', async () => {
    await expect(assertAllBrands('u1')).resolves.toMatchObject({ orgId: 'org-1' });
    state.profile.brand_scope = 'selected';
    await expect(assertAllBrands('u1')).rejects.toMatchObject({
      status: 403,
      code: 'no_brand_access',
    });
    state.profile.role = 'admin';
    await expect(assertAllBrands('u1')).resolves.toMatchObject({ role: 'admin' });
  });
});

describe('assertEveryBrand', () => {
  const brandRow = (id, extra = {}) => ({ id, organization_id: 'org-1', is_demo: false, ...extra });

  it('lets through who reaches every brand, and refuses Selected brands one not granted', async () => {
    state.brands = [brandRow('b1'), brandRow('b2'), brandRow('demo', { is_demo: true })];
    await expect(assertEveryBrand(['b1', 'b2', 'demo'], 'u1')).resolves.toMatchObject({
      orgId: 'org-1',
    });
    state.profile.brand_scope = 'selected';
    state.grants = ['b1', 'b2'];
    // The demo brand is everyone's.
    await expect(assertEveryBrand(['b1', 'b2', 'demo'], 'u1')).resolves.toMatchObject({
      role: 'manager',
    });
    state.grants = ['b1'];
    await expect(assertEveryBrand(['b1', 'b2'], 'u1')).rejects.toMatchObject({
      status: 403,
      code: 'no_brand_access',
    });
    // A brand that is gone counts for no one.
    await expect(assertEveryBrand(['b1', 'gone'], 'u1')).resolves.toBeTruthy();
  });

  it('refuses another organization’s brand, and fails on a failed read', async () => {
    state.brands = [brandRow('b1'), { ...brandRow('b2'), organization_id: 'org-2' }];
    await expect(assertEveryBrand(['b1', 'b2'], 'u1')).rejects.toMatchObject({
      code: 'not_in_workspace',
    });
    state.brandsError = { message: 'boom' };
    await expect(assertEveryBrand(['b1'], 'u1')).rejects.toThrow('boom');
  });
});

describe('assertOpportunitiesAccess and assertPromptAccess', () => {
  const brandRow = (id, org = 'org-1') => ({ id, organization_id: org, is_demo: false });

  it('lets opportunities of reachable brands through, and refuses one not granted', async () => {
    state.opps = [
      { id: 'o1', brand_id: 'b1' },
      { id: 'o2', brand_id: 'b2' },
    ];
    state.brands = [brandRow('b1'), brandRow('b2')];
    await expect(assertOpportunitiesAccess(['o1', 'o2'], 'u1')).resolves.toHaveLength(2);
    state.profile.brand_scope = 'selected';
    state.grants = ['b1'];
    await expect(assertOpportunitiesAccess(['o1', 'o2'], 'u1')).rejects.toMatchObject({
      code: 'no_brand_access',
    });
    // Another organization's comes first.
    state.brands = [brandRow('b1', 'org-2'), brandRow('b2')];
    await expect(assertOpportunitiesAccess(['o1', 'o2'], 'u1')).rejects.toMatchObject({
      code: 'not_in_workspace',
    });
  });

  it('lets Selected brands reach the demo brand’s opportunities and prompts', async () => {
    state.profile.brand_scope = 'selected';
    state.grants = [];
    state.opps = [{ id: 'o1', brand_id: 'demo' }];
    state.brands = [{ id: 'demo', organization_id: 'org-1', is_demo: true }];
    await expect(assertOpportunitiesAccess(['o1'], 'u1')).resolves.toHaveLength(1);
    state.prompts = [
      {
        id: 'p1',
        prompt_sets: { brand_id: 'demo', brands: { organization_id: 'org-1', is_demo: true } },
      },
    ];
    await expect(assertPromptAccess('p1', 'u1')).resolves.toHaveLength(1);
  });

  it('lets prompts of reachable brands through, and refuses one not granted', async () => {
    const prompt = (id, brandId, org = 'org-1') => ({
      id,
      prompt_sets: { brand_id: brandId, brands: { organization_id: org, is_demo: false } },
    });
    state.prompts = [prompt('p1', 'b1'), prompt('p2', 'b2')];
    await expect(assertPromptAccess(['p1', 'p2'], 'u1')).resolves.toHaveLength(2);
    state.profile.brand_scope = 'selected';
    state.grants = ['b1', 'b2'];
    await expect(assertPromptAccess(['p1', 'p2'], 'u1')).resolves.toHaveLength(2);
    state.grants = ['b1'];
    await expect(assertPromptAccess(['p1', 'p2'], 'u1')).rejects.toMatchObject({
      code: 'no_brand_access',
    });
    state.prompts = [prompt('p1', 'b1', 'org-2')];
    await expect(assertPromptAccess('p1', 'u1')).rejects.toMatchObject({
      code: 'not_in_workspace',
    });
  });
});

describe('assertRole', () => {
  it('lets a role on the list through, and says which it is', async () => {
    await expect(assertRole('u1', MANAGER_ROLES, 'No.')).resolves.toBe('manager');
  });

  it('refuses any other role with the message, as a 403', async () => {
    state.profile = { role: 'analyst' };
    await expect(
      assertRole('u1', MANAGER_ROLES, 'Only admins and managers can delete opportunities.'),
    ).rejects.toMatchObject({
      message: 'Only admins and managers can delete opportunities.',
      status: 403,
      code: 'forbidden',
    });
  });

  it('refuses a caller without a profile', async () => {
    state.profile = null;
    await expect(assertRole('u1', MANAGER_ROLES, 'No.')).rejects.toMatchObject({ status: 403 });
  });

  it('fails, not refuses, when the profile cannot be read', async () => {
    state.profileError = { message: 'connection reset' };
    await expect(assertRole('u1', MANAGER_ROLES, 'No.')).rejects.toThrow('connection reset');
  });
});

describe('brandReaders', () => {
  const brand = (id, more = {}) => ({ id, organization_id: 'org-1', is_demo: false, ...more });
  const member = (id, role, brand_scope, organization_id = 'org-1') => ({
    id,
    role,
    brand_scope,
    organization_id,
  });
  const grant = (user_id, brand_id, organization_id = 'org-1') => ({
    user_id,
    brand_id,
    organization_id,
  });
  const listed = (readers) =>
    Object.fromEntries([...readers].map(([id, seen]) => [id, [...seen].sort()]));

  beforeEach(() => {
    state.brands = [brand('b1'), brand('b2'), brand('demo', { is_demo: true })];
    state.members = [
      member('all', 'manager', 'all'),
      member('admin', 'admin', 'selected'),
      member('narrow', 'analyst', 'selected'),
      member('none', 'analyst', 'selected'),
      // Another organization's person, and grants: never read as this one's.
      member('stranger', 'manager', 'all', 'org-2'),
    ];
    state.memberGrants = [grant('narrow', 'b2'), grant('none', 'b1', 'org-2')];
  });

  it('gives each person the brands they may reach, as one person’s check does', async () => {
    expect(listed(await brandReaders('org-1', ['b1', 'b2', 'demo']))).toEqual({
      all: ['b1', 'b2', 'demo'],
      admin: ['b1', 'b2', 'demo'],
      // A grant, and the demo brand everyone sees.
      narrow: ['b2', 'demo'],
      none: ['demo'],
    });
    // Grants are read within the organization, for its brands.
    expect(state.filters).toContainEqual(['member_brands', 'organization_id', 'org-1']);
    expect(state.filters).toContainEqual(['member_brands', 'brand_id', ['b1', 'b2', 'demo']]);
  });

  it('leaves out the people who reach none, and another organization’s brand for all', async () => {
    state.brands = [brand('b1'), brand('other', { organization_id: 'org-2' })];
    expect(listed(await brandReaders('org-1', ['b1', 'other']))).toEqual({
      all: ['b1'],
      admin: ['b1'],
    });
  });

  it('reads no grants when none of the brands is the organization’s', async () => {
    state.brands = [brand('other', { organization_id: 'org-2' })];
    expect((await brandReaders('org-1', ['other'])).size).toBe(0);
    expect(grantReads()).toBe(0);
  });

  it('reads every grant, past PostgREST’s 1000 rows', async () => {
    state.members = Array.from({ length: 1001 }, (_, i) => member(`p${i}`, 'analyst', 'selected'));
    state.memberGrants = state.members.map((m) => grant(m.id, 'b2'));
    const readers = await brandReaders('org-1', ['b1', 'b2']);
    expect(readers.size).toBe(1001);
    expect([...readers.get('p1000')]).toEqual(['b2']);
    expect(grantReads()).toBe(2);
  });

  it('fails on a failed read: brands, people or grants', async () => {
    state.brandsError = { message: 'brands down' };
    await expect(brandReaders('org-1', ['b1'])).rejects.toThrow('brands down');
    state.brandsError = null;
    state.membersError = { code: '57014', message: 'profiles down' };
    await expect(brandReaders('org-1', ['b1'])).rejects.toThrow('profiles down');
    state.membersError = null;
    state.memberGrantsError = { message: 'grants down' };
    await expect(brandReaders('org-1', ['b1'])).rejects.toThrow('grants down');
  });

  it('reads nobody without an organization or brands', async () => {
    expect((await brandReaders(null, ['b1'])).size).toBe(0);
    expect((await brandReaders('org-1', [])).size).toBe(0);
    expect(state.reads).toEqual([]);
  });

  it('counts everyone as All brands before 00388', async () => {
    state.noBrandScope = true;
    state.brands = [brand('b1')];
    expect(listed(await brandReaders('org-1', ['b1']))).toEqual({
      all: ['b1'],
      admin: ['b1'],
      narrow: ['b1'],
      none: ['b1'],
    });
    expect(state.reads.some(([table]) => table === 'member_brands')).toBe(false);
  });
});

describe('brandOutsiders', () => {
  beforeEach(() => {
    state.brands = [{ id: 'b1', organization_id: 'org-1', is_demo: false }];
    state.members = [
      { id: 'all', role: 'manager', brand_scope: 'all', organization_id: 'org-1' },
      { id: 'narrow', role: 'analyst', brand_scope: 'selected', organization_id: 'org-1' },
      { id: 'granted', role: 'analyst', brand_scope: 'selected', organization_id: 'org-1' },
    ];
    state.memberGrants = [{ user_id: 'granted', brand_id: 'b1', organization_id: 'org-1' }];
  });

  it('names the people who may not reach the brand', async () => {
    expect(await brandOutsiders('org-1', 'b1')).toEqual(['narrow']);
  });

  it('reads every person, past PostgREST’s 1000 rows', async () => {
    state.members = [
      ...Array.from({ length: 1000 }, (_, i) => ({
        id: `p${String(i).padStart(4, '0')}`,
        role: 'analyst',
        brand_scope: 'all',
        organization_id: 'org-1',
      })),
      { id: 'zz-narrow', role: 'analyst', brand_scope: 'selected', organization_id: 'org-1' },
    ];
    expect(await brandOutsiders('org-1', 'b1')).toEqual(['zz-narrow']);
    expect(profileReads()).toBe(2);
  });

  it('names none while everyone has All brands', async () => {
    state.members = state.members.map((m) => ({ ...m, brand_scope: 'all' }));
    expect(await brandOutsiders('org-1', 'b1')).toEqual([]);
    expect(grantReads()).toBe(0);
  });
});
