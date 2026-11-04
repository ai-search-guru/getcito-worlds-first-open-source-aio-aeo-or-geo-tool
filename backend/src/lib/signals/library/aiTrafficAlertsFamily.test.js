import { describe, expect, it, vi } from 'vitest';

/**
 * AI Traffic Analytics' alerts (AT-013, spec §3.8): AI visits down 40% week
 * over week from at least 30, the pages AI visitors landed on that don't
 * exist (AT-012), and the cited pages no AI search bot read in 30 days
 * (AT-011).
 */

const rpc = vi.fn();
vi.mock('../../../config/supabase.js', () => ({
  default: { from: vi.fn(), rpc: (...args) => rpc(...args) },
}));
const logger = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('../../logger.js', () => ({ logger }));

const { DataNotWhole, LIBRARY_FAMILIES, LIBRARY_EMITTED_KINDS, libraryCandidates, weeklyWindows } =
  await import('./detect.js');

const family = (name) => LIBRARY_FAMILIES.find((f) => f.name === name);

const week = (visits, pages = [], over = {}) => ({ visits, pages, analytics_days: 0, ...over });

const alerts = ({ cur, prev, broken = { count: 0, rows: [] } }) =>
  family('aiTrafficAlerts').run({
    brandId: 'b1',
    now: new Date('2026-10-19T06:00:00Z'),
    weeklyVisits: async () => ({ cur, prev }),
    brokenLinks: async () => broken,
  });

describe('the AI Traffic alerts family', () => {
  it('raises a week-over-week drop of 40% from at least 30 visits, with the pages that fell', async () => {
    const found = await alerts({
      prev: week(50, [
        { page: '/menu', visits: 30 },
        { page: '/Gifts', visits: 12 },
        { page: '/about', visits: 8 },
      ]),
      cur: week(28, [
        { page: '/menu', visits: 12 },
        { page: '/gifts', visits: 12 },
        { page: '/blog', visits: 4 },
      ]),
    });

    expect(found).toEqual([
      {
        kind: 'ai_visits_weekly_drop',
        dedupKey: 'ai_visits_weekly_drop',
        source: ['ai_results'],
        payload: {
          entity: 'pages',
          targets: [
            { id: '/menu', label: '/menu', before: 30, now: 12 },
            { id: '/about', label: '/about', before: 8, now: 0 },
          ],
          pageCount: 2,
        },
        previousValue: 50,
        currentValue: 28,
        changeValue: -22,
      },
    ]);
  });

  it('stays quiet under 40%, or below 30 visits the week before', async () => {
    expect(await alerts({ prev: week(50), cur: week(31) })).toEqual([]);
    // 29 → 0 is a fall of 100%, but from a Low sample.
    expect(await alerts({ prev: week(29), cur: week(0) })).toEqual([]);
    // Exactly 40% from exactly 30 is enough.
    expect((await alerts({ prev: week(30), cur: week(18) })).map((f) => f.kind)).toEqual([
      'ai_visits_weekly_drop',
    ]);
  });

  it('says Analytics when either week read it', async () => {
    const [found] = await alerts({
      // ai_traffic_merged's analytics_days is the list of days (00176).
      prev: week(40, [], { analytics_days: ['2026-10-06', '2026-10-07', '2026-10-08'] }),
      cur: week(10),
    });
    expect(found.source).toEqual(['ga4']);
  });

  it('lists the broken AI links with what visitors got and where to redirect them', async () => {
    const found = await alerts({
      prev: week(0),
      cur: week(0),
      broken: {
        count: 7,
        rows: [
          {
            page: '/guides/espresso-machine-for-beginner',
            visits: 3,
            platforms: ['chatgpt.com'],
            citations: 12,
            last_visit: '2026-10-19T05:00:00Z',
            status: '404',
            target: '/guides/espresso-machines-for-beginners',
            target_reason: 'similar',
          },
          {
            page: '/',
            visits: '3',
            platforms: [],
            citations: null,
            status: 'title',
            target: null,
            target_reason: null,
          },
        ],
      },
    });

    expect(found).toEqual([
      {
        kind: 'broken_citation_target',
        dedupKey: 'broken_citation_target',
        source: ['ai_results'],
        payload: {
          entity: 'pages',
          targets: [
            {
              id: '/guides/espresso-machine-for-beginner',
              label: '/guides/espresso-machine-for-beginner',
              visits: 3,
              status: '404',
              citations: 12,
              redirectTo: '/guides/espresso-machines-for-beginners',
            },
            {
              id: '/',
              label: '/',
              visits: 3,
              status: 'title',
              citations: 0,
              redirectTo: null,
            },
          ],
        },
        previousValue: null,
        // Every broken link, not only the 50 named.
        currentValue: 7,
        changeValue: null,
      },
    ]);
  });

  it('needs a citation, or a few visits, before a missing page raises it', async () => {
    const row = (page, visits, citations) => ({
      page,
      visits,
      platforms: [],
      citations,
      status: '404',
      target: null,
      target_reason: null,
    });
    const [found] = await alerts({
      prev: week(0),
      cur: week(0),
      broken: {
        count: 3,
        rows: [
          // Cited by AI answers: tracking says so, not the public beacon.
          row('/cited', 1, 4),
          // One visit to a page no answer cites: stray, or made up.
          row('/one-visit', 1, 0),
          row('/three-visits', 3, 0),
        ],
      },
    });
    expect(found.payload.targets.map((p) => p.id)).toEqual(['/cited', '/three-visits']);
    expect(found.currentValue).toBe(2);

    expect(
      await alerts({ prev: week(0), cur: week(0), broken: { count: 1, rows: [row('/x', 2, 0)] } }),
    ).toEqual([]);
  });

  it('raises nothing when no AI visitor landed on a missing page, or the read answers nothing', async () => {
    expect(await alerts({ prev: week(0), cur: week(0) })).toEqual([]);
    expect(await alerts({ prev: week(0), cur: week(0), broken: null })).toEqual([]);
  });
});

