import { beforeEach, describe, expect, it, vi } from 'vitest';

// gsc-sync imports the supabase admin client, whose config module hard-exits
// when SUPABASE_* env is absent (as in CI) — stub it before the import chain.
// The stub answers from `tables` and records each read's filters.
const calls = [];
let tables = {};
vi.mock('../config/supabase.js', () => ({
  default: {
    from: (table) => {
      const call = { table, filters: [] };
      calls.push(call);
      const filter =
        (op) =>
        (...args) => {
          call.filters.push([op, ...args]);
          return chain;
        };
      const chain = {
        select: filter('select'),
        eq: filter('eq'),
        not: filter('not'),
        in: filter('in'),
        lt: filter('lt'),
        delete: filter('delete'),
        then: (resolve, reject) =>
          Promise.resolve({ data: tables[table] ?? [], error: null }).then(resolve, reject),
      };
      return chain;
    },
  },
}));
const queryGscSearchAnalytics = vi.hoisted(() => vi.fn());
vi.mock('./composio.js', () => ({
  isComposioConfigured: () => true,
  queryGscSearchAnalytics,
}));
const activeOrgFilter = vi.hoisted(() => vi.fn());
vi.mock('./activeSubscriptions.js', () => ({ activeOrgFilter }));
const connectedBrands = vi.hoisted(() => vi.fn());
vi.mock('./brandIntegrations.js', () => ({
  connectedBrands,
  composioTarget: (c) => ({ entityId: c.entityId, accountId: c.composioAccountId }),
}));
vi.mock('./logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import {
  mapAnalyticsRows,
  mapPageRows,
  PAGE_BACKFILL_DAYS,
  PAGE_WINDOW_DAYS,
  pageWindows,
  pagesSyncPlan,
  runGscSync,
} from './gscSync.js';

describe('mapAnalyticsRows', () => {
  it('maps GSC rows keyed by [query, date] into table rows', () => {
    const rows = mapAnalyticsRows('brand-1', [
      {
        keys: ['best aeo tool', '2026-08-01'],
        clicks: 3,
        impressions: 120,
        ctr: 0.025,
        position: 7.4,
      },
      { keys: ['ai visibility', '2026-08-02'], clicks: 0, impressions: 40, ctr: 0, position: 12.1 },
    ]);
    expect(rows).toEqual([
      {
        brand_id: 'brand-1',
        query: 'best aeo tool',
        date: '2026-08-01',
        clicks: 3,
        impressions: 120,
        ctr: 0.025,
        position: 7.4,
      },
      {
        brand_id: 'brand-1',
        query: 'ai visibility',
        date: '2026-08-02',
        clicks: 0,
        impressions: 40,
        ctr: 0,
        position: 12.1,
      },
    ]);
  });

  it('drops malformed rows and defaults missing metrics to zero', () => {
    const rows = mapAnalyticsRows('brand-1', [
      { keys: ['only-query'] },
      { keys: [] },
      {},
      { keys: ['ok', '2026-08-01'] },
    ]);
    expect(rows).toEqual([
      {
        brand_id: 'brand-1',
        query: 'ok',
        date: '2026-08-01',
        clicks: 0,
        impressions: 0,
        ctr: 0,
        position: 0,
      },
    ]);
  });

  it('rounds fractional click/impression counts from aggregated responses', () => {
    const rows = mapAnalyticsRows('b', [
      { keys: ['q', '2026-08-01'], clicks: 2.6, impressions: 99.4, ctr: 0.1, position: 3 },
    ]);
    expect(rows[0].clicks).toBe(3);
    expect(rows[0].impressions).toBe(99);
  });

  it('handles an empty or missing rows array', () => {
    expect(mapAnalyticsRows('b', [])).toEqual([]);
    expect(mapAnalyticsRows('b', undefined)).toEqual([]);
  });
});

describe('mapPageRows', () => {
  it('maps GSC rows keyed by [page, date] into gsc_page_stats rows (AT-008)', () => {
    expect(
      mapPageRows('brand-1', [
        {
          keys: ['https://acme.example/blog/x', '2026-08-01'],
          clicks: 4.4,
          impressions: 300,
          ctr: 0.015,
          position: 5.2,
        },
        { keys: ['https://acme.example/'] },
      ]),
    ).toEqual([
      {
        brand_id: 'brand-1',
        page: 'https://acme.example/blog/x',
        date: '2026-08-01',
        clicks: 4,
        impressions: 300,
        ctr: 0.015,
        position: 5.2,
      },
    ]);
  });
});

describe('pageWindows', () => {
  it('reads a week at a time, newest first, with no gap', () => {
    const windows = pageWindows(29, PAGE_BACKFILL_DAYS);
    expect(windows[0]).toEqual({ from: 35, to: 29 });
    expect(windows.at(-1).from).toBe(PAGE_BACKFILL_DAYS);
    for (let i = 1; i < windows.length; i++) {
      expect(windows[i].to).toBe(windows[i - 1].from + 1);
      expect(windows[i].from - windows[i].to + 1).toBeLessThanOrEqual(PAGE_WINDOW_DAYS);
    }
  });

  it('reads the last 28 days in five windows, today included', () => {
    expect(pageWindows(0, 28)).toEqual([
      { from: 6, to: 0 },
      { from: 13, to: 7 },
      { from: 20, to: 14 },
      { from: 27, to: 21 },
      { from: 28, to: 28 },
    ]);
  });
});

