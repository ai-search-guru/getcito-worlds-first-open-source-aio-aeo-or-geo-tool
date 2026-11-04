import { beforeEach, describe, expect, it, vi } from 'vitest';

// The module imports the supabase admin client, whose config hard-exits when
// SUPABASE_* env is absent (as in CI) — stub it before the import chain. The
// stub records deletes and their filters, and answers reads from `tables`.
const deletes = [];
const calls = [];
let deleteError = null;
let tables = {};
vi.mock('../config/supabase.js', () => ({
  default: {
    from: (table) => {
      const call = { table, filters: [] };
      calls.push(call);
      const filter = (op) => (col, val) => {
        call.filters.push([op, col, val]);
        return chain;
      };
      const chain = {
        delete: () => {
          deletes.push(call);
          return chain;
        },
        select: () => chain,
        eq: filter('eq'),
        is: filter('is'),
        gte: filter('gte'),
        lte: filter('lte'),
        lt: filter('lt'),
        in: filter('in'),
        not: filter('not'),
        limit: () => chain,
        upsert: async () => ({ error: null }),
        then: (resolve) => resolve({ data: tables[table] ?? [], error: deleteError }),
      };
      return chain;
    },
  },
}));
const runGaReport = vi.hoisted(() => vi.fn());
vi.mock('./composio.js', () => ({ isComposioConfigured: () => true, runGaReport }));
const activeOrgFilter = vi.hoisted(() => vi.fn());
vi.mock('./activeSubscriptions.js', () => ({ activeOrgFilter }));
const connectedBrands = vi.hoisted(() => vi.fn());
vi.mock('./brandIntegrations.js', () => ({
  connectedBrands,
  composioTarget: (c) => ({ entityId: c.entityId, accountId: c.composioAccountId }),
}));

import { AI_SOURCES_VERSION } from './aiSources.js';
import { GA_AI_SOURCE_PATTERN, classifyGaSource, gaAiPlatform } from './gaSources.js';
import {
  GA_AI_FILTER,
  aiReportDays,
  dayRange,
  deleteRowsWithoutMedium,
  gaDateToIso,
  mapAiTrafficRows,
  mapChannelRows,
  mapItemRows,
  mapPageRows,
  readReportRows,
  runGaSync,
  unclassifiedSources,
} from './gaSync.js';

/**
 * GA4 traffic sync mapping (#704).
 *
 * Everything here is the part of the sync that turns a GA4 report into rows —
 * the half that can be wrong without anything failing, since a mis-parsed
 * report still upserts cleanly and only shows up as numbers nobody can
 * reconcile later.
 */

const report = ({ dims, metrics, rows }) => ({
  dimensionHeaders: dims.map((name) => ({ name })),
  metricHeaders: metrics.map((name) => ({ name })),
  rows: rows.map((row) => ({
    dimensionValues: row.slice(0, dims.length).map((value) => ({ value })),
    metricValues: row.slice(dims.length).map((value) => ({ value })),
  })),
});

const TRAFFIC_METRICS = [
  'sessions',
  'engagedSessions',
  'keyEvents',
  'totalUsers',
  'transactions',
  'purchaseRevenue',
  'userEngagementDuration',
];

