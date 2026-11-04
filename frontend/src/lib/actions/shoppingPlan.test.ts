import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Plan › Shopping opportunities' read (shopping path, part 7): the brand's
 * drafts with their path's categories and last check, its active prompts,
 * and its catalog's live products.
 */

const BRAND = '33333333-3333-3333-3333-333333333333';

let tables: Record<string, { data?: unknown; count?: number; error?: { message: string } | null }>;
let calls: { table: string; op: string; args: unknown[] }[];

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      for (const op of ['select', 'eq', 'is', 'order', 'limit']) {
        chain[op] = (...args: unknown[]) => (calls.push({ table, op, args }), chain);
      }
      chain.then = (resolve: (r: unknown) => void) =>
        resolve({ data: null, count: null, error: null, ...tables[table] });
      return chain;
    },
  })),
}));

const { getShoppingPlan } = await import('./shoppingPlan');

beforeEach(() => {
  calls = [];
  tables = {
    content_drafts: {
      data: [
        {
          id: 'd1',
          title: 'Best rain jackets',
          status: 'published',
          shopping_built: '2026-10-26T09:00:00.000Z',
          shopping_categories: [
            { name: 'Outerwear > Rain Jackets', url: 'https://shop.example/c/rain', title: 'Rain' },
          ],
          content_shopping_checks: [
            {
              read_from: 'page',
              checked_at: '2026-10-27T09:00:00Z',
              categories: 1,
              categories_linked: 0,
              products: 3,
              products_linked: 2,
              bad: [{ id: 'p1', title: 'Storm Shell 2', state: 'sold_out' }],
            },
          ],
        },
        {
          id: 'd2',
          title: null,
          status: 'odd',
          shopping_built: null,
          shopping_categories: { not: 'a list' },
          content_shopping_checks: [],
        },
      ],
    },
    prompts: {
      data: [
        { id: 'q1', text: 'best rain jackets' },
        { id: 'q2', text: null },
      ],
    },
    catalog_products: { count: 1240 },
  };
});

describe('getShoppingPlan', () => {
  it("reads the brand's drafts with their path's categories and last check, its prompts and products", async () => {
    const plan = await getShoppingPlan(BRAND);
    expect(plan.products).toBe(1240);
    expect(plan.prompts).toEqual([
      { id: 'q1', text: 'best rain jackets' },
      { id: 'q2', text: '' },
    ]);
    expect(plan.drafts[0]).toEqual({
      id: 'd1',
      title: 'Best rain jackets',
      status: 'published',
      categories: ['Outerwear > Rain Jackets'],
      shopping: expect.objectContaining({
        state: 'attention',
        readFrom: 'page',
        categoriesLinked: 0,
        bad: [{ id: 'p1', title: 'Storm Shell 2', state: 'sold_out' }],
      }),
    });
    // A row of an odd shape is read as a draft with no path.
    expect(plan.drafts[1]).toEqual({
      id: 'd2',
      title: '',
      status: 'draft',
      categories: [],
      shopping: { state: 'none' },
    });
    const filters = (table: string) =>
      calls.filter((c) => c.table === table && c.op !== 'select').map((c) => [c.op, c.args[0]]);
    expect(filters('content_drafts')).toEqual(
      expect.arrayContaining([
        ['eq', 'brand_id'],
        ['is', 'archived_at'],
      ]),
    );
    expect(filters('prompts')).toEqual(
      expect.arrayContaining([
        ['eq', 'prompt_sets.brand_id'],
        ['eq', 'is_active'],
      ]),
    );
    expect(filters('catalog_products')).toEqual(
      expect.arrayContaining([
        ['eq', 'brand_id'],
        ['is', 'removed_at'],
      ]),
    );
  });

  it('refuses a brand id that is no id, and throws a read that fails', async () => {
    await expect(getShoppingPlan('nope')).rejects.toThrow('invalid');
    tables.prompts = { error: { message: 'boom' } };
    await expect(getShoppingPlan(BRAND)).rejects.toThrow('boom');
  });
});
