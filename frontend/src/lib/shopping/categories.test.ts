import { describe, expect, it } from 'vitest';
import { categoryLeaf, categoryRows, categoryWords, type CategoryCardRow } from './categories';

/** Product Visibility's Categories (ECOM-008). */

const card = (over: Partial<CategoryCardRow>): CategoryCardRow => ({
  promptId: 'q1',
  promptText: 'lightweight 30L hiking backpack for women',
  role: 'competitor',
  competitorId: 'c-summit',
  productBrand: 'Summit Gear',
  merchant: 'summitgear.example',
  productId: null,
  ...over,
});

const competitors = new Map([
  ['c-summit', { name: 'Summit Gear', domain: 'summitgear.example' }],
  ['c-trail', { name: 'TrailCo', domain: 'trailco.example' }],
]);

describe('categoryWords and categoryLeaf', () => {
  it('reads a category as its last level, its words singular', () => {
    expect(categoryLeaf('Bags > Hiking backpacks')).toBe('Hiking backpacks');
    expect(categoryLeaf('Shoes / Trail running')).toBe('Trail running');
    expect(categoryWords('Hiking backpacks & Accessories')).toEqual([
      'hiking',
      'backpack',
      'accessory',
    ]);
    expect(categoryWords('Glasses')).toEqual(['glass']);
  });
});

describe('categoryRows', () => {
  const categories = [
    { id: 'packs', name: 'Bags > Hiking backpacks', productIds: ['ridge', 'trail28'] },
    { id: 'jackets', name: 'Rain jackets', productIds: ['storm'] },
    { id: 'empty', name: 'Tents', productIds: [] },
  ];
  const cards = [
    // "hiking backpack" in the question: the backpacks', the brand nowhere on it.
    card({}),
    card({ competitorId: 'c-trail', productBrand: 'TrailCo' }),
    card({}),
    card({
      promptId: 'q2',
      promptText: 'best daypack for women',
      role: 'own',
      competitorId: null,
      productId: 'ridge',
    }),
    card({
      promptId: 'q2',
      promptText: 'best daypack for women',
      role: 'other',
      competitorId: null,
      productBrand: 'Alpine Supply',
      merchant: null,
    }),
    // A jacket question, its name not in it: the brand's jacket on its shelf makes it the category's.
    card({
      promptId: 'q3',
      promptText: 'warm waterproof shell for winter',
      role: 'own',
      competitorId: null,
      productId: 'storm',
    }),
    card({ promptId: 'q3', promptText: 'warm waterproof shell for winter' }),
  ];
  const revenueOf = new Map([
    ['storm', { value: 7200, currency: 'USD' }],
    ['ridge', { value: 100, currency: 'EUR' }],
    ['trail28', { value: 300, currency: 'USD' }],
  ]);
  const rows = categoryRows(categories, cards, { competitors, revenueOf });
  const byId = Object.fromEntries(rows.map((row) => [row.id, row]));

  it("finds each category's questions by its name, or by its products on their shelves", () => {
    expect(byId.packs).toMatchObject({ leaf: 'Hiking backpacks', prompts: 2 });
    expect(byId.jackets).toMatchObject({ leaf: 'Rain jackets', prompts: 1 });
  });

  it("counts the brand's share of the shelves, its products on them, and the rival with most slots", () => {
    expect(byId.packs).toMatchObject({
      shelfShare: 1 / 5,
      productsOnShelf: 1,
      products: 2,
      topRival: { name: 'Summit Gear', domain: 'summitgear.example' },
    });
    expect(byId.jackets).toMatchObject({ shelfShare: 0.5, productsOnShelf: 1, products: 1 });
  });

  it("adds up its products' AI revenue in their main currency", () => {
    expect(byId.jackets.revenue).toEqual({ value: 7200, currency: 'USD' });
    // One sale in each currency: the first product's.
    expect(byId.packs.revenue).toEqual({ value: 100, currency: 'EUR' });
  });

  it('leaves out a category without products, and lists the most questions first', () => {
    expect(rows.map((row) => row.id)).toEqual(['packs', 'jackets']);
  });

  it("lists a category's questions in the cards' order, found by name or by products", () => {
    const [row] = categoryRows(
      [{ id: 'packs', name: 'Hiking backpacks', productIds: ['ridge'] }],
      [
        card({ promptId: 'q9', promptText: 'best daypack', role: 'own', productId: 'ridge' }),
        card({}),
      ],
      { competitors, revenueOf: new Map() },
    );
    expect(row.promptIds).toEqual(['q9', 'q1']);
  });

  it('marks a category the brand barely shows in, once it has enough questions', () => {
    const many = categoryRows(
      [{ id: 'packs', name: 'Hiking backpacks', productIds: ['ridge'] }],
      [
        ...['q1', 'q2', 'q3'].flatMap((promptId) =>
          Array.from({ length: 10 }, () =>
            card({ promptId, promptText: `hiking backpacks ${promptId}` }),
          ),
        ),
        card({ role: 'own', competitorId: null, productId: 'ridge' }),
      ],
      { competitors, revenueOf: new Map() },
    );
    expect(many[0]).toMatchObject({ prompts: 3, needsAttention: true, revenue: null });
    expect(byId.packs.needsAttention).toBe(false);
  });

  it("reads a big catalog's categories without walking every card for each", () => {
    // 1,000 collections of 10 products, each named "… > Hiking backpacks", so
    // each is in all of 1,000 questions and their 50,000 cards.
    const many = Array.from({ length: 1000 }, (_, i) => ({
      id: `c${i}`,
      name: `Line ${i} > Hiking backpacks`,
      productIds: Array.from({ length: 10 }, (_, j) => `p${i * 10 + j}`),
    }));
    const shelves = Array.from({ length: 50_000 }, (_, i) =>
      card({
        promptId: `q${i % 1000}`,
        promptText: `best hiking backpack for women ${i % 1000}`,
        role: i % 5 ? 'competitor' : 'own',
        competitorId: i % 5 ? 'c-summit' : null,
        productId: i % 5 ? null : `p${i % 10_000}`,
      }),
    );
    const started = Date.now();
    const read = categoryRows(many, shelves, { competitors, revenueOf: new Map() });
    expect(Date.now() - started).toBeLessThan(1500);
    // Its products p70 and p75 were on a shelf; p71…p74 and p76…p79 weren't.
    expect(read.find((row) => row.id === 'c7')).toMatchObject({
      prompts: 1000,
      shelfShare: 0.2,
      productsOnShelf: 2,
      topRival: { name: 'Summit Gear' },
    });
  });
});