describe('classifyGaSource', () => {
  it('collapses an engine’s several source strings onto one platform', () => {
    // All three arrive from the same product in real data.
    expect(classifyGaSource('chatgpt.com')).toBe('chatgpt.com');
    expect(classifyGaSource('chatgpt')).toBe('chatgpt.com');
    expect(classifyGaSource('openai')).toBe('chatgpt.com');
  });

  it('matches case-insensitively and ignores surrounding whitespace', () => {
    expect(classifyGaSource('  Perplexity.AI ')).toBe('perplexity.ai');
  });

  it('does not match a host that merely contains an engine name', () => {
    // The case that motivated an explicit list: a workers.dev subdomain with
    // "claude" in it is an ordinary referrer, not AI traffic.
    expect(classifyGaSource('claude-proxy.example.workers.dev')).toBeNull();
    expect(classifyGaSource('notchatgpt.com')).toBeNull();
  });

  it('returns null for GA placeholders and non-strings', () => {
    expect(classifyGaSource('(direct)')).toBeNull();
    expect(classifyGaSource('(not set)')).toBeNull();
    expect(classifyGaSource(undefined)).toBeNull();
  });

  it('matches a subdomain of a listed host (AT-004)', () => {
    expect(classifyGaSource('m.perplexity.ai')).toBe('perplexity.ai');
    expect(classifyGaSource('search.chatgpt.com')).toBe('chatgpt.com');
    expect(classifyGaSource('chat.deepseek.com')).toBe('deepseek.com');
  });

  it("doesn't count Bing: without the snippet's /ck/a path, a GA4 source can't tell Copilot from search", () => {
    expect(classifyGaSource('bing.com')).toBeNull();
    expect(classifyGaSource('bing')).toBeNull();
  });
});

describe('gaAiPlatform', () => {
  it("names a session GA4's AI Assistant channel holds but the list doesn't know by its source", () => {
    expect(gaAiPlatform('chat.mistral.ai', 'AI Assistant')).toBe('chat.mistral.ai');
    expect(gaAiPlatform('www.Mistral.ai', 'AI Assistant')).toBe('mistral.ai');
    expect(gaAiPlatform('(not set)', 'AI Assistant')).toBeNull();
  });

  it('prefers the list, and leaves an unknown source outside the channel unnamed', () => {
    expect(gaAiPlatform('chatgpt.com', 'Referral')).toBe('chatgpt.com');
    expect(gaAiPlatform('example.com', 'Referral')).toBeNull();
  });
});

describe('the AI report request', () => {
  it("asks for a source on the list or GA4's AI Assistant channel", () => {
    expect(GA_AI_FILTER.orGroup.expressions).toEqual([
      {
        filter: {
          fieldName: 'sessionSource',
          stringFilter: {
            matchType: 'FULL_REGEXP',
            value: GA_AI_SOURCE_PATTERN,
            caseSensitive: false,
          },
        },
      },
      {
        filter: {
          fieldName: 'sessionDefaultChannelGroup',
          stringFilter: { matchType: 'EXACT', value: 'AI Assistant' },
        },
      },
    ]);
  });

  it('reads as far back as storage keeps on a first sync or a history backfill, else the last days', () => {
    expect(aiReportDays({ first: true })).toHaveLength(401);
    expect(aiReportDays({ first: false, aiHistory: true })).toHaveLength(401);
    expect(aiReportDays({ first: false })).toHaveLength(4);
  });
});

describe('gaDateToIso', () => {
  it('converts GA4’s compact date to a storable one', () => {
    expect(gaDateToIso('20260721')).toBe('2026-07-21');
  });

  it('rejects anything that is not eight digits', () => {
    expect(gaDateToIso('2026-07-21')).toBeNull();
    expect(gaDateToIso('(other)')).toBeNull();
    expect(gaDateToIso(undefined)).toBeNull();
  });
});

describe('readReportRows', () => {
  it('reads values by header name rather than by position', () => {
    // GA4 echoes the requested order, but reading positionally would write
    // sessions into the revenue column if it ever stopped doing so, and
    // nothing downstream could tell.
    const swapped = report({
      dims: ['date'],
      metrics: ['purchaseRevenue', 'sessions'],
      rows: [['20260721', '99.5', '4']],
    });

    expect(readReportRows(swapped)[0]).toEqual({
      date: '20260721',
      purchaseRevenue: '99.5',
      sessions: '4',
    });
  });

  it('returns an empty list for a report with no rows', () => {
    expect(readReportRows({ dimensionHeaders: [], metricHeaders: [] })).toEqual([]);
    expect(readReportRows(undefined)).toEqual([]);
  });
});

