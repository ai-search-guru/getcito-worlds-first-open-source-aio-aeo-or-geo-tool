import { describe, expect, it } from 'vitest';
import {
  comparison,
  detailPrompts,
  focusShelf,
  productShelves,
  productText,
  type DetailCard,
} from './productDetail';
import { priceText } from './price';
import type { CatalogProductRow } from './products';

/** A product's page: its shelves and "Why not your product?" (ECOM-011). */

const product: CatalogProductRow = {
  id: 'ridge',
  title: 'Ridge 30L Backpack',
  url: 'https://northwind.example/products/ridge-30',
  productType: 'Backpacks',
  brand: 'Northwind',
  description:
    'Built for everyday adventures with tough fabric and lots of pockets, our pack has been a favourite since 1998 for hikers who love the outdoors and want gear that lasts season after season.',
  image: null,
  category: 'Bags > Hiking backpacks',
  price: 119,
  currency: 'USD',
  inStock: true,
  hasGtin: false,
};

const card = (over: Partial<DetailCard>): DetailCard => ({
  promptId: 'q1',
  promptText: 'lightweight 30L hiking backpack for women',
  platform: 'chatgpt-shopping',
  promptResultId: 'r1',
  at: '2026-10-27T08:00:00Z',
  position: 0,
  title: 'Summit Daypack 30 W Lightweight Hiking Backpack for Women',
  price: 110,
  currency: 'USD',
  rating: 4.8,
  reviews: 2140,
  merchant: 'summitgear.example',
  image: null,
  role: 'competitor',
  productId: null,
  searches: ['women hiking backpack lightweight'],
  ...over,
});

const cards = [
  card({}),
  card({ position: 1, title: 'TrailCo Lite 28', price: 95, rating: 4.6, reviews: 300 }),
  // An older answer with the product on it: not the latest shelf.
  card({
    promptResultId: 'r0',
    at: '2026-10-20T08:00:00Z',
    title: 'Ridge 30L Backpack',
    role: 'own',
    productId: 'ridge',
  }),
  // The product leads another question's shelf.
  card({
    promptId: 'q2',
    promptText: 'durable 30 litre daypack',
    promptResultId: 'r2',
    title: 'Ridge 30L Backpack',
    role: 'own',
    productId: 'ridge',
    rating: 4.5,
    reviews: 86,
  }),
  card({
    promptId: 'q2',
    promptText: 'durable 30 litre daypack',
    promptResultId: 'r2',
    position: 1,
  }),
  // An unrelated question.
  card({
    promptId: 'q3',
    promptText: 'best trail running shoes',
    promptResultId: 'r3',
    title: 'Summit Peak GTX',
  }),
];

describe('productShelves', () => {
  const lines = productShelves(product, cards);

  it("lists the questions of the product's category and those it was on, not the others", () => {
    expect(lines.map((line) => [line.promptId, line.rank])).toEqual(
      expect.arrayContaining([
        ['q1', null],
        ['q2', 1],
      ]),
    );
    expect(lines.some((line) => line.promptId === 'q3')).toBe(false);
  });

  it("names the shelf's winner when it isn't the product, with both scores and the missing words", () => {
    const q1 = lines.find((line) => line.promptId === 'q1')!;
    expect(q1.winner).toMatchObject({
      title: 'Summit Daypack 30 W Lightweight Hiking Backpack for Women',
      price: 110,
    });
    expect(q1.winnerScore).toBeGreaterThan(q1.score);
    expect(q1.missing).toEqual(expect.arrayContaining(['lightweight', 'women']));
    expect(lines.find((line) => line.promptId === 'q2')!.winner).toBeNull();
  });

  it("never names one of the brand's own products the winner", () => {
    const own = (over: Partial<DetailCard>) =>
      card({ promptId: 'q5', promptResultId: 'r5', role: 'own', ...over });
    const shelf = (...on: DetailCard[]) =>
      productShelves(product, on, { include: 'q5' }).find((line) => line.promptId === 'q5')!;
    // Its sister product first, a rival second, the product absent: the rival.
    expect(
      shelf(
        own({ title: 'Ridge 40L Backpack', productId: 'ridge-40' }),
        card({ promptId: 'q5', promptResultId: 'r5', position: 1, title: 'TrailCo Lite 28' }),
      ).winner?.title,
    ).toBe('TrailCo Lite 28');
    // Only its own above it: nothing to beat.
    const second = shelf(
      own({ title: 'Ridge 40L Backpack', productId: 'ridge-40' }),
      own({ position: 1, title: 'Ridge 30L Backpack', productId: 'ridge' }),
      card({ promptId: 'q5', promptResultId: 'r5', position: 2, title: 'TrailCo Lite 28' }),
    );
    expect(second.rank).toBe(2);
    expect(second.winner).toBeNull();
  });

  it('reads the title and the first 40 words of the description', () => {
    expect(productText({ ...product, description: 'word '.repeat(60) }).split(' ')).toHaveLength(
      3 + 40,
    );
    expect(productText({ ...product, description: null })).toBe('Ridge 30L Backpack');
  });
});

