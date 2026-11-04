import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

/**
 * The connected Google account's properties, picks and syncs (BRAND-ACCESS
 * spec §5.2, PR 14): a brand's list is read from the Google sign-in that
 * brand uses, for anyone who can access every brand that uses it (it lists
 * all of theirs); the Account's own list serves every brand, so it needs All
 * brands. A sync of one brand needs the same, of every brand All brands. A
 * pick is saved only when that sign-in lists it. Everyone has All brands
 * until someone is narrowed, and every brand uses the Account's connection,
 * so nothing changes for them.
 */

const BRAND = '22222222-2222-2222-2222-222222222222';
const OTHER = '33333333-3333-3333-3333-333333333333';

const brandAccess = vi.fn();
const allBrands = vi.fn();
const everyBrand = vi.fn();
const brandConnection = vi.fn();
const signInBrandIds = vi.fn();
const brandUpdates = [];
const getActiveConnection = vi.fn();
const listGscSites = vi.fn(async () => [{ siteUrl: 'https://acme.example/' }]);
const listGaProperties = vi.fn(async () => [{ propertyId: '123', displayName: 'Acme' }]);
const runGscSync = vi.fn(async () => ({ synced: 1 }));
const runGaSync = vi.fn(async () => ({ synced: 1 }));

vi.mock('../config/supabase.js', () => ({
  default: {
    from: () => {
      const chain = {
        select: () => chain,
        update: (fields) => (brandUpdates.push(fields), chain),
        eq: () => chain,
        single: async () => ({ data: { organization_id: 'org-1', role }, error: null }),
        then: (resolve) => resolve({ error: null }),
      };
      return chain;
    },
  },
}));
vi.mock('../lib/composio.js', () => ({
  PROVIDERS: {},
  entityIdFor: (orgId) => `org_${orgId}`,
  isKnownProvider: () => true,
  isComposioConfigured: () => true,
  initiateConnection: vi.fn(),
  getActiveConnection: (...args) => getActiveConnection(...args),
  deleteConnection: vi.fn(),
  listGscSites: (...args) => listGscSites(...args),
  listGaProperties: (...args) => listGaProperties(...args),
}));
vi.mock('../lib/brandIntegrations.js', () => ({
  brandConnection: (...args) => brandConnection(...args),
  composioTarget: (c) => ({ entityId: c.entityId, accountId: c.composioAccountId }),
  signInBrandIds: (...args) => signInBrandIds(...args),
}));
vi.mock('../lib/gaSync.js', () => ({ runGaSync: (...args) => runGaSync(...args) }));
vi.mock('../lib/gscSync.js', () => ({ runGscSync: (...args) => runGscSync(...args) }));
vi.mock('../lib/pageOpportunities.js', () => ({ detectPageOpportunitiesInWindow: vi.fn() }));
vi.mock('../lib/access.js', () => ({
  assertBrandAccess: (...args) => brandAccess(...args),
  assertAllBrands: (...args) => allBrands(...args),
  assertEveryBrand: (...args) => everyBrand(...args),
}));

let server;
let baseUrl;
let role;

