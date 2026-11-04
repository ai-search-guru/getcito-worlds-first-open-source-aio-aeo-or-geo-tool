import { describe, expect, it } from 'vitest';
import type { ProductRow } from './products';
import {
  buildShelf,
  inPriceBand,
  shelfCurrency,
  shelfStats,
  SHELF_CARDS,
  whyNotYou,
  type ShelfCardRow,
} from './shelf';

/** Product Visibility's Shelf (ECOM-006). */

const NOW = Date.parse('2026-10-27T12:00:00Z');

const card = (over: Partial<ShelfCardRow>): ShelfCardRow => ({
  prompt_result_id: 'r1',
  position: 0,
  created_at: '2026-10-27T08:00:00Z',
  platform: 'chatgpt-shopping',
  product_title: 'Summit Peak GTX',
  price_amount: 139,
  price_currency: 'USD',
  image_url: null,
  merchant_domain: 'summitgear.example',
  rating: 4.8,
  review_count: 2140,
  matched_brand_role: 'competitor',
  merchant_kind: 'reseller',
  marketplace: null,
  catalog_product_id: null,
  prompt_id: 'p1',
  prompt_text: 'best waterproof trail running shoes under $150',
  ...over,
});

describe('buildShelf', () => {
  it("shows each question's latest shelf per channel, in order, and the brand's week on it", () => {
    const rows = buildShelf(
      [
        // The latest shelf on ChatGPT: the brand second, through Amazon.
        card({
          position: 1,
          product_title: 'Trail Runner X',
          matched_brand_role: 'own',
          merchant_kind: 'marketplace',
          marketplace: 'amazon',
          catalog_product_id: 'cp1',
          price_amount: 129,
        }),
        card({ position: 0 }),
        // An older shelf this week, without the brand.
        card({ prompt_result_id: 'r0', created_at: '2026-10-24T08:00:00Z' }),
        // Older than a week: not counted in the week.
        card({
          prompt_result_id: 'r-old',
          created_at: '2026-10-10T08:00:00Z',
          matched_brand_role: 'own',
        }),
        // The same question on Copilot: the brand first.
        card({
          prompt_result_id: 'r2',
          platform: 'copilot-web',
          matched_brand_role: 'own',
          product_title: 'StormShell',
        }),
      ],
      NOW,
    );
    expect(
      rows.map((row) => [row.platform, row.ownRank, row.weekShelves, row.weekOwnShelves]),
    ).toEqual([
      ['chatgpt-shopping', 2, 2, 1],
      ['copilot-web', 1, 1, 1],
    ]);
    expect(rows[0].cards.map((c) => [c.rank, c.title, c.own, c.via, c.productId])).toEqual([
      [1, 'Summit Peak GTX', false, null, null],
      [2, 'Trail Runner X', true, 'amazon', 'cp1'],
    ]);
  });

  it("puts the shelves the brand isn't on first, then the lowest places", () => {
    const rows = buildShelf(
      [
        card({ prompt_id: 'a', prompt_text: 'a', matched_brand_role: 'own' }),
        card({ prompt_id: 'b', prompt_text: 'b', prompt_result_id: 'rb' }),
        card({ prompt_id: 'c', prompt_text: 'c', prompt_result_id: 'rc' }),
        card({
          prompt_id: 'c',
          prompt_text: 'c',
          prompt_result_id: 'rc',
          position: 1,
          matched_brand_role: 'own',
        }),
      ],
      NOW,
    );
    expect(rows.map((row) => [row.promptId, row.ownRank])).toEqual([
      ['b', null],
      ['c', 2],
      ['a', 1],
    ]);
  });

  it('shows a few products a shelf, and leaves out cards without a question', () => {
    const rows = buildShelf(
      [
        ...Array.from({ length: 10 }, (_, i) => card({ position: i })),
        card({ prompt_id: null, prompt_result_id: 'x' }),
      ],
      NOW,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].cards).toHaveLength(SHELF_CARDS);
  });
});

describe('shelfStats', () => {
  it("counts the brand's slots, its catalog products and the channels showing them", () => {
    const stats = shelfStats([
      card({ matched_brand_role: 'own', catalog_product_id: 'cp1', platform: 'copilot-web' }),
      card({ matched_brand_role: 'own', catalog_product_id: 'cp1' }),
      card({ matched_brand_role: 'own', catalog_product_id: 'cp2', platform: 'copilot-web' }),
      card({}),
    ]);
    expect(stats).toEqual({
      slots: 4,
      ownSlots: 3,
      products: 2,
      fromCatalog: true,
      channels: [
        { platform: 'copilot-web', ownSlots: 2 },
        { platform: 'chatgpt-shopping', ownSlots: 1 },
      ],
    });
  });

  it('counts titles when no card is matched to the catalog', () => {
    const stats = shelfStats([
      card({ matched_brand_role: 'own', product_title: 'Trail Runner X' }),
      card({ matched_brand_role: 'own', product_title: ' trail  runner x ' }),
      card({ matched_brand_role: 'own', product_title: 'StormShell' }),
    ]);
    expect([stats.products, stats.fromCatalog]).toEqual([2, false]);
  });
});

describe('inPriceBand', () => {
  it("reads a shelf's middle price", () => {
    const [row] = buildShelf(
      [
        card({ position: 0, price_amount: 119 }),
        card({ position: 1, price_amount: 139 }),
        card({ position: 2, price_amount: 145 }),
        card({ position: 3, price_amount: null }),
      ],
      NOW,
    );
    expect(inPriceBand(row, 'all')).toBe(true);
    expect(inPriceBand(row, '100to200')).toBe(true);
    expect(inPriceBand(row, 'under50')).toBe(false);
    const [noPrices] = buildShelf([card({ price_amount: null })], NOW);
    expect(inPriceBand(noPrices, 'over200')).toBe(false);
  });
});

