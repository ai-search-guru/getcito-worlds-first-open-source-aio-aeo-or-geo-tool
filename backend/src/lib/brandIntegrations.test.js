import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A brand's integrations (BRAND-ACCESS PR 14, 00470): the sign-in a brand
 * uses for a provider, from the Account's pool, with the Composio entity and
 * connected account a call names; before 00470 is applied, its Account's row
 * as before.
 */

const db = vi.hoisted(() => ({ answers: {}, reads: [] }));

vi.mock('../config/supabase.js', () => ({
  default: {
    from: (table) => {
      const read = { table, columns: null, filters: [] };
      db.reads.push(read);
      const answer = () => {
        const found = db.answers[table];
        return typeof found === 'function' ? found(read) : (found ?? { data: [], error: null });
      };
      const chain = {
        select: (columns) => ((read.columns = columns), chain),
        eq: (column, value) => (read.filters.push(['eq', column, value]), chain),
        in: (column, values) => (read.filters.push(['in', column, values]), chain),
        order: () => chain,
        range: (from, to) => (read.filters.push(['range', from, to]), chain),
        maybeSingle: async () => answer(),
        then: (resolve, reject) => Promise.resolve(answer()).then(resolve, reject),
      };
      return chain;
    },
  },
}));
const warn = vi.hoisted(() => vi.fn());
vi.mock('./logger.js', () => ({ logger: { info: vi.fn(), warn, error: vi.fn() } }));

const { brandConnection, composioTarget, connectedBrands, signInBrandIds } =
  await import('./brandIntegrations.js');

const ACCOUNT = {
  id: 'acct-1',
  organization_id: 'org-1',
  composio_entity_id: 'org_org-1',
  composio_account_id: 'ca_1',
  label: null,
  status: 'connected',
};
const NOT_MIGRATED = { data: null, error: { code: 'PGRST205', message: 'no such table' } };

const ok = (data) => ({ data, error: null });
const readsOf = (table) => db.reads.filter((read) => read.table === table);

beforeEach(() => {
  db.answers = {};
  db.reads = [];
});

