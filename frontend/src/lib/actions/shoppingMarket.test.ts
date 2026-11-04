import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * #1278 — the brand's countries come from its domains and from every prompt's
 * location codes, read past PostgREST's 1,000-row cap.
 */

const PAGE_CAP = 1000;

let domains: Array<{ country: string | null }> = [];
let prompts: Array<{ id: string; regions: string[] | null }> = [];
let promptRanges: Array<[number, number]> = [];

function fakeQueryBuilder(table: string) {
  let range: [number, number] = [0, PAGE_CAP - 1];
  const builder = {
    select: () => builder,
    eq: () => builder,
    order: () => builder,
    range: (from: number, to: number) => {
      range = [from, to];
      if (table === 'prompts') promptRanges.push(range);
      return builder;
    },
    then: (onFulfilled: (v: unknown) => unknown) => {
      const data =
        table === 'brand_domains'
          ? domains
          : prompts.slice(range[0], Math.min(range[1] + 1, range[0] + PAGE_CAP));
      return Promise.resolve({ data, error: null }).then(onFulfilled);
    },
  };
  return builder;
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ from: (table: string) => fakeQueryBuilder(table) }),
}));

import { getBrandMarketCountries } from './shoppingMarket';

beforeEach(() => {
  domains = [];
  prompts = [];
  promptRanges = [];
});

describe('getBrandMarketCountries', () => {
  it("joins the domains' countries and the prompts' locations, deduped", async () => {
    domains = [{ country: 'US' }, { country: null }, { country: ' de ' }, { country: '' }];
    prompts = [
      { id: 'p1', regions: ['US', 'US-CA'] },
      { id: 'p2', regions: ['GB'] },
      { id: 'p3', regions: null },
      { id: 'p4', regions: [] },
    ];

    expect(await getBrandMarketCountries('brand-1')).toEqual(['GB', 'US', 'US-CA', 'de']);
  });

  it('reads every prompt past the 1,000-row cap', async () => {
    prompts = Array.from({ length: 2100 }, (_, i) => ({
      id: `p${i}`,
      regions: i === 2099 ? ['FR'] : ['US'],
    }));

    expect(await getBrandMarketCountries('brand-1')).toEqual(['FR', 'US']);
    expect(promptRanges).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });
});