describe('shelfCurrency', () => {
  it('is the currency most of the shelves’ priced products show, else none', () => {
    const rows = buildShelf(
      [
        card({ position: 0, price_currency: 'EUR' }),
        card({ position: 1, price_currency: 'EUR' }),
        card({ position: 2, price_currency: 'USD' }),
        // Without a price, its currency says nothing.
        card({ position: 3, price_amount: null, price_currency: 'GBP' }),
        card({ position: 4, price_amount: null, price_currency: 'GBP' }),
      ],
      NOW,
    );
    expect(shelfCurrency(rows)).toBe('EUR');
    expect(shelfCurrency(buildShelf([card({ price_currency: null })], NOW))).toBeNull();
    expect(shelfCurrency([])).toBeNull();
  });
});

describe('whyNotYou', () => {
  const productRow = (
    id: string,
    over: Partial<ProductRow['product']> = {},
    readiness = 50,
  ): ProductRow => ({
    product: {
      id,
      title: `Product ${id}`,
      url: null,
      productType: null,
      brand: null,
      description: null,
      image: null,
      category: null,
      price: 100,
      currency: 'USD',
      inStock: true,
      hasGtin: true,
      ...over,
    },
    shelves: 0,
    winRate: null,
    avgRank: null,
    aiVisits: 0,
    orders: 0,
    revenue: null,
    currency: null,
    readiness,
    missing: [],
    wrongPrice: null,
  });
  const absent = buildShelf(
    [
      card({
        prompt_text: 'lightweight hiking backpack for women',
        matched_brand_role: 'competitor',
      }),
    ],
    NOW,
  )[0];

  it('names the product the question asks for most, by its title, category and type', () => {
    const products = [
      productRow('boot', { title: 'Peak Hiking Boot' }),
      productRow('ridge', { title: 'Ridge 30L', category: 'Bags > Hiking backpacks' }),
      productRow('trail', { title: 'Trail Daypack', productType: 'Backpack' }, 90),
    ];
    // Ridge shares "hiking" and "backpack"; the others one word each.
    expect(whyNotYou(absent, products)?.product.id).toBe('ridge');
    // On a tie, the readier one.
    expect(
      whyNotYou(absent, [
        productRow('a', { title: 'Hiking Backpack A' }, 40),
        productRow('b', { title: 'Hiking Backpack B' }, 80),
      ])?.product.id,
    ).toBe('b');
  });

  it('needs two of the question’s words, or its category, not "best", "under" or a price', () => {
    const shoes = buildShelf(
      [
        card({
          prompt_text: 'best running shoes for men under $100',
          matched_brand_role: 'competitor',
        }),
      ],
      NOW,
    )[0];
    const tee = productRow('tee', {
      title: "Men's Best Seller Tee",
      category: 'Apparel > T-shirts',
    });
    // "best" and "under" ask, "100" is a price: only "men" is left, one word.
    expect(whyNotYou(shoes, [tee])).toBeNull();
    expect(whyNotYou(shoes, [productRow('top', { title: 'Top 100 Under Armour Cap' })])).toBeNull();
    // Its category is what the question names: a candidate on one word less.
    const runner = productRow('runner', {
      title: 'Trail Runner X',
      category: 'Shoes > Running shoes',
    });
    expect(whyNotYou(shoes, [tee, runner])?.product.id).toBe('runner');
    // Or by its type.
    expect(
      whyNotYou(shoes, [
        tee,
        productRow('glide', { title: 'Glide 3', productType: 'Running shoes' }),
      ])?.product.id,
    ).toBe('glide');
  });

  it("never makes a product a candidate on who it's for alone, but breaks a tie on it", () => {
    const asking = (prompt_text: string) =>
      buildShelf([card({ prompt_text, matched_brand_role: 'competitor' })], NOW)[0];
    const shoes = asking('best running shoes for men under $100');
    // A category or a type that only says who it's for isn't what the question names.
    for (const [question, audience, title] of [
      [shoes, 'Men', "Men's Best Seller Tee"],
      [asking('best running shoes for women under $100'), 'Women', "Women's Best Seller Tee"],
      [asking('best running shoes for kids'), 'Kids', "Kids' Best Seller Tee"],
    ] as const) {
      expect(
        whyNotYou(question, [productRow('tee', { title, category: `Clothing > ${audience}` })]),
      ).toBeNull();
      expect(whyNotYou(question, [productRow('tee', { title, productType: audience })])).toBeNull();
    }
    // Nor does it make up the two words: only "hiking" says what it is.
    expect(
      whyNotYou(asking('hiking boots for women'), [
        productRow('socks', { title: "Women's Hiking Socks" }),
      ]),
    ).toBeNull();
    // A category that names what it is, past who it's for, still does.
    expect(
      whyNotYou(shoes, [
        productRow('pace', { title: 'Pace 2', category: "Footwear > Men's running shoes" }),
      ])?.product.id,
    ).toBe('pace');
    // Among candidates, the one for whom the question asks, before the readier one.
    expect(
      whyNotYou(asking('running shoes for women'), [
        productRow('his', { title: "Men's Running Shoe" }, 90),
        productRow('hers', { title: "Women's Running Shoe" }, 40),
      ])?.product.id,
    ).toBe('hers');
  });

  it('names none for a shelf the brand is on, or when nothing shares a word with the question', () => {
    expect(whyNotYou(absent, [productRow('mug', { title: 'Coffee mug' })])).toBeNull();
    const on = { ...absent, ownRank: 2 };
    expect(whyNotYou(on, [productRow('ridge', { title: 'Hiking backpack' })])).toBeNull();
  });
});