describe('mapAiTrafficRows', () => {
  const AI_DIMS = ['date', 'sessionSource', 'landingPage', 'landingPagePlusQueryString'];
  const raw = report({
    dims: ['date', 'sessionSource', 'sessionMedium', 'landingPage', 'landingPagePlusQueryString'],
    metrics: TRAFFIC_METRICS,
    rows: [
      [
        '20260721',
        'chatgpt.com',
        'referral',
        '/pricing',
        '/pricing?ref=x',
        '10',
        '3',
        '1',
        '9',
        '2',
        '149.9',
        '106',
      ],
    ],
  });

  it('maps a row onto its storage columns', () => {
    expect(mapAiTrafficRows('brand-1', raw)).toEqual([
      {
        brand_id: 'brand-1',
        date: '2026-07-21',
        source: 'chatgpt.com',
        platform: 'chatgpt.com',
        medium: 'referral',
        // A ChatGPT answer's link, not a ChatGPT Shopping card (#1283).
        surface: null,
        landing_page: '/pricing',
        landing_page_query: '/pricing?ref=x',
        sessions: 10,
        engaged_sessions: 3,
        key_events: 1,
        // No session key event rate in this report: none counted.
        key_event_sessions: 0,
        total_users: 9,
        transactions: 2,
        purchase_revenue: 149.9,
        engagement_duration_seconds: 106,
        source_list_version: AI_SOURCES_VERSION,
      },
    ]);
  });

  it('sums one source split across channels back into one row (AT-004)', () => {
    const split = report({
      dims: [
        'date',
        'sessionSource',
        'sessionDefaultChannelGroup',
        'landingPage',
        'landingPagePlusQueryString',
      ],
      metrics: TRAFFIC_METRICS,
      rows: [
        ['20260721', 'chatgpt.com', 'Referral', '/a', '/a', '4', '2', '1', '4', '0', '10', '30'],
        [
          '20260721',
          'chatgpt.com',
          'AI Assistant',
          '/a',
          '/a',
          '6',
          '3',
          '0',
          '6',
          '1',
          '5.5',
          '60',
        ],
        [
          '20260721',
          'chat.mistral.ai',
          'AI Assistant',
          '/a',
          '/a',
          '2',
          '1',
          '0',
          '2',
          '0',
          '0',
          '8',
        ],
      ],
    });

    const rows = mapAiTrafficRows('brand-1', split);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      source: 'chatgpt.com',
      platform: 'chatgpt.com',
      sessions: 10,
      engaged_sessions: 5,
      key_events: 1,
      total_users: 10,
      transactions: 1,
      purchase_revenue: 15.5,
      engagement_duration_seconds: 90,
    });
    // An assistant only GA4's channel knows, under its own name.
    expect(rows[1]).toMatchObject({ source: 'chat.mistral.ai', platform: 'chat.mistral.ai' });
  });

  it('keeps the path separately from the full entry URL', () => {
    // The path is what joins ga_page_stats, which drops query strings to stay
    // a manageable size; the full URL is what attribution needs.
    const [row] = mapAiTrafficRows('brand-1', raw);
    expect(row.landing_page).toBe('/pricing');
    expect(row.landing_page_query).toBe('/pricing?ref=x');
  });

  // #1283: ChatGPT Shopping's feed links are tagged utm_medium=feed.
  it("marks ChatGPT's sessions with medium feed as ChatGPT Shopping, in rows of their own", () => {
    const rows = mapAiTrafficRows(
      'brand-1',
      report({
        dims: [
          'date',
          'sessionSource',
          'sessionMedium',
          'landingPage',
          'landingPagePlusQueryString',
        ],
        metrics: TRAFFIC_METRICS,
        rows: [
          ['20260721', 'chatgpt.com', 'feed', '/mug', '/mug', '4', '3', '1', '4', '1', '20', '50'],
          [
            '20260721',
            'chatgpt.com',
            'referral',
            '/mug',
            '/mug',
            '6',
            '2',
            '0',
            '6',
            '0',
            '0',
            '40',
          ],
          ['20260721', 'chatgpt', 'Feed', '/cup', '/cup', '1', '1', '0', '1', '0', '0', '9'],
          ['20260721', 'perplexity.ai', 'feed', '/mug', '/mug', '2', '1', '0', '2', '0', '0', '8'],
        ],
      }),
    );
    expect(rows.map((r) => [r.platform, r.medium, r.surface, r.landing_page, r.sessions])).toEqual([
      // Still ChatGPT's sessions, apart from its answers' on the same page.
      ['chatgpt.com', 'feed', 'shopping', '/mug', 4],
      ['chatgpt.com', 'referral', null, '/mug', 6],
      // GA4's other name for ChatGPT, and the medium in another case.
      ['chatgpt.com', 'Feed', 'shopping', '/cup', 1],
      ['perplexity.ai', 'feed', null, '/mug', 2],
    ]);
  });

  it('keeps the raw source when it cannot be classified', () => {
    const unknown = report({
      dims: AI_DIMS,
      metrics: TRAFFIC_METRICS,
      rows: [['20260721', 'some-new-assistant.ai', '/', '/', '3', '1', '0', '3', '0', '0', '12']],
    });

    const [row] = mapAiTrafficRows('brand-1', unknown);
    expect(row.source).toBe('some-new-assistant.ai');
    expect(row.platform).toBeNull();
  });

  it('keeps an empty landing page instead of dropping the row', () => {
    // GA4 reports a blank landing page for sessions it cannot attribute to
    // one; those sessions still happened.
    const blank = report({
      dims: AI_DIMS,
      metrics: TRAFFIC_METRICS,
      rows: [['20260721', 'chatgpt.com', '', '', '5', '2', '0', '5', '0', '0', '30']],
    });

    expect(mapAiTrafficRows('brand-1', blank)[0].landing_page).toBe('');
  });

  it('drops rows whose date is unusable rather than storing a null date', () => {
    const broken = report({
      dims: AI_DIMS,
      metrics: TRAFFIC_METRICS,
      rows: [['(other)', 'chatgpt.com', '/', '/', '5', '2', '0', '5', '0', '0', '30']],
    });

    expect(mapAiTrafficRows('brand-1', broken)).toEqual([]);
  });

  it('treats missing or non-numeric metrics as zero', () => {
    const messy = report({
      dims: AI_DIMS,
      metrics: TRAFFIC_METRICS,
      rows: [['20260721', 'chatgpt.com', '/', '/', '4', '', 'n/a', '4', '', '', '']],
    });

    const [row] = mapAiTrafficRows('brand-1', messy);
    expect(row.sessions).toBe(4);
    expect(row.key_events).toBe(0);
    expect(row.purchase_revenue).toBe(0);
  });
});

