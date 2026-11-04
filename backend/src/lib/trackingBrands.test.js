import { describe, expect, it, vi } from 'vitest';

const filters = [];
vi.mock('../config/supabase.js', () => ({
  default: {
    from: (table) => {
      const chain = {
        select: (columns) => {
          filters.push(['select', table, columns]);
          return chain;
        },
        eq: (column, value) => {
          filters.push(['eq', column, value]);
          return chain;
        },
        then: (resolve) => resolve({ data: [], error: null }),
      };
      return chain;
    },
  },
}));

const { listDailyTrackingBrands } = await import('./trackingBrands.js');

describe('listDailyTrackingBrands', () => {
  it('reads the active brands, never a demo brand', async () => {
    expect(await listDailyTrackingBrands()).toEqual({ data: [], error: null });
    expect(filters).toEqual([
      ['select', 'brands', 'id, organization_id'],
      ['eq', 'is_active', true],
      ['eq', 'is_demo', false],
    ]);
  });
});
