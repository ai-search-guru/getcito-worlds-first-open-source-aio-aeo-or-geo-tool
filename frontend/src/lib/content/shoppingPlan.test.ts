import { describe, expect, it } from 'vitest';
import type { CategoryPage } from '@/lib/catalogClient';
import { planPriorityLevel } from './plan';
import type { DraftShopping } from './shoppingCheck';
import {
  MAX_GUIDES,
  MIN_IN_STOCK,
  categoryLeaf,
  fixScore,
  guideScore,
  shoppingOpportunities,
  type ShoppingPlanDraft,
} from './shoppingPlan';

/** Plan › Shopping opportunities (shopping path, part 7). */

const category = (name: string, inStock = 12, extra: Partial<CategoryPage> = {}): CategoryPage => ({
  name,
  products: inStock + 4,
  inStock,
  page: { url: `https://shop.example/c/${name.toLowerCase().replace(/\W+/g, '-')}`, title: name },
  how: 'address',
  ...extra,
});

const checked = (
  over: Partial<Extract<DraftShopping, { readFrom: unknown }>> = {},
): DraftShopping => ({
  state: 'ok',
  readFrom: 'page',
  checkedAt: '2026-10-27T09:00:00Z',
  categories: 1,
  categoriesLinked: 1,
  products: 3,
  productsLinked: 3,
  bad: [],
  ...over,
});

const draft = (id: string, over: Partial<ShoppingPlanDraft> = {}): ShoppingPlanDraft => ({
  id,
  title: `Post ${id}`,
  status: 'published',
  categories: [],
  shopping: { state: 'none' },
  ...over,
});

describe('categoryLeaf', () => {
  it("is a category's own name, the last step of its path", () => {
    expect(categoryLeaf('Shoes > Hiking Boots')).toBe('Hiking Boots');
    expect(categoryLeaf('Apparel › Jackets / Rain jackets')).toBe('Rain jackets');
    expect(categoryLeaf('Boots')).toBe('Boots');
  });
});

describe('scores', () => {
  it("rank a guide as the Plan's new pages, up to 60, by the prompts asking and the stock", () => {
    expect(guideScore(0, 0)).toBe(30);
    expect(guideScore(3, 20)).toBe(60);
    expect(guideScore(1, 20)).toBeGreaterThan(guideScore(0, 20));
    expect(guideScore(9, 400)).toBe(60);
  });

  it('rank a post linking products that no longer sell above one missing its category link', () => {
    expect(fixScore(0)).toBeLessThan(fixScore(1));
    expect(fixScore(1)).toBeLessThan(fixScore(4));
    expect(fixScore(4)).toBe(fixScore(10));
    expect(planPriorityLevel(fixScore(4))).toBe('high');
  });
});

describe('shoppingOpportunities', () => {
  it('lists a buying guide for a category in stock no page guides to, with the prompts asking about it', () => {
    const rows = shoppingOpportunities({
      categories: [category('Shoes > Hiking Boots'), category('Socks', MIN_IN_STOCK - 1)],
      drafts: [],
      prompts: [
        { id: 'q1', text: 'best waterproof hiking boots' },
        { id: 'q2', text: 'Hiking boot for wide feet?' },
        { id: 'q3', text: 'best running shoes' },
      ],
    });
    expect(rows).toEqual([
      expect.objectContaining({
        kind: 'guide',
        key: 'guide:Shoes > Hiking Boots',
        leaf: 'Hiking Boots',
        prompts: 2,
        promptId: 'q1',
        draft: null,
      }),
    ]);
  });

  it('leaves out a category a published page holds in its path or names in its title, and opens one still being written', () => {
    const rows = shoppingOpportunities({
      categories: [category('Rain Jackets'), category('Hiking Boots'), category('Tents')],
      drafts: [
        draft('d1', { categories: ['Rain Jackets'] }),
        draft('d2', { title: 'The best hiking boots of 2026' }),
        draft('d3', { title: 'Tents for two', status: 'draft' }),
      ],
      prompts: [],
    });
    expect(rows).toEqual([
      expect.objectContaining({
        kind: 'guide',
        leaf: 'Tents',
        draft: { id: 'd3', title: 'Tents for two' },
      }),
    ]);
  });

  it('lists a published post whose last check found sold-out links or a category page it misses', () => {
    const rows = shoppingOpportunities({
      categories: [category('Outerwear > Rain Jackets', 2)],
      drafts: [
        draft('sold', {
          categories: ['Outerwear > Rain Jackets'],
          shopping: checked({
            state: 'attention',
            categoriesLinked: 0,
            bad: [
              { id: 'p1', title: 'Storm Shell 2', state: 'sold_out' },
              { id: 'p2', title: 'Pack-Lite', state: 'sold_out' },
            ],
          }),
        }),
        draft('unlinked', {
          categories: ['Gone category'],
          shopping: checked({ categories: 2, categoriesLinked: 1 }),
        }),
        draft('mixed', {
          shopping: checked({
            state: 'attention',
            bad: [
              { id: 'p1', title: 'Storm Shell 2', state: 'sold_out' },
              { id: 'p3', title: 'Old', state: 'gone' },
            ],
          }),
        }),
        draft('fine', { shopping: checked() }),
        draft('unchecked', { shopping: { state: 'unchecked' } }),
        draft('writing', { status: 'ready', shopping: checked({ state: 'attention', bad: [] }) }),
      ],
      prompts: [],
    });
    expect(rows.map((r) => r.key)).toEqual(['fix:sold', 'fix:mixed', 'fix:unlinked']);
    expect(rows[0]).toMatchObject({
      kind: 'fix',
      draft: { id: 'sold', title: 'Post sold' },
      categoryName: 'Outerwear > Rain Jackets',
      category: expect.objectContaining({ inStock: 2 }),
      bad: 2,
      soldOut: true,
      categories: 1,
      categoriesLinked: 0,
    });
    expect(rows[1]).toMatchObject({ soldOut: false, category: null, categoryName: null });
    expect(rows[2]).toMatchObject({ bad: 0, category: null, categoryName: 'Gone category' });
  });

  it(`ranks every row by its score, at most ${MAX_GUIDES} guides`, () => {
    const categories = Array.from({ length: MAX_GUIDES + 3 }, (_, i) =>
      category(`Category ${String.fromCharCode(65 + i)}`, MIN_IN_STOCK + i),
    );
    const rows = shoppingOpportunities({
      categories,
      drafts: [
        draft('sold', {
          shopping: checked({
            state: 'attention',
            bad: [{ id: 'p1', title: 'Storm Shell 2', state: 'sold_out' }],
          }),
        }),
      ],
      prompts: [],
    });
    expect(rows.filter((r) => r.kind === 'guide')).toHaveLength(MAX_GUIDES);
    expect(rows[0].key).toBe('fix:sold');
    const scores = rows.map((r) => r.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    // The deepest stock first among the guides: the shallowest ones are left out.
    expect(rows.some((r) => r.key === 'guide:Category A')).toBe(false);
  });
});