describe('deleteRowsWithoutMedium', () => {
  beforeEach(() => {
    deletes.length = 0;
    deleteError = null;
  });

  it("deletes the brand's rows from before the medium was read, on the days re-read (00251)", async () => {
    await deleteRowsWithoutMedium('brand-1', { from: '2026-10-20', to: '2026-10-23' });
    expect(deletes).toEqual([
      {
        table: 'ga_ai_traffic_stats',
        filters: [
          ['eq', 'brand_id', 'brand-1'],
          ['is', 'medium', null],
          ['gte', 'date', '2026-10-20'],
          ['lte', 'date', '2026-10-23'],
        ],
      },
    ]);
  });

  it('fails the sync when the delete fails, rather than counting those days twice', async () => {
    deleteError = { message: 'permission denied' };
    await expect(
      deleteRowsWithoutMedium('brand-1', { from: '2026-10-20', to: '2026-10-23' }),
    ).rejects.toThrow('permission denied');
  });
});

describe('mapPageRows', () => {
  it('maps landing-page totals without a source column', () => {
    const raw = report({
      dims: ['date', 'landingPage'],
      metrics: TRAFFIC_METRICS,
      rows: [['20260810', '/', '29', '21', '2', '23', '1', '80', '3407']],
    });

    expect(mapPageRows('brand-1', raw)).toEqual([
      {
        brand_id: 'brand-1',
        date: '2026-08-10',
        landing_page: '/',
        sessions: 29,
        engaged_sessions: 21,
        key_events: 2,
        key_event_sessions: 0,
        total_users: 23,
        transactions: 1,
        purchase_revenue: 80,
        engagement_duration_seconds: 3407,
      },
    ]);
  });
});

