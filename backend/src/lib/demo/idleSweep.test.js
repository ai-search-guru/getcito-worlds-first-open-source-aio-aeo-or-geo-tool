import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../config/supabase.js', () => ({ default: {} }));
vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { IDLE_DAYS, MAX_CLEARED, sweepIdleDemoBrands } = await import('./idleSweep.js');
const { demoState } = await import('./index.js');

/**
 * Demo brands nobody opened for IDLE_DAYS lose their sample data, not their
 * row: the next visit builds them again in place.
 */

const NOW = new Date('2026-10-28T03:00:00Z');
const daysAgo = (days) => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();

/** The brands table, enough for the sweep's reads and conditional updates. */
function fakeDb(brands, { failUpdate = false } = {}) {
  const updates = [];
  const matches = (row, filters) =>
    filters.every(([op, column, value]) => {
      if (op === 'eq') return row[column] === value;
      if (op === 'is') return row[column] === value;
      return row[column] !== null && row[column] < value;
    });
  const db = {
    updates,
    from: (table) => {
      expect(table).toBe('brands');
      const filters = [];
      let values = null;
      let limit = Infinity;
      const chain = {
        select: () => chain,
        update: (next) => {
          values = next;
          return chain;
        },
        eq: (column, value) => {
          filters.push(['eq', column, value]);
          return chain;
        },
        is: (column, value) => {
          filters.push(['is', column, value]);
          return chain;
        },
        lt: (column, value) => {
          filters.push(['lt', column, value]);
          return chain;
        },
        order: () => chain,
        limit: (n) => {
          limit = n;
          return chain;
        },
        then: (resolve, reject) => {
          const found = brands.filter((row) => matches(row, filters));
          if (values) {
            if (failUpdate) return Promise.resolve({ data: null, error: { message: 'down' } });
            for (const row of found) Object.assign(row, values);
            updates.push({ values, ids: found.map((row) => row.id) });
            return Promise.resolve({ data: found.map(({ id }) => ({ id })), error: null }).then(
              resolve,
              reject,
            );
          }
          const data = found
            .sort((a, b) => a.demo_built_at.localeCompare(b.demo_built_at))
            .slice(0, limit)
            .map((row) => ({ ...row }));
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        },
      };
      return chain;
    },
  };
  return db;
}

let brands;
beforeEach(() => {
  brands = [
    { id: 'idle', is_demo: true, demo_version: 1, demo_built_at: daysAgo(IDLE_DAYS + 3) },
    { id: 'recent', is_demo: true, demo_version: 1, demo_built_at: daysAgo(IDLE_DAYS - 1) },
    { id: 'cleared', is_demo: true, demo_version: null, demo_built_at: null },
    { id: 'real', is_demo: false, demo_version: null, demo_built_at: null },
  ];
});

describe('sweepIdleDemoBrands', () => {
  it("clears an idle demo brand's data and keeps its row, unbuilt", async () => {
    const db = fakeDb(brands);
    const clear = vi.fn(async (brandId) => {
      // Held as a build while its rows go: a visit now waits.
      const row = brands.find((brand) => brand.id === brandId);
      expect(row.demo_version).toBe(null);
      expect(demoState(row, NOW)).toBe('building');
    });

    expect(await sweepIdleDemoBrands({ db, now: NOW, clear })).toBe(1);

    expect(clear.mock.calls).toEqual([['idle']]);
    expect(brands[0]).toMatchObject({ id: 'idle', demo_version: null, demo_built_at: null });
    // The next visit rebuilds it at once.
    expect(demoState(brands[0], NOW)).toBe('stale');
    // The others are as they were.
    expect(brands[1].demo_version).toBe(1);
    expect(brands[2]).toMatchObject({ demo_version: null, demo_built_at: null });
  });

  it('leaves a brand that a visit started building meanwhile', async () => {
    const db = fakeDb(brands);
    // The visit's claim lands between the sweep's read and its own.
    const from = db.from;
    let reads = 0;
    db.from = (table) => {
      const chain = from(table);
      if (reads++ === 1) {
        Object.assign(brands[0], { demo_version: null, demo_built_at: NOW.toISOString() });
      }
      return chain;
    };
    const clear = vi.fn();

    expect(await sweepIdleDemoBrands({ db, now: NOW, clear })).toBe(0);
    expect(clear).not.toHaveBeenCalled();
  });

  it('keeps the brand held when its clear fails, and goes on to the next', async () => {
    brands.push({ id: 'idle-2', is_demo: true, demo_version: 1, demo_built_at: daysAgo(30) });
    const db = fakeDb(brands);
    const clear = vi.fn(async (brandId) => {
      if (brandId === 'idle-2') throw new Error('timeout');
    });

    expect(await sweepIdleDemoBrands({ db, now: NOW, clear })).toBe(1);
    const failed = brands.find((brand) => brand.id === 'idle-2');
    expect(failed).toMatchObject({ demo_version: null, demo_built_at: NOW.toISOString() });
    expect(brands[0]).toMatchObject({ demo_version: null, demo_built_at: null });
  });

  it('clears MAX_CLEARED brands a run at most, the oldest first', async () => {
    brands = Array.from({ length: MAX_CLEARED + 5 }, (_, i) => ({
      id: `b${i}`,
      is_demo: true,
      demo_version: 1,
      demo_built_at: daysAgo(IDLE_DAYS + 1 + i),
    }));
    const clear = vi.fn();
    expect(await sweepIdleDemoBrands({ db: fakeDb(brands), now: NOW, clear })).toBe(MAX_CLEARED);
    expect(clear.mock.calls[0]).toEqual([`b${MAX_CLEARED + 4}`]);
  });

  it('never throws: a failed read clears nothing', async () => {
    const db = {
      from: () => ({
        select: () => ({
          eq: () => ({
            lt: () => ({
              order: () => ({
                limit: async () => ({ data: null, error: { message: 'down' } }),
              }),
            }),
          }),
        }),
      }),
    };
    const clear = vi.fn();
    expect(await sweepIdleDemoBrands({ db, now: NOW, clear })).toBe(0);
    expect(clear).not.toHaveBeenCalled();
  });
});
