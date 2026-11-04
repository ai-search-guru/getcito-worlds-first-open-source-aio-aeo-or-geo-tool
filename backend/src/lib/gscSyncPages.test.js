import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Search Console page sync (AT-008, 00201) end to end over its windows:
 * a week at a time, and a backfill cut short resumes the next day after the
 * last window it read instead of starting over (#1177's review).
 */

const state = vi.hoisted(() => ({ brand: null, pulls: [], updates: [], failOn: null }));

vi.mock('./composio.js', () => ({
  isComposioConfigured: () => true,
  queryGscSearchAnalytics: async (_entity, args) => {
    if (args.dimensions[0] === 'page') state.pulls.push([args.start_date, args.end_date]);
    if (state.failOn && args.dimensions[0] === 'page' && args.start_date === state.failOn) {
      throw new Error('GSC 500');
    }
    return [];
  },
}));
vi.mock('./logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
// The brand uses the Account's Google sign-in (00470).
vi.mock('./brandIntegrations.js', () => ({
  connectedBrands: async () => [
    {
      brandId: state.brand.id,
      organizationId: 'o1',
      entityId: 'org_o1',
      composioAccountId: 'ca_1',
      connected: true,
    },
  ],
  composioTarget: (c) => ({ entityId: c.entityId, accountId: c.composioAccountId }),
}));
vi.mock('../config/supabase.js', () => ({
  default: {
    from: (table) => {
      let update = null;
      const chain = {
        select: () => chain,
        eq: () => chain,
        not: () => chain,
        in: () => chain,
        lt: () => chain,
        delete: () => chain,
        upsert: async () => ({ error: null }),
        update: (fields) => {
          update = fields;
          return chain;
        },
        then: (resolve) => {
          if (update) {
            state.updates.push(update);
            Object.assign(state.brand, update);
            return resolve({ error: null });
          }
          if (table === 'brands') return resolve({ data: [{ ...state.brand }], error: null });
          return resolve({ error: null });
        },
      };
      return chain;
    },
  },
}));

const { runGscSync, PAGE_BACKFILL_DAYS } = await import('./gscSync.js');

const day = (daysAgo, now) => new Date(now - daysAgo * 86_400_000).toISOString().slice(0, 10);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-20T06:00:00Z'));
  Object.assign(state, {
    brand: {
      id: 'b1',
      organization_id: 'o1',
      gsc_property: 'sc-domain:acme.com',
      gsc_pages_backfilled_property: null,
      gsc_pages_backfill_from: null,
    },
    pulls: [],
    updates: [],
    failOn: null,
  });
});

describe('the page sync', () => {
  it('reads a week at a time, then the backfill, and marks it through', async () => {
    const now = Date.now();
    await runGscSync({ brandId: 'b1' });
    // The last 28 days in five pulls, then 190 days back a week at a time.
    expect(state.pulls[0]).toEqual([day(6, now), day(0, now)]);
    expect(state.pulls[4]).toEqual([day(28, now), day(28, now)]);
    expect(state.pulls[5]).toEqual([day(35, now), day(29, now)]);
    expect(state.pulls.at(-1)[0]).toBe(day(PAGE_BACKFILL_DAYS, now));
    expect(state.brand).toMatchObject({
      gsc_pages_backfilled_property: 'sc-domain:acme.com',
      gsc_pages_backfill_from: null,
    });

    // The next day: the last 28 days only.
    vi.setSystemTime(new Date('2026-10-21T06:00:00Z'));
    state.pulls = [];
    await runGscSync({ brandId: 'b1' });
    expect(state.pulls).toHaveLength(5);
  });

  it('resumes a backfill cut short after the last window it read', async () => {
    const now = Date.now();
    // The fourth backfill window (57–63 days ago) fails today.
    state.failOn = day(63, now);
    await runGscSync({ brandId: 'b1' });
    expect(state.brand.gsc_pages_backfill_from).toBe(day(56, now));

    // Tomorrow it works: the recent days, then on from 57 days ago as of today.
    vi.setSystemTime(new Date('2026-10-21T06:00:00Z'));
    state.failOn = null;
    state.pulls = [];
    await runGscSync({ brandId: 'b1' });
    expect(state.pulls.slice(0, 5)).toHaveLength(5);
    expect(state.pulls[5][1]).toBe(day(57, now));
    // No backfill window read yesterday is read again.
    for (const [, end] of state.pulls.slice(5)) expect(end <= day(57, now)).toBe(true);
    expect(state.brand.gsc_pages_backfill_from).toBeNull();
  });

  it('starts over when a first sync stops in the recent days', async () => {
    state.failOn = day(13, Date.now());
    await runGscSync({ brandId: 'b1' });
    // Nothing marked: the next sync reads the property from the start. (The
    // shopping read is a step of its own, and marks its own fields.)
    expect(state.updates.filter((update) => !('gsc_shopping_synced_at' in update))).toEqual([]);
    expect(state.brand.gsc_pages_backfilled_property).toBeNull();
  });
});
