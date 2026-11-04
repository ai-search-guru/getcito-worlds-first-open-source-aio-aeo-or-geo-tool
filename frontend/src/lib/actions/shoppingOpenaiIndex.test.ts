import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * #1281 — "Catalog in OpenAI's product index" reads the brand's direct-feed
 * word and its own products' US ChatGPT Shopping cards; admins and managers
 * change the word.
 */

const BRAND = '5b0c3b8e-8a5f-4a41-9d0e-1f2a3b4c5d6e';

let brandRow: { openai_product_feed: boolean } | null = null;
let updatedRows: Array<{ id: string }> = [];
let calls: Array<{ op: string; value?: unknown; filters: Array<[string, unknown]> }> = [];

function fakeQueryBuilder() {
  const call: { op: string; value?: unknown; filters: Array<[string, unknown]> } = {
    op: 'select',
    filters: [],
  };
  calls.push(call);
  const builder = {
    select: () => builder,
    update: (value: unknown) => {
      call.op = 'update';
      call.value = value;
      return builder;
    },
    eq: (column: string, value: unknown) => {
      call.filters.push([column, value]);
      return builder;
    },
    maybeSingle: async () => ({ data: brandRow, error: null }),
    then: (onFulfilled: (v: unknown) => unknown) =>
      Promise.resolve({ data: updatedRows, error: null }).then(onFulfilled),
  };
  return builder;
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ from: () => fakeQueryBuilder() }),
}));

const splitCalls: Array<{ brandId: string; filters: unknown }> = [];
vi.mock('./shopping', () => ({
  getShoppingMerchantSplit: async (brandId: string, filters: unknown) => {
    splitCalls.push({ brandId, filters });
    return { parts: [], classifiedCards: 3, unclassifiedCards: 2 };
  },
}));

const { getOpenAiIndexRead, setOpenAiProductFeed } = await import('./shoppingOpenaiIndex');

beforeEach(() => {
  brandRow = { openai_product_feed: false };
  updatedRows = [{ id: BRAND }];
  calls = [];
  splitCalls.length = 0;
});

describe('getOpenAiIndexRead', () => {
  it("reads the brand's word and counts its own US ChatGPT Shopping cards, classified or not", async () => {
    expect(await getOpenAiIndexRead(BRAND, '30d')).toEqual({ directFeed: false, ownCards: 5 });
    expect(calls[0].filters).toEqual([['id', BRAND]]);
    expect(splitCalls).toEqual([
      {
        brandId: BRAND,
        filters: { datePreset: '30d', platforms: ['chatgpt-shopping'], chatgptMarket: 'us' },
      },
    ]);
    brandRow = { openai_product_feed: true };
    expect((await getOpenAiIndexRead(BRAND, '7d')).directFeed).toBe(true);
  });

  it("refuses a bad id, and says so when the brand isn't the member's", async () => {
    await expect(getOpenAiIndexRead('b1', '30d')).rejects.toThrow('invalid');
    brandRow = null;
    await expect(getOpenAiIndexRead(BRAND, '30d')).rejects.toThrow('not_found');
  });
});

describe('setOpenAiProductFeed', () => {
  it("sets the brand's word", async () => {
    await setOpenAiProductFeed(BRAND, true);
    expect(calls[0]).toEqual({
      op: 'update',
      value: { openai_product_feed: true },
      filters: [['id', BRAND]],
    });
  });

  it("refuses bad input, and a brand the member can't change", async () => {
    await expect(setOpenAiProductFeed('b1', true)).rejects.toThrow('invalid');
    await expect(setOpenAiProductFeed(BRAND, 'yes' as unknown as boolean)).rejects.toThrow(
      'invalid',
    );
    expect(calls).toEqual([]);
    updatedRows = [];
    await expect(setOpenAiProductFeed(BRAND, false)).rejects.toThrow('forbidden');
  });
});
