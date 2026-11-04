import { beforeEach, describe, expect, it, vi } from 'vitest';

/** setPinnedCompetitors (VIS-007) saves only the brand's own competitors, five at most. */

let owned: string[] = [];
let updated: unknown = null;
let updatedRows = 1;

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    from: (table: string) =>
      table === 'competitors'
        ? {
            select: () => ({
              eq: () => ({
                in: async (_col: string, ids: string[]) => ({
                  data: ids.filter((id) => owned.includes(id)).map((id) => ({ id })),
                  error: null,
                }),
              }),
            }),
          }
        : {
            update: (row: unknown) => {
              updated = row;
              return {
                eq: () => ({
                  select: async () => ({
                    data: Array.from({ length: updatedRows }, () => ({ id: 'b1' })),
                    error: null,
                  }),
                }),
              };
            },
          },
  })),
}));

const { setPinnedCompetitors } = await import('./brand');

describe('setPinnedCompetitors', () => {
  beforeEach(() => {
    owned = ['a', 'b', 'c', 'd', 'e', 'f'];
    updated = null;
    updatedRows = 1;
  });

  it('keeps pin order, drops duplicates and other brands’ ids, and stops at five', async () => {
    const saved = await setPinnedCompetitors('b1', ['c', 'x', 'a', 'c', 'b', 'd', 'e', 'f']);

    expect(saved).toEqual(['c', 'a', 'b', 'd', 'e']);
    expect(updated).toEqual({ insights_pinned_competitors: ['c', 'a', 'b', 'd', 'e'] });
  });

  it('clears the pins', async () => {
    expect(await setPinnedCompetitors('b1', [])).toEqual([]);
    expect(updated).toEqual({ insights_pinned_competitors: [] });
  });

  it('rejects a payload that is not a list of ids', async () => {
    await expect(setPinnedCompetitors('b1', 'abc' as unknown as string[])).rejects.toThrow(/list/);
    expect(updated).toBeNull();
  });

  it('fails when the write is denied', async () => {
    updatedRows = 0;
    await expect(setPinnedCompetitors('b1', ['a'])).rejects.toThrow(/permission/);
  });
});
