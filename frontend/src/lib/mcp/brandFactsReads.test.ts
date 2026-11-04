// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpAuthContext } from '@/lib/mcpAuth';

/**
 * Chat's read of a brand's facts (CE-047): the approved ones still on the
 * site, for a brand of the caller's organization and brand access, as the
 * page's words with their kind, value, approval date and page; nothing a
 * person hasn't approved, and no id, slot or reviewer.
 */

const ORG = 'org-1';
const BRAND = 'brand-1';

const db = vi.hoisted(() => ({
  queries: [] as { table: string; calls: [string, ...unknown[]][] }[],
  rows: [] as unknown[] | null,
  error: null as { message: string } | null,
}));

function from(table: string) {
  const query = { table, calls: [] as [string, ...unknown[]][] };
  db.queries.push(query);
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'is', 'order']) {
    chain[method] = (...args: unknown[]) => {
      query.calls.push([method, ...args]);
      return chain;
    };
  }
  chain.then = (resolve: (value: unknown) => unknown) =>
    Promise.resolve({ data: db.rows, error: db.error }).then(resolve);
  return chain;
}

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: { from } }));
const brandAllowed = vi.hoisted(() => vi.fn());
vi.mock('./data', () => ({ brandAllowed }));

const { getBrandFactsFor } = await import('./brandFactsReads');

const auth: McpAuthContext = {
  userId: 'u1',
  email: null,
  organizationId: ORG,
  role: 'analyst',
  apiKeyId: 'agent-internal',
};

const price = {
  kind: 'price',
  value: {
    plan: 'Pro',
    amount: 49,
    currency: 'USD',
    period: 'month',
    billed: 'annually',
    per: null,
  },
  quote: 'Pro is $49 a month, billed annually',
  source_url: 'https://acme.example/pricing',
  reviewed_at: '2026-10-20T09:00:00Z',
  last_seen_at: '2026-11-02T06:00:00Z',
  brands: { organization_id: ORG },
};
const claim = {
  kind: 'claim',
  value: {},
  quote: 'Rated #1 by G2 in 2026',
  source_url: 'https://acme.example/about',
  reviewed_at: '2026-10-21T09:00:00Z',
  last_seen_at: '2026-11-03T06:00:00Z',
  brands: { organization_id: ORG },
};

beforeEach(() => {
  db.queries = [];
  db.rows = [];
  db.error = null;
  brandAllowed.mockReset();
  brandAllowed.mockResolvedValue(true);
});

describe('getBrandFactsFor', () => {
  it("reads nothing for a brand outside the person's organization or brand access", async () => {
    brandAllowed.mockResolvedValue(false);
    expect(await getBrandFactsFor(auth, { brandId: 'other' })).toBeNull();
    expect(brandAllowed).toHaveBeenCalledWith(auth, 'other');
    expect(db.queries).toEqual([]);
  });

  it('reads only the approved facts still on the site, of this brand in this organization', async () => {
    await getBrandFactsFor(auth, { brandId: BRAND });
    expect(db.queries).toHaveLength(1);
    const [{ table, calls }] = db.queries;
    expect(table).toBe('brand_facts');
    const filters = calls.filter(([method]) => method === 'eq' || method === 'is');
    expect(filters).toEqual([
      ['eq', 'brand_id', BRAND],
      ['eq', 'brands.organization_id', ORG],
      ['eq', 'status', 'approved'],
      ['is', 'gone_at', null],
    ]);
    const [, columns] = calls.find(([method]) => method === 'select')!;
    // Nothing internal: no id, slot, reviewer or status.
    expect((columns as string).split(',').map((column) => column.trim())).toEqual([
      'kind',
      'value',
      'quote',
      'source_url',
      'reviewed_at',
      'last_seen_at',
      'brands!inner(organization_id)',
    ]);
  });

  it("gives each fact as the page's words, with its value, approval date and page", async () => {
    db.rows = [price, claim];
    expect(await getBrandFactsFor(auth, { brandId: BRAND })).toEqual({
      facts: [
        {
          kind: 'price',
          text: 'Pro is $49 a month, billed annually',
          value: price.value,
          approved_at: '2026-10-20T09:00:00Z',
          source_url: 'https://acme.example/pricing',
        },
        // A claim is its words alone.
        {
          kind: 'claim',
          text: 'Rated #1 by G2 in 2026',
          approved_at: '2026-10-21T09:00:00Z',
          source_url: 'https://acme.example/about',
        },
      ],
      // The last time the site was read and still said them.
      data_as_of: '2026-11-03T06:00:00Z',
    });
  });

  it('says so when the brand has no approved facts yet', async () => {
    db.rows = null;
    expect(await getBrandFactsFor(auth, { brandId: BRAND })).toEqual({
      facts: [],
      data_as_of: null,
    });
  });

  it('fails a read the database refuses, instead of answering no facts', async () => {
    db.error = { message: 'permission denied' };
    await expect(getBrandFactsFor(auth, { brandId: BRAND })).rejects.toThrow('permission denied');
  });
});
