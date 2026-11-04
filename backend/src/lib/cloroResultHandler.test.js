import { describe, it, expect, vi, beforeEach } from 'vitest';

// The handler reaches the supabase admin client at import time, and the AI
// tracker reaches the model SDKs; stub both so the module loads under test.
const upsert = vi.fn();
vi.mock('../config/supabase.js', () => ({
  default: { from: () => ({ upsert }) },
}));
vi.mock('./aiTracker.js', () => ({ analyzeSentimentAI: vi.fn() }));
const catalogIndexFor = vi.hoisted(() => vi.fn());
vi.mock('./catalog/cardMatch.js', async (importOriginal) => ({
  ...(await importOriginal()),
  catalogIndexFor,
}));

import { catalogIndex } from './catalog/cardMatch.js';
import { persistShoppingCards } from './cloroResultHandler.js';

const noCatalog = catalogIndex({ products: [], variants: [] });

const base = {
  promptResultId: 'result-1',
  brandId: 'brand-1',
  platform: 'chatgpt-shopping',
  region: 'US',
  brandInfo: { brandId: 'brand-1', brandName: 'Acme', domains: ['acme.com'] },
  competitors: [],
};

describe('persistShoppingCards – ChatGPT inline products (#1183)', () => {
  beforeEach(() => {
    upsert.mockReset();
    upsert.mockResolvedValue({ error: null });
    catalogIndexFor.mockReset().mockResolvedValue(noCatalog);
  });

  it('stores inline products after the carousel cards', async () => {
    const inserted = await persistShoppingCards({
      ...base,
      rawCards: [
        {
          tags: [],
          products: [
            { title: 'Carousel A', position: 1, price: '$10.00' },
            { title: 'Carousel B', position: 2, price: '$12.00' },
          ],
        },
      ],
      rawInlineProducts: [
        { product: { title: 'Acme Trail Runner', price: '$75.00' }, entity: 'Acme Trail Runner' },
      ],
    });

    expect(inserted).toBe(3);
    const rows = upsert.mock.calls[0][0];
    expect(rows.map((row) => [row.product_title, row.position])).toEqual([
      ['Carousel A', 1],
      ['Carousel B', 2],
      ['Acme Trail Runner', 3],
    ]);
    expect(rows[2].raw.surface).toBe('inline');
    expect(rows[2].matched_brand_role).toBe('own');
  });

  it('stores inline products when the answer has no carousel', async () => {
    const inserted = await persistShoppingCards({
      ...base,
      rawCards: [],
      rawInlineProducts: [{ product: { title: 'Trail Runner', price: '$75.00' } }],
    });

    expect(inserted).toBe(1);
    expect(upsert.mock.calls[0][0][0].position).toBe(1);
  });

  it('persists the merchant classification and keeps cards without a URL unclassified', async () => {
    const inserted = await persistShoppingCards({
      ...base,
      rawCards: [
        {
          products: [
            {
              title: 'Acme Trail Runner on Amazon',
              url: 'https://www.amazon.com/dp/B0C123ABCD?tag=tracking',
              price: '$75.00',
            },
            {
              title: 'Acme Trail Runner Store',
              url: 'https://shop.acme.com/products/trail-runner',
              price: '$75.00',
            },
            {
              title: 'Acme Trail Runner Reseller',
              url: 'https://shop.example/products/trail-runner',
              price: '$70.00',
            },
            { title: 'Acme Trail Runner without merchant URL', price: '$75.00' },
          ],
        },
      ],
    });

    expect(inserted).toBe(4);
    const rows = upsert.mock.calls[0][0];
    expect(rows.map((row) => [row.merchant_kind, row.marketplace, row.listing_id])).toEqual([
      ['marketplace', 'amazon', 'B0C123ABCD'],
      ['own', null, null],
      ['reseller', null, null],
      [null, null, null],
    ]);
  });

  it('writes nothing when there are neither cards nor inline products', async () => {
    const inserted = await persistShoppingCards({ ...base, rawCards: [] });
    expect(inserted).toBe(0);
    expect(upsert).not.toHaveBeenCalled();
  });
});

describe('persistShoppingCards – the catalog product behind an own card (00360)', () => {
  const catalog = catalogIndex(
    {
      products: [
        {
          id: 'p-runner',
          title: 'Acme Trail Runner X',
          url: 'https://acme.com/products/trail-runner-x',
        },
        { id: 'p-pack', title: 'Acme Ridge 30L Backpack', url: null },
      ],
      variants: [
        { product_id: 'p-pack', url: null, gtin: null, marketplace_item_id: 'B0C123ABCD' },
      ],
    },
    { brandName: 'Acme' },
  );
  const cards = [
    {
      products: [
        {
          title: 'Acme Trail Runner X',
          url: 'https://acme.com/products/trail-runner-x?variant=4',
          price: '$129.00',
        },
        { title: 'Acme Ridge Pack', url: 'https://www.amazon.com/dp/B0C123ABCD', price: '$119.00' },
        { title: 'Summit Daypack 30 W', url: 'https://summit.example/p/daypack', price: '$110.00' },
      ],
    },
  ];

  beforeEach(() => {
    upsert.mockReset();
    upsert.mockResolvedValue({ error: null });
    catalogIndexFor.mockReset().mockResolvedValue(catalog);
  });

  it("matches the brand's own cards by their link or listing, and leaves a rival's alone", async () => {
    await persistShoppingCards({ ...base, rawCards: cards });
    expect(catalogIndexFor).toHaveBeenCalledWith('brand-1', { brandName: 'Acme' });
    const rows = upsert.mock.calls[0][0];
    expect(rows.map((row) => [row.catalog_product_id ?? null, row.catalog_match ?? null])).toEqual([
      ['p-runner', 'url'],
      ['p-pack', 'listing'],
      [null, null],
    ]);
  });

  it("writes the cards without matches when the catalog can't be read", async () => {
    catalogIndexFor.mockRejectedValue(new Error('down'));
    expect(await persistShoppingCards({ ...base, rawCards: cards })).toBe(3);
    expect(upsert.mock.calls[0][0].some((row) => 'catalog_product_id' in row)).toBe(false);
  });

  it('writes the cards again without their matches before the migration is in', async () => {
    upsert
      .mockResolvedValueOnce({
        error: {
          message: "Could not find the 'catalog_match' column of 'prompt_result_shopping_cards'",
        },
      })
      .mockResolvedValueOnce({ error: null });
    expect(await persistShoppingCards({ ...base, rawCards: cards })).toBe(3);
    expect(upsert).toHaveBeenCalledTimes(2);
    expect(upsert.mock.calls[1][0].some((row) => 'catalog_product_id' in row)).toBe(false);
  });
});