describe('sessions with a key event (AT-005)', () => {
  const withRate = (rows) =>
    report({
      dims: ['date', 'sessionDefaultChannelGroup'],
      metrics: ['sessions', 'keyEvents', 'sessionKeyEventRate'],
      rows,
    });

  it("counts them from GA4's session key event rate, so a rate can be taken over any range", () => {
    // 40 sessions, 12 key events, but only a quarter of the sessions had one.
    const [row] = mapChannelRows(
      'brand-1',
      withRate([['20260721', 'Organic Search', '40', '12', '0.25']]),
    );
    expect(row).toMatchObject({ sessions: 40, key_events: 12, key_event_sessions: 10 });
  });

  it('rounds to whole sessions, and reads a missing rate as none', () => {
    const rows = mapChannelRows(
      'brand-1',
      withRate([
        ['20260721', 'Direct', '3', '1', '0.3333333'],
        ['20260721', 'Referral', '5', '0', ''],
      ]),
    );
    expect(rows.map((r) => r.key_event_sessions)).toEqual([1, 0]);
  });
});

describe('mapChannelRows', () => {
  it('stores sessions per day and default channel group', () => {
    const rows = mapChannelRows(
      'brand-1',
      report({
        dims: ['date', 'sessionDefaultChannelGroup'],
        metrics: TRAFFIC_METRICS,
        rows: [
          ['20260721', 'Organic Search', '500', '300', '20', '450', '3', '99.5', '9000'],
          ['20260721', '', '7', '1', '0', '7', '0', '0', '30'],
          ['(other)', 'Direct', '9', '1', '0', '9', '0', '0', '30'],
        ],
      }),
    );
    expect(rows).toEqual([
      {
        brand_id: 'brand-1',
        date: '2026-07-21',
        channel: 'Organic Search',
        sessions: 500,
        engaged_sessions: 300,
        key_events: 20,
        key_event_sessions: 0,
        total_users: 450,
        transactions: 3,
        purchase_revenue: 99.5,
        engagement_duration_seconds: 9000,
      },
      expect.objectContaining({ channel: '(not set)', sessions: 7 }),
    ]);
  });
});

describe('mapItemRows', () => {
  it('maps product rows', () => {
    const raw = report({
      dims: ['date', 'itemName', 'itemId', 'itemCategory'],
      metrics: ['itemsViewed', 'itemsAddedToCart', 'itemsPurchased', 'itemRevenue'],
      rows: [['20260721', 'Blue Shirt', 'SKU-1', 'Apparel', '40', '7', '3', '89.7']],
    });

    expect(mapItemRows('brand-1', raw)).toEqual([
      {
        brand_id: 'brand-1',
        date: '2026-07-21',
        item_id: 'SKU-1',
        item_name: 'Blue Shirt',
        item_category: 'Apparel',
        items_viewed: 40,
        items_added_to_cart: 7,
        items_purchased: 3,
        item_revenue: 89.7,
      },
    ]);
  });

  it('returns nothing for a property without ecommerce, which is not an error', () => {
    expect(mapItemRows('brand-1', { dimensionHeaders: [], metricHeaders: [], rows: [] })).toEqual(
      [],
    );
  });
});

describe('dayRange', () => {
  it('covers today plus the requested number of days back, newest first', () => {
    const days = dayRange(3);
    expect(days).toHaveLength(4);
    expect(new Date(days[0]).getTime()).toBeGreaterThan(new Date(days[3]).getTime());
  });

  it('still returns today when asked for zero days back', () => {
    expect(dayRange(0)).toHaveLength(1);
  });

  it('returns each day exactly once, so no day is fetched twice', () => {
    const days = dayRange(90);
    expect(new Set(days).size).toBe(91);
  });
});

