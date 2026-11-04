import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Settings › Content (CE-051): a brand's Content settings, read and written.
 * RLS decides who may change a brand; no row back is a refusal.
 */

const ME = '11111111-1111-4111-8111-111111111111';
const ORG = '22222222-2222-4222-8222-222222222222';
const ACME = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

interface Call {
  table: string;
  op: string;
  row?: unknown;
  filters: [string, unknown][];
  columns?: string;
}
let calls: Call[] = [];
/** A column the database doesn't have yet (the web ahead of its migration). */
let missingColumn: string | null = null;
/** What a write or read of each table answers. */
let answers: Record<
  string,
  { data: unknown; count?: number; error: null | { message: string; code?: string } }
> = {};

function builder(table: string) {
  const call: Call = { table, op: 'select', filters: [] };
  calls.push(call);
  // As PostgREST answers a column it doesn't know: 42703 on a read, PGRST204 on a write.
  const unknown = () =>
    missingColumn !== null &&
    (call.op === 'select'
      ? (call.columns ?? '').includes(missingColumn)
      : JSON.stringify(call.row ?? {}).includes(missingColumn));
  const answer = () =>
    unknown()
      ? {
          data: null,
          error: {
            code: call.op === 'select' ? '42703' : 'PGRST204',
            message: `column brands.${missingColumn} does not exist`,
          },
        }
      : (answers[`${table}.${call.op}`] ?? { data: null, error: null });
  const chain = {
    select: (columns?: string) => {
      if (call.op === 'select') call.columns = columns;
      return chain;
    },
    insert: (row: unknown) => Object.assign(call, { op: 'insert', row }) && chain,
    update: (row: unknown) => Object.assign(call, { op: 'update', row }) && chain,
    upsert: (row: unknown) => Object.assign(call, { op: 'upsert', row }) && chain,
    delete: () => Object.assign(call, { op: 'delete' }) && chain,
    eq: (column: string, value: unknown) => {
      call.filters.push([column, value]);
      return chain;
    },
    is: (column: string, value: unknown) => {
      call.filters.push([`is ${column}`, value]);
      return chain;
    },
    order: () => chain,
    single: async () => answer(),
    maybeSingle: async () => answer(),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(answer()).then(resolve),
  };
  return chain;
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: async () => ({ data: { user: { id: ME } } }) },
    from: builder,
  })),
}));

const {
  getBrandRules,
  getContentSettings,
  setBrandQualityHandoff,
  setBrandRules,
  setBrandTrustedSources,
} = await import('./contentSettings');

const writes = () => calls.filter((c) => c.op !== 'select');

beforeEach(() => {
  calls = [];
  missingColumn = null;
  answers = {
    'profiles.select': { data: { organization_id: ORG, role: 'manager' }, error: null },
    'brands.select': {
      data: [{ id: ACME, name: 'Acme', content_quality_handoff: true }],
      error: null,
    },
  };
});

describe('getContentSettings', () => {
  it("reads the organization's brands with their hand-off, and whether the member may change it", async () => {
    await expect(getContentSettings()).resolves.toEqual({
      brands: [
        { id: ACME, name: 'Acme', qualityHandoff: true, trustedSources: [], brandRules: [] },
      ],
      canManage: true,
      trustedSourcesOn: true,
      brandRulesOn: true,
    });
    expect(calls.find((c) => c.table === 'brands')!.filters).toEqual([['organization_id', ORG]]);
    answers['profiles.select'] = { data: { organization_id: ORG, role: 'analyst' }, error: null };
    await expect(getContentSettings()).resolves.toMatchObject({ canManage: false });
    answers['profiles.select'] = { data: null, error: null };
    await expect(getContentSettings()).resolves.toBeNull();
  });
});

describe('setBrandQualityHandoff', () => {
  it("turns a brand's hand-off on or off, and fails when RLS lets no row through", async () => {
    answers['brands.update'] = { data: [{ id: ACME }], error: null };
    await setBrandQualityHandoff(ACME, true);
    expect(writes()).toEqual([
      {
        table: 'brands',
        op: 'update',
        row: { content_quality_handoff: true },
        filters: [['id', ACME]],
      },
    ]);
    answers['brands.update'] = { data: [], error: null };
    await expect(setBrandQualityHandoff(ACME, false)).rejects.toThrow('forbidden');
    await expect(setBrandQualityHandoff('acme', true)).rejects.toThrow('invalid');
  });
});