beforeAll(async () => {
  const { default: router } = await import('./integrations.js');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'u1' };
    req.log = { error: vi.fn(), info: vi.fn() };
    next();
  });
  app.use('/api/integrations', router);
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/integrations`;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

beforeEach(() => {
  role = 'analyst';
  brandAccess.mockReset().mockImplementation(async () => ({
    brand: { id: BRAND, is_demo: false },
    orgId: 'org-1',
    role,
  }));
  brandConnection.mockReset().mockResolvedValue({
    brandId: BRAND,
    accountId: 'sign-in-1',
    entityId: 'org_org-1',
    composioAccountId: 'acct-1',
    connected: true,
  });
  getActiveConnection.mockReset().mockResolvedValue({ id: 'acct-1' });
  allBrands.mockReset().mockResolvedValue({ orgId: 'org-1' });
  // The Account's Google sign-in: every brand of it uses it.
  signInBrandIds.mockReset().mockResolvedValue([BRAND, OTHER]);
  everyBrand.mockReset().mockResolvedValue({ orgId: 'org-1' });
  brandUpdates.length = 0;
  listGscSites.mockClear();
  listGaProperties.mockClear();
  runGscSync.mockClear();
  runGaSync.mockClear();
});

const refused = Object.assign(new Error("You don't have access to this brand"), {
  status: 403,
  code: 'no_brand_access',
});

describe.each([
  ['google-search-console', () => listGscSites],
  ['google-analytics', () => listGaProperties],
])('GET /api/integrations/%s/properties', (provider, list) => {
  it("lists the Account's for someone with All brands, as before", async () => {
    const res = await fetch(`${baseUrl}/${provider}/properties`);
    expect(res.status).toBe(200);
    expect((await res.json()).properties).toHaveLength(1);
    expect(allBrands).toHaveBeenCalledWith('u1');
    expect(brandAccess).not.toHaveBeenCalled();
    expect(getActiveConnection).toHaveBeenCalledWith(provider, 'org_org-1');
    expect(list()).toHaveBeenCalledWith({ entityId: 'org_org-1', accountId: 'acct-1' });
  });

  it("refuses the Account's list to Selected brands, with the code, and reads nothing", async () => {
    allBrands.mockRejectedValue(refused);
    const res = await fetch(`${baseUrl}/${provider}/properties`);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "You don't have access to this brand",
      code: 'no_brand_access',
    });
    expect(list()).not.toHaveBeenCalled();
  });

  it('lists a brand’s from the sign-in it uses, for anyone who can access every brand on it', async () => {
    const res = await fetch(`${baseUrl}/${provider}/properties?brandId=${BRAND}`);
    expect(res.status).toBe(200);
    expect((await res.json()).properties).toHaveLength(1);
    expect(brandAccess).toHaveBeenCalledWith(BRAND, 'u1');
    expect(allBrands).not.toHaveBeenCalled();
    expect(brandConnection).toHaveBeenCalledWith(BRAND, provider);
    expect(signInBrandIds).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 'sign-in-1' }),
    );
    expect(everyBrand).toHaveBeenCalledWith([BRAND, OTHER], 'u1');
    // The brand's own connected account, by name: an entity may hold several.
    expect(getActiveConnection).toHaveBeenCalledWith(provider, 'org_org-1', 'acct-1');
    expect(list()).toHaveBeenCalledWith({ entityId: 'org_org-1', accountId: 'acct-1' });
  });

  it('refuses a brand the caller can’t access, with the code, and reads nothing', async () => {
    brandAccess.mockRejectedValue(refused);
    const res = await fetch(`${baseUrl}/${provider}/properties?brandId=${BRAND}`);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "You don't have access to this brand",
      code: 'no_brand_access',
    });
    expect(brandConnection).not.toHaveBeenCalled();
    expect(list()).not.toHaveBeenCalled();
  });

  it('refuses a sign-in shared with a brand the caller wasn’t given, and reads nothing', async () => {
    everyBrand.mockRejectedValue(refused);
    const res = await fetch(`${baseUrl}/${provider}/properties?brandId=${BRAND}`);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'no_brand_access' });
    expect(getActiveConnection).not.toHaveBeenCalled();
    expect(list()).not.toHaveBeenCalled();
  });

  it('needs All brands before 00470, when the sign-in is the Account’s row', async () => {
    signInBrandIds.mockResolvedValue(null);
    allBrands.mockRejectedValue(refused);
    const res = await fetch(`${baseUrl}/${provider}/properties?brandId=${BRAND}`);
    expect(res.status).toBe(403);
    expect(allBrands).toHaveBeenCalledWith('u1');
    expect(list()).not.toHaveBeenCalled();
  });

  it('lists nothing for the demo brand, everyone’s sample data', async () => {
    brandAccess.mockResolvedValue({ brand: { id: BRAND, is_demo: true }, orgId: 'org-1' });
    const res = await fetch(`${baseUrl}/${provider}/properties?brandId=${BRAND}`);
    expect(res.status).toBe(409);
    expect(brandConnection).not.toHaveBeenCalled();
    expect(list()).not.toHaveBeenCalled();
  });

  it('says not connected when the brand uses no live sign-in', async () => {
    for (const connection of [null, { connected: false, entityId: 'org_org-1' }]) {
      brandConnection.mockResolvedValueOnce(connection);
      const res = await fetch(`${baseUrl}/${provider}/properties?brandId=${BRAND}`);
      expect(res.status).toBe(409);
    }
    getActiveConnection.mockResolvedValueOnce(null);
    const gone = await fetch(`${baseUrl}/${provider}/properties?brandId=${BRAND}`);
    expect(gone.status).toBe(409);
    expect(list()).not.toHaveBeenCalled();
  });

  it('refuses a brand id that is no id', async () => {
    const res = await fetch(`${baseUrl}/${provider}/properties?brandId=nope`);
    expect(res.status).toBe(400);
    expect(brandAccess).not.toHaveBeenCalled();
  });
});

describe.each([
  ['google-search-console', () => runGscSync],
  ['google-analytics', () => runGaSync],
])('POST /api/integrations/%s/sync', (provider, run) => {
  const sync = (body) =>
    fetch(`${baseUrl}/${provider}/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  beforeEach(() => {
    role = 'manager';
  });

  it('syncs every brand for someone with All brands, as before', async () => {
    const res = await sync({});
    expect(res.status).toBe(200);
    expect(allBrands).toHaveBeenCalledWith('u1');
    expect(run()).toHaveBeenCalledWith({ organizationId: 'org-1' });
  });

  it('refuses Selected brands a sync of every brand, with the code, and runs nothing', async () => {
    allBrands.mockRejectedValueOnce(refused);
    const res = await sync({});
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'no_brand_access' });
    expect(run()).not.toHaveBeenCalled();
  });

  it('syncs one brand the caller reaches, and refuses one not granted', async () => {
    const res = await sync({ brandId: BRAND });
    expect(res.status).toBe(202);
    expect(brandAccess).toHaveBeenCalledWith(BRAND, 'u1');
    expect(allBrands).not.toHaveBeenCalled();
    expect(everyBrand).toHaveBeenCalledWith([BRAND, OTHER], 'u1');
    await vi.waitFor(() => expect(run()).toHaveBeenCalledWith({ brandId: BRAND }));

    run().mockClear();
    brandAccess.mockRejectedValueOnce(refused);
    const other = await sync({ brandId: BRAND });
    expect(other.status).toBe(403);
    expect(await other.json()).toMatchObject({ code: 'no_brand_access' });
    expect(run()).not.toHaveBeenCalled();
  });

  it('refuses a brand whose sign-in is shared with a brand the caller wasn’t given', async () => {
    everyBrand.mockRejectedValueOnce(refused);
    const res = await sync({ brandId: BRAND });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'no_brand_access' });
    expect(run()).not.toHaveBeenCalled();
  });
});