describe('unclassifiedSources', () => {
  const raw = report({
    dims: ['sessionSource'],
    metrics: ['sessions'],
    rows: [
      ['(direct)', '1477'],
      ['google', '367'],
      ['chatgpt.com', '47'],
      ['some-new-assistant.ai', '9'],
    ],
  });

  it('reports unknown sources ordered by sessions, excluding known ones', () => {
    expect(unclassifiedSources(raw, { limit: 3 })).toEqual([
      { source: '(direct)', sessions: 1477 },
      { source: 'google', sessions: 367 },
      { source: 'some-new-assistant.ai', sessions: 9 },
    ]);
  });

  it('honours the session floor', () => {
    expect(unclassifiedSources(raw, { minSessions: 400 })).toEqual([
      { source: '(direct)', sessions: 1477 },
    ]);
  });
});

/**
 * The brands whose Google sign-in is live (00470: the one each brand uses,
 * the Account's for every brand until one picks its own). Once an
 * organization's plan has ended (2026-10-27), the nightly sync leaves it
 * out: nothing is read from Analytics for it.
 */
describe('runGaSync', () => {
  const uses = (brandId, organizationId) => ({
    brandId,
    organizationId,
    entityId: `org_${organizationId}`,
    composioAccountId: `ca_${organizationId}`,
    connected: true,
  });

  beforeEach(() => {
    calls.length = 0;
    deleteError = null;
    tables = { brands: [] };
    runGaReport.mockReset();
    connectedBrands
      .mockReset()
      .mockResolvedValue([uses('b1', 'paying'), uses('b2', 'lapsed'), uses('b3', 'paying')]);
    activeOrgFilter.mockReset().mockResolvedValue((orgId) => orgId === 'paying');
  });

  it('syncs only the brands of organizations still on a plan', async () => {
    await runGaSync();

    expect(connectedBrands).toHaveBeenCalledWith('google-analytics', {
      organizationId: undefined,
      brandId: undefined,
    });
    expect(activeOrgFilter).toHaveBeenCalledWith(['paying', 'lapsed']);
    const brands = calls.find((call) => call.table === 'brands');
    expect(brands.filters).toContainEqual(['in', 'id', ['b1', 'b3']]);
    // Never a demo brand (00380).
    expect(brands.filters).toContainEqual(['eq', 'is_demo', false]);
  });

  it('passes on the organization or brand it was asked for', async () => {
    await runGaSync({ organizationId: 'paying' });
    expect(connectedBrands).toHaveBeenLastCalledWith('google-analytics', {
      organizationId: 'paying',
      brandId: undefined,
    });
    await runGaSync({ brandId: 'b1' });
    expect(connectedBrands).toHaveBeenLastCalledWith('google-analytics', {
      organizationId: undefined,
      brandId: 'b1',
    });
  });

  it('reads Analytics with the sign-in the brand uses, by its connected account', async () => {
    tables.brands = [{ id: 'b1', organization_id: 'paying', ga_property_id: '123' }];
    runGaReport.mockResolvedValue({ rows: [], rowCount: 0 });
    await runGaSync({ brandId: 'b1' });
    expect(runGaReport).toHaveBeenCalled();
    for (const [target, property] of runGaReport.mock.calls) {
      expect(target).toEqual({ entityId: 'org_paying', accountId: 'ca_paying' });
      expect(property).toBe('123');
    }
  });

  it('reads no brand when no connected organization is on a plan', async () => {
    activeOrgFilter.mockResolvedValue(() => false);

    expect(await runGaSync()).toEqual({ synced: 0, skipped: 0, results: [] });
    expect(calls.some((call) => call.table === 'brands')).toBe(false);
  });

  it('reads no brand when no brand’s sign-in is live', async () => {
    connectedBrands.mockResolvedValue([]);

    expect(await runGaSync()).toEqual({ synced: 0, skipped: 0, results: [] });
    expect(calls.some((call) => call.table === 'brands')).toBe(false);
  });
});