describe('pagesSyncPlan', () => {
  const property = 'sc-domain:acme.com';
  const now = Date.parse('2026-10-20T06:00:00Z');
  const recent = pageWindows(0, 28);

  it("reads a new property's 190 days after its last 28, and starts its backfill", () => {
    const plan = pagesSyncPlan(
      {
        gsc_property: property,
        gsc_pages_backfilled_property: null,
        gsc_pages_backfill_from: null,
      },
      now,
    );
    expect(plan).toEqual({
      recent,
      backfill: pageWindows(29, PAGE_BACKFILL_DAYS),
      start: true,
      dropOldPages: false,
    });
  });

  it('reads only the last 28 days once the backfill is through', () => {
    expect(
      pagesSyncPlan(
        {
          gsc_property: property,
          gsc_pages_backfilled_property: property,
          gsc_pages_backfill_from: null,
        },
        now,
      ),
    ).toEqual({ recent, backfill: [], start: false, dropOldPages: false });
  });

  // gkhngyk on #1177: the backfill restarted from the newest window, so one
  // window that kept failing made every run read the whole history again.
  it('resumes a backfill the day after the last window it read', () => {
    // A sync read back to 2026-08-21 (60 days ago) and stopped.
    const plan = pagesSyncPlan(
      {
        gsc_property: property,
        gsc_pages_backfilled_property: property,
        gsc_pages_backfill_from: '2026-08-21',
      },
      now,
    );
    expect(plan.start).toBe(false);
    expect(plan.backfill[0]).toEqual({ from: 67, to: 61 });
    expect(plan.backfill.at(-1).from).toBe(PAGE_BACKFILL_DAYS);
  });

  it('reads nothing more once the backfill reached its 190 days', () => {
    const plan = pagesSyncPlan(
      {
        gsc_property: property,
        gsc_pages_backfilled_property: property,
        gsc_pages_backfill_from: '2026-04-13',
      },
      now,
    );
    expect(plan.backfill).toEqual([]);
  });

  it("drops the old property's pages before reading a new one's", () => {
    expect(
      pagesSyncPlan(
        {
          gsc_property: property,
          gsc_pages_backfilled_property: 'https://old.example/',
          gsc_pages_backfill_from: '2026-09-01',
        },
        now,
      ),
    ).toEqual({
      recent,
      backfill: pageWindows(29, PAGE_BACKFILL_DAYS),
      start: true,
      dropOldPages: true,
    });
  });
});

/**
 * The brands whose Google sign-in is live (00470: the one each brand uses,
 * the Account's for every brand until one picks its own). Once an
 * organization's plan has ended (2026-10-27), the nightly sync leaves it
 * out: nothing is read from Search Console for it.
 */
describe('runGscSync', () => {
  const uses = (brandId, organizationId) => ({
    brandId,
    organizationId,
    entityId: `org_${organizationId}`,
    composioAccountId: `ca_${organizationId}`,
    connected: true,
  });

  beforeEach(() => {
    calls.length = 0;
    tables = { brands: [] };
    queryGscSearchAnalytics.mockReset().mockResolvedValue([]);
    connectedBrands
      .mockReset()
      .mockResolvedValue([uses('b1', 'paying'), uses('b2', 'lapsed'), uses('b3', 'paying')]);
    activeOrgFilter.mockReset().mockResolvedValue((orgId) => orgId === 'paying');
  });

  it('syncs only the brands of organizations still on a plan', async () => {
    await runGscSync();

    expect(connectedBrands).toHaveBeenCalledWith('google-search-console', {
      organizationId: undefined,
      brandId: undefined,
    });
    expect(activeOrgFilter).toHaveBeenCalledWith(['paying', 'lapsed']);
    const brands = calls.find((call) => call.table === 'brands');
    expect(brands.filters).toContainEqual(['in', 'id', ['b1', 'b3']]);
    // Never a demo brand (00380).
    expect(brands.filters).toContainEqual(['eq', 'is_demo', false]);
  });

  it('reads Search Console with the sign-in the brand uses, by its connected account', async () => {
    tables.brands = [
      {
        id: 'b1',
        organization_id: 'paying',
        gsc_property: 'sc-domain:acme.com',
        gsc_pages_backfilled_property: 'sc-domain:acme.com',
        gsc_pages_backfill_from: null,
        gsc_shopping_property: 'sc-domain:acme.com',
      },
    ];
    await runGscSync({ brandId: 'b1' });
    expect(connectedBrands).toHaveBeenCalledWith('google-search-console', {
      organizationId: undefined,
      brandId: 'b1',
    });
    expect(queryGscSearchAnalytics).toHaveBeenCalled();
    for (const [target, args] of queryGscSearchAnalytics.mock.calls) {
      expect(target).toEqual({ entityId: 'org_paying', accountId: 'ca_paying' });
      expect(args.site_url).toBe('sc-domain:acme.com');
    }
  });

  it('reads no brand when no brand’s sign-in is live', async () => {
    connectedBrands.mockResolvedValue([]);

    expect(await runGscSync()).toEqual({ synced: 0, skipped: 0, results: [] });
    expect(calls.some((call) => call.table === 'brands')).toBe(false);
  });

  it('reads no brand when no connected organization is on a plan', async () => {
    activeOrgFilter.mockResolvedValue(() => false);

    expect(await runGscSync()).toEqual({ synced: 0, skipped: 0, results: [] });
    expect(calls.some((call) => call.table === 'brands')).toBe(false);
  });
});