describe('the AI bots family', () => {
  const bots = (report) =>
    family('aiBots').run({
      brandId: 'b1',
      now: new Date('2026-10-19T06:00:00Z'),
      botReport: async () => report,
    });

  it('raises the cited pages no AI search bot read in 30 days, counting them all', async () => {
    const found = await bots({
      first_day: '2026-09-01',
      alert_state: 'on',
      uncrawled_count: 14,
      uncrawled: [
        { page: '/guides/espresso-machines-for-beginners', citations: '14' },
        { page: '/gifts', citations: 9 },
      ],
    });
    expect(found).toEqual([
      {
        kind: 'cited_page_uncrawled',
        dedupKey: 'cited_page_uncrawled',
        source: ['ai_results'],
        payload: {
          entity: 'pages',
          targets: [
            {
              id: '/guides/espresso-machines-for-beginners',
              label: '/guides/espresso-machines-for-beginners',
              citations: 14,
            },
            { id: '/gifts', label: '/gifts', citations: 9 },
          ],
        },
        previousValue: null,
        currentValue: 14,
        changeValue: null,
      },
    ]);
  });

  it('waits for a connection and 30 days of AI-bot data, and stays quiet when every cited page was read', async () => {
    // No Cloudflare or Vercel connection: the report is empty.
    expect(await bots(null)).toEqual([]);
    // Connected, but the first request is under 30 days old (00185).
    expect(await bots({ first_day: '2026-10-10', uncrawled_count: null, uncrawled: null })).toEqual(
      [],
    );
    expect(
      await bots({ first_day: '2026-09-01', alert_state: 'on', uncrawled_count: 0, uncrawled: [] }),
    ).toEqual([]);
  });

  it("reads nothing while the bot data isn't whole, whatever the report lists", async () => {
    // A sender stopped, was revoked or hit its cap: the pages read drained.
    await expect(
      bots({
        first_day: '2026-09-01',
        alert_state: 'stale',
        uncrawled_count: 40,
        uncrawled: [{ page: '/gifts', citations: 9 }],
      }),
    ).rejects.toBeInstanceOf(DataNotWhole);
  });

  it('keeps open signals open while the bot data is stale: the kind is unread, not an error', async () => {
    rpc.mockImplementation(async (name) =>
      name === 'ai_bot_report'
        ? { data: { first_day: '2026-09-01', alert_state: 'stale' }, error: null }
        : { data: null, error: { message: 'not this test' } },
    );
    const { unreadKinds } = await libraryCandidates('b1', {
      now: new Date('2026-10-19T06:00:00Z'),
      sources: new Set(['tracking']),
    });
    expect(unreadKinds.has('cited_page_uncrawled')).toBe(true);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ family: 'aiBots', reason: 'bot data is stale' }),
      '[signals] library family data not whole',
    );
    expect(logger.error).not.toHaveBeenCalledWith(
      expect.objectContaining({ family: 'aiBots' }),
      expect.anything(),
    );
  });

  it('declares the kinds it can write, so a failed night is not read as recovery', () => {
    expect(LIBRARY_EMITTED_KINDS).toEqual(
      expect.arrayContaining([
        'ai_visits_weekly_drop',
        'broken_citation_target',
        'cited_page_uncrawled',
      ]),
    );
  });
});

describe('weeklyWindows', () => {
  it('ends each week a second before midnight, so its last day is in one week only', () => {
    // ai_traffic_merged keeps Analytics rows through p_to's day (00176).
    expect(weeklyWindows(new Date('2026-10-19T06:00:00Z'))).toEqual({
      cur: { from: '2026-10-12T00:00:00.000Z', to: '2026-10-18T23:59:59.000Z' },
      prev: { from: '2026-10-05T00:00:00.000Z', to: '2026-10-11T23:59:59.000Z' },
    });
  });
});