describe('focusShelf', () => {
  it("explains the most relevant shelf it's missing, else the one it ranks lowest on", () => {
    const lines = productShelves(product, cards);
    expect(focusShelf(lines)?.promptId).toBe('q1');
    const behind = [
      { ...lines[0], rank: 2 },
      { ...lines[0], promptId: 'x', rank: 4 },
    ];
    expect(focusShelf(behind)?.promptId).toBe('x');
    expect(focusShelf([{ ...lines[0], rank: 1, winner: null }])).toBeNull();
  });
});

describe('detailPrompts', () => {
  const prompts = [
    { id: 'q3', text: 'best trail running shoes' },
    { id: 'q1', text: 'lightweight 30L hiking backpack for women' },
    { id: 'q4', text: 'backpack for school' },
    { id: 'q2', text: 'durable 30 litre daypack' },
    { id: 'q9', text: 'gifts for runners' },
  ];

  it('reads the shelves asked for, it was on, of its category, then those sharing its words', () => {
    expect(detailPrompts(product, prompts, { appeared: new Set(['q2']), include: 'q9' })).toEqual([
      'q9',
      'q2',
      'q1',
      'q4',
    ]);
    // Not a word in common, nor asked for: not read.
    expect(detailPrompts(product, prompts, { appeared: new Set() })).not.toContain('q3');
    expect(detailPrompts(product, prompts, { appeared: new Set(), max: 1 })).toEqual(['q1']);
  });
});

describe('a shelf asked for (the Shelf’s "Why not you?")', () => {
  it('keeps the question whatever its match, and explains that shelf first', () => {
    // q3 isn't the product's: kept when it's the one asked for.
    expect(productShelves(product, cards).some((line) => line.promptId === 'q3')).toBe(false);
    const lines = productShelves(product, cards, { include: 'q3' });
    expect(lines.some((line) => line.promptId === 'q3')).toBe(true);
    expect(focusShelf(lines, { promptId: 'q3', platform: 'chatgpt-shopping' })?.promptId).toBe(
      'q3',
    );
    // Another channel than the one asked for, or a shelf it leads: the usual one.
    expect(focusShelf(lines, { promptId: 'q3', platform: 'gemini-web' })?.promptId).toBe('q1');
    expect(focusShelf(lines, { promptId: 'q2' })?.promptId).toBe('q1');
  });
});

describe('comparison', () => {
  it('sets the product beside the winner, row by row', () => {
    const q1 = productShelves(product, cards).find((line) => line.promptId === 'q1')!;
    const rows = comparison(product, q1, {
      own: { rating: 4.5, reviews: 86 },
      price: priceText,
      storeDomain: 'northwind.example',
    });
    expect(rows.map((row) => [row.key, row.you, row.winner, row.state, row.note?.key])).toEqual([
      ['score', String(q1.score), String(q1.winnerScore), 'missing', 'missingWords'],
      ['price', '$119', '$110', 'match', 'close'],
      ['rating', '4.5 · 86', '4.8 · 2,140', 'weaker', undefined],
      ['firstWords', null, null, 'missing', 'firstWords'],
      ['gtin', null, null, 'missing', undefined],
      ['photo', null, null, 'missing', undefined],
      ['stock', null, null, 'match', undefined],
      ['merchant', 'northwind.example', 'summitgear.example', 'info', undefined],
    ]);
  });

  it("doesn't count the first 40 words as missing without a product type to look for", () => {
    const q1 = productShelves(product, cards).find((line) => line.promptId === 'q1')!;
    const rows = comparison({ ...product, productType: null, category: null }, q1, {
      own: null,
      price: priceText,
      storeDomain: null,
    });
    expect(rows.find((row) => row.key === 'firstWords')).toMatchObject({
      state: 'info',
      note: { key: 'noType' },
    });
  });

  it('says how much higher or lower the price is, and a rating the answers never showed', () => {
    const q1 = productShelves(product, cards).find((line) => line.promptId === 'q1')!;
    const pricier = comparison({ ...product, price: 150 }, q1, {
      own: null,
      price: priceText,
      storeDomain: null,
    });
    expect(pricier.find((row) => row.key === 'price')).toMatchObject({
      state: 'weaker',
      note: { key: 'higher', values: { percent: 36 } },
    });
    expect(pricier.find((row) => row.key === 'rating')).toMatchObject({
      you: null,
      state: 'missing',
    });
    const cheaper = comparison({ ...product, price: 80 }, q1, {
      own: null,
      price: priceText,
      storeDomain: null,
    });
    expect(cheaper.find((row) => row.key === 'price')?.note).toEqual({
      key: 'lower',
      values: { percent: 27 },
    });
  });
});
