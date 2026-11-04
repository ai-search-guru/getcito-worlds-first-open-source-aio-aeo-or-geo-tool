import { describe, expect, it } from 'vitest';
import type { ShoppingProductDetail } from '@/lib/actions/shopping';
import { categoryPlan, productPlan } from './actionPlan';
import type { CategoryRow } from './categories';

/** The proposed work for a product or a category (ECOM-013). */

const detail = (over: Partial<ShoppingProductDetail> = {}): ShoppingProductDetail => ({
  product: {
    id: 'p1',
    title: 'Ridge 30L Backpack',
    url: null,
    productType: 'Backpacks',
    brand: 'Northwind',
    description: null,
    image: null,
    category: 'Hiking backpacks',
    price: 119,
    currency: 'USD',
    inStock: true,
    hasGtin: false,
  },
  readiness: { score: 48, missing: ['gtin', 'description'], unknown: [] },
  shelves: [],
  focus: {
    promptId: 'q1',
    promptText: 'lightweight 30L hiking backpack for women',
    platform: 'chatgpt-shopping',
    rank: null,
    winner: {
      title: 'Summit Daypack 30 W',
      price: 110,
      currency: 'USD',
      rating: 4.8,
      reviews: 2140,
      merchant: null,
      image: null,
    },
    score: 41,
    winnerScore: 88,
    missing: ['women', 'lightweight', 'litre', 'trail'],
  },
  comparison: [],
  ai: { visits: 0, orders: 0, revenue: null, currency: null },
  result: null,
  ...over,
});

describe('productPlan', () => {
  it('proposes the four work types from what the product misses beside the winner', () => {
    expect(productPlan(detail()).map((w) => [w.type, w.who, w.agentCan, w.line])).toEqual([
      [
        'optimize_page',
        'agent',
        true,
        { key: 'optimizeWords', values: { words: 'women, lightweight, litre' } },
      ],
      [
        'create_content',
        'agent',
        true,
        {
          key: 'compare',
          values: { product: 'Ridge 30L Backpack', winner: 'Summit Daypack 30 W' },
        },
      ],
      ['get_listed', 'me', true, { key: 'listed', values: { product: 'Ridge 30L Backpack' } }],
      ['technical', 'me', false, { key: 'gtinSchema' }],
    ]);
  });

  it('falls back to the question, a buying guide and a schema check', () => {
    const plan = productPlan(
      detail({ focus: null, readiness: { score: 100, missing: [], unknown: [] } }),
    );
    expect(plan.map((w) => w.line.key)).toEqual(['optimizeQuestion', 'guide', 'listed', 'schema']);
  });
});

describe('categoryPlan', () => {
  it('proposes the category page, a buying guide, the best-of lists and the feed fields', () => {
    const row = { leaf: 'Hiking backpacks', products: 18 } as CategoryRow;
    expect(categoryPlan(row).map((w) => [w.type, w.line])).toEqual([
      ['optimize_page', { key: 'categoryPage' }],
      ['create_content', { key: 'buyingGuide', values: { category: 'hiking backpacks' } }],
      ['get_listed', { key: 'bestLists', values: { category: 'hiking backpacks' } }],
      ['technical', { key: 'feedFields', values: { count: 18 } }],
    ]);
  });
});