describe('brandConnection', () => {
  it('answers the sign-in the brand uses, with the account a call names', async () => {
    db.answers.brand_integrations = ok({ brand_id: 'b1', provider: 'gsc', account: ACCOUNT });

    expect(await brandConnection('b1', 'gsc')).toEqual({
      brandId: 'b1',
      provider: 'gsc',
      accountId: 'acct-1',
      organizationId: 'org-1',
      entityId: 'org_org-1',
      composioAccountId: 'ca_1',
      label: null,
      status: 'connected',
      connected: true,
    });
    const [read] = readsOf('brand_integrations');
    // The sign-in by its foreign key's name (embed-hints).
    expect(read.columns).toMatch(/integration_accounts!brand_integrations_account_id_fkey\(/);
    expect(read.filters).toEqual([
      ['eq', 'brand_id', 'b1'],
      ['eq', 'provider', 'gsc'],
    ]);
  });

  it('says whether the sign-in is live, and answers none for a brand that uses none', async () => {
    db.answers.brand_integrations = ok({
      brand_id: 'b1',
      provider: 'gsc',
      account: { ...ACCOUNT, status: 'disconnected', composio_account_id: null },
    });
    expect(await brandConnection('b1', 'gsc')).toMatchObject({
      connected: false,
      status: 'disconnected',
      composioAccountId: null,
    });

    db.answers.brand_integrations = ok(null);
    expect(await brandConnection('b1', 'gsc')).toBeNull();
  });

  it('throws on a failed read: no connection is decided on missing facts', async () => {
    db.answers.brand_integrations = { data: null, error: { code: '57014', message: 'timeout' } };
    await expect(brandConnection('b1', 'gsc')).rejects.toThrow('timeout');
  });

  it("reads the brand's Account's row before 00470 is applied, and says so once", async () => {
    db.answers.brand_integrations = NOT_MIGRATED;
    db.answers.brands = ok({ organization_id: 'org-1' });
    db.answers.integration_connections = ok({
      organization_id: 'org-1',
      composio_entity_id: 'org_org-1',
      composio_account_id: 'ca_1',
      status: 'connected',
    });

    expect(await brandConnection('b1', 'gsc')).toMatchObject({
      brandId: 'b1',
      accountId: null,
      entityId: 'org_org-1',
      composioAccountId: 'ca_1',
      connected: true,
    });
    expect(readsOf('integration_connections')[0].filters).toEqual([
      ['eq', 'organization_id', 'org-1'],
      ['eq', 'provider', 'gsc'],
    ]);
    await brandConnection('b1', 'gsc');
    expect(warn).toHaveBeenCalledTimes(1);

    db.answers.integration_connections = ok(null);
    expect(await brandConnection('b1', 'gsc')).toBeNull();
  });
});

describe('connectedBrands', () => {
  it('lists every brand whose sign-in is live, each with it', async () => {
    db.answers.integration_accounts = ok([
      ACCOUNT,
      { ...ACCOUNT, id: 'acct-2', organization_id: 'org-2', composio_account_id: 'ca_2' },
    ]);
    db.answers.brand_integrations = ok([
      { brand_id: 'b1', account_id: 'acct-1' },
      { brand_id: 'b2', account_id: 'acct-1' },
      { brand_id: 'b3', account_id: 'acct-2' },
    ]);

    const found = await connectedBrands('gsc');
    expect(found.map((c) => [c.brandId, c.organizationId, c.composioAccountId])).toEqual([
      ['b1', 'org-1', 'ca_1'],
      ['b2', 'org-1', 'ca_1'],
      ['b3', 'org-2', 'ca_2'],
    ]);
    const [accounts] = readsOf('integration_accounts');
    expect(accounts.filters).toContainEqual(['eq', 'provider', 'gsc']);
    expect(accounts.filters).toContainEqual(['eq', 'status', 'connected']);
    const [uses] = readsOf('brand_integrations');
    expect(uses.filters).toContainEqual(['eq', 'provider', 'gsc']);
    expect(uses.filters).toContainEqual(['in', 'account_id', ['acct-1', 'acct-2']]);
  });

  it("reads one organization's sign-ins for the manual sync", async () => {
    db.answers.integration_accounts = ok([ACCOUNT]);
    db.answers.brand_integrations = ok([{ brand_id: 'b1', account_id: 'acct-1' }]);
    await connectedBrands('gsc', { organizationId: 'org-1' });
    expect(readsOf('integration_accounts')[0].filters).toContainEqual([
      'eq',
      'organization_id',
      'org-1',
    ]);
  });

  it('reads page by page, past PostgREST’s 1000 rows', async () => {
    const page = Array.from({ length: 1000 }, (_, i) => ({
      brand_id: `b${i}`,
      account_id: 'acct-1',
    }));
    db.answers.integration_accounts = ok([ACCOUNT]);
    db.answers.brand_integrations = (read) =>
      ok(read.filters.some(([op, from]) => op === 'range' && from === 0) ? page : [page[0]]);
    expect(await connectedBrands('gsc')).toHaveLength(1001);
  });

  it('reads no brand when no sign-in is live', async () => {
    db.answers.integration_accounts = ok([]);
    expect(await connectedBrands('gsc')).toEqual([]);
    expect(readsOf('brand_integrations')).toEqual([]);
  });

  it('answers the one brand asked for only when its sign-in is live, in the organization', async () => {
    db.answers.brand_integrations = ok({ brand_id: 'b1', provider: 'gsc', account: ACCOUNT });
    expect((await connectedBrands('gsc', { brandId: 'b1' })).map((c) => c.brandId)).toEqual(['b1']);
    expect(await connectedBrands('gsc', { brandId: 'b1', organizationId: 'org-2' })).toEqual([]);

    db.answers.brand_integrations = ok({
      brand_id: 'b1',
      provider: 'gsc',
      account: { ...ACCOUNT, status: 'pending' },
    });
    expect(await connectedBrands('gsc', { brandId: 'b1' })).toEqual([]);
  });

  it('lists every brand of an Account whose row is connected before 00470 is applied', async () => {
    db.answers.integration_accounts = NOT_MIGRATED;
    db.answers.integration_connections = ok([
      {
        organization_id: 'org-1',
        composio_entity_id: 'org_org-1',
        composio_account_id: 'ca_1',
        status: 'connected',
      },
    ]);
    db.answers.brands = ok([
      { id: 'b1', organization_id: 'org-1' },
      { id: 'b2', organization_id: 'org-1' },
    ]);

    const found = await connectedBrands('gsc');
    expect(found.map((c) => [c.brandId, c.entityId, c.composioAccountId])).toEqual([
      ['b1', 'org_org-1', 'ca_1'],
      ['b2', 'org_org-1', 'ca_1'],
    ]);
    expect(readsOf('integration_connections')[0].filters).toEqual([
      ['eq', 'provider', 'gsc'],
      ['eq', 'status', 'connected'],
    ]);
    expect(readsOf('brands')[0].filters).toEqual([['in', 'organization_id', ['org-1']]]);
  });

  it('throws on a failed read', async () => {
    db.answers.integration_accounts = { data: null, error: { code: '57014', message: 'timeout' } };
    await expect(connectedBrands('gsc')).rejects.toThrow('timeout');
  });
});

describe('composioTarget', () => {
  it('names the entity and the connected account a call runs on', () => {
    expect(composioTarget({ entityId: 'org_org-1', composioAccountId: 'ca_1' })).toEqual({
      entityId: 'org_org-1',
      accountId: 'ca_1',
    });
  });
});

describe('signInBrandIds', () => {
  it('answers every brand that uses the sign-in, its own among them', async () => {
    db.answers.brand_integrations = ok([{ brand_id: 'b1' }, { brand_id: 'b2' }]);
    expect(await signInBrandIds({ brandId: 'b1', accountId: 'acct-1' })).toEqual(['b1', 'b2']);
    expect(readsOf('brand_integrations')[0].filters).toContainEqual(['eq', 'account_id', 'acct-1']);
  });

  it("answers null before 00470, when the connection is the Account's row", async () => {
    expect(await signInBrandIds({ brandId: 'b1', accountId: null })).toBeNull();
    expect(readsOf('brand_integrations')).toHaveLength(0);
  });

  it('fails on a failed read', async () => {
    db.answers.brand_integrations = { data: null, error: { code: 'XX000', message: 'boom' } };
    await expect(signInBrandIds({ brandId: 'b1', accountId: 'acct-1' })).rejects.toThrow('boom');
  });
});