describe.each([
  [
    'google-search-console',
    'gsc_property',
    'https://acme.example/',
    () => listGscSites,
    () => runGscSync,
  ],
  ['google-analytics', 'ga_property_id', '123', () => listGaProperties, () => runGaSync],
])('PUT /api/integrations/%s/brands/:brandId/property', (provider, column, owned, list, run) => {
  const save = (property, brandId = BRAND) =>
    fetch(`${baseUrl}/${provider}/brands/${brandId}/property`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ property }),
    });

  beforeEach(() => {
    role = 'manager';
  });

  it('saves a property the brand’s sign-in lists, and starts the brand’s sync', async () => {
    const res = await save(owned);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ saved: true, syncStarted: true });
    expect(brandAccess).toHaveBeenCalledWith(BRAND, 'u1');
    expect(everyBrand).toHaveBeenCalledWith([BRAND, OTHER], 'u1');
    expect(list().mock.calls[0][0]).toEqual({ entityId: 'org_org-1', accountId: 'acct-1' });
    expect(brandUpdates).toEqual([{ [column]: owned }]);
    await vi.waitFor(() => expect(run()).toHaveBeenCalledWith({ brandId: BRAND }));
  });

  it('refuses a property the brand’s sign-in doesn’t list, and saves nothing', async () => {
    const res = await save('https://other-brand.example/');
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'unknown_property' });
    expect(brandUpdates).toEqual([]);
    expect(run()).not.toHaveBeenCalled();
  });

  it('refuses a pick through a sign-in shared with a brand the caller wasn’t given', async () => {
    everyBrand.mockRejectedValue(refused);
    const res = await save(owned);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'no_brand_access' });
    expect(list()).not.toHaveBeenCalled();
    expect(brandUpdates).toEqual([]);
  });

  it('refuses a brand the caller can’t access, analysts and the demo brand', async () => {
    brandAccess.mockRejectedValueOnce(refused);
    expect((await save(owned)).status).toBe(403);
    role = 'analyst';
    expect((await save(owned)).status).toBe(403);
    role = 'manager';
    brandAccess.mockResolvedValueOnce({ brand: { id: BRAND, is_demo: true }, role });
    expect((await save(owned)).status).toBe(403);
    expect(list()).not.toHaveBeenCalled();
    expect(brandUpdates).toEqual([]);
  });

  it('says not connected when the brand uses no live sign-in', async () => {
    brandConnection.mockResolvedValueOnce(null);
    expect((await save(owned)).status).toBe(409);
    expect(brandUpdates).toEqual([]);
  });

  it('clears a pick without reading the sign-in, and syncs nothing', async () => {
    const res = await save(null);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ saved: true, syncStarted: false });
    expect(list()).not.toHaveBeenCalled();
    expect(brandUpdates).toEqual([{ [column]: null }]);
    expect(run()).not.toHaveBeenCalled();
  });

  it('refuses a brand id that is no id, and a body without a property', async () => {
    expect((await save(owned, 'nope')).status).toBe(400);
    const res = await fetch(`${baseUrl}/${provider}/brands/${BRAND}/property`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    expect(brandAccess).not.toHaveBeenCalled();
  });
});