describe('trusted sources (00449)', () => {
  it('reads each brand’s, and none before 00449, with Trusted sources off', async () => {
    answers['brands.select'] = {
      data: [
        { id: ACME, name: 'Acme', content_quality_handoff: false, trusted_sources: ['sca.coffee'] },
      ],
      error: null,
    };
    await expect(getContentSettings()).resolves.toMatchObject({
      brands: [{ trustedSources: ['sca.coffee'] }],
      trustedSourcesOn: true,
    });
    missingColumn = 'trusted_sources';
    await expect(getContentSettings()).resolves.toMatchObject({
      brands: [{ trustedSources: [] }],
      trustedSourcesOn: false,
    });
  });

  it('saves sites as sites, and says why not, never throwing', async () => {
    answers['brands.update'] = { data: [{ trusted_sources: ['sca.coffee'] }], error: null };
    await expect(setBrandTrustedSources(ACME, ['sca.coffee'])).resolves.toEqual({
      ok: true,
      sources: ['sca.coffee'],
    });
    expect(writes().at(-1)).toMatchObject({ row: { trusted_sources: ['sca.coffee'] } });
    // Saved as the card sends them: hosts, each once, at most 50.
    for (const bad of [
      ['https://sca.coffee/'],
      ['sca.coffee', 'sca.coffee'],
      Array(51).fill('a.org'),
    ]) {
      await expect(setBrandTrustedSources(ACME, bad)).resolves.toEqual({
        ok: false,
        reason: 'invalid',
      });
    }
    await expect(setBrandTrustedSources('acme', [])).resolves.toEqual({
      ok: false,
      reason: 'invalid',
    });
    // RLS lets no row through.
    answers['brands.update'] = { data: [], error: null };
    await expect(setBrandTrustedSources(ACME, [])).resolves.toEqual({
      ok: false,
      reason: 'failed',
    });
    // Before 00449.
    missingColumn = 'trusted_sources';
    await expect(setBrandTrustedSources(ACME, [])).resolves.toEqual({
      ok: false,
      reason: 'unavailable',
    });
  });
});

describe('brand rules (00450)', () => {
  it('reads each brand’s; before 00450 none, with trusted sources still read', async () => {
    answers['brands.select'] = {
      data: [
        {
          id: ACME,
          name: 'Acme',
          content_quality_handoff: false,
          trusted_sources: ['sca.coffee'],
          brand_rules: ['No topics comparing us with a named competitor.'],
        },
      ],
      error: null,
    };
    await expect(getContentSettings()).resolves.toMatchObject({
      brands: [{ brandRules: ['No topics comparing us with a named competitor.'] }],
      brandRulesOn: true,
    });
    missingColumn = 'brand_rules';
    await expect(getContentSettings()).resolves.toMatchObject({
      brands: [{ trustedSources: ['sca.coffee'], brandRules: [] }],
      trustedSourcesOn: true,
      brandRulesOn: false,
    });
  });

  it('saves rules as typed lines are saved, and says why not, never throwing', async () => {
    answers['brands.update'] = { data: [{ brand_rules: ['Cite official sources.'] }], error: null };
    await expect(setBrandRules(ACME, ['Cite official sources.'])).resolves.toEqual({
      ok: true,
      rules: ['Cite official sources.'],
    });
    expect(writes().at(-1)).toMatchObject({ row: { brand_rules: ['Cite official sources.'] } });
    for (const bad of [
      [' padded '],
      ['x'.repeat(301)],
      Array.from({ length: 31 }, (_, i) => `r${i}`),
    ]) {
      await expect(setBrandRules(ACME, bad)).resolves.toEqual({ ok: false, reason: 'invalid' });
    }
    answers['brands.update'] = { data: [], error: null };
    await expect(setBrandRules(ACME, [])).resolves.toEqual({ ok: false, reason: 'failed' });
    missingColumn = 'brand_rules';
    await expect(setBrandRules(ACME, [])).resolves.toEqual({ ok: false, reason: 'unavailable' });
  });
});

describe('getBrandRules (00450)', () => {
  it('reads a brand’s rules for the Rules tab, and none when they can’t be read', async () => {
    answers['brands.select'] = { data: { brand_rules: ['Cite official sources.'] }, error: null };
    await expect(getBrandRules(ACME)).resolves.toEqual(['Cite official sources.']);
    missingColumn = 'brand_rules';
    await expect(getBrandRules(ACME)).resolves.toEqual([]);
    await expect(getBrandRules('acme')).resolves.toEqual([]);
  });
});
