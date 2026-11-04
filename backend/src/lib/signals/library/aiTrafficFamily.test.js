import { describe, expect, it, vi } from 'vitest';

/**
 * The AI-traffic family writes, with each page, what the drawer explains it
 * with (AC-001): its sessions and, from Analytics, its AI visitors'
 * engagement and key events, beside the site's rates they were compared with.
 */

vi.mock('../../../config/supabase.js', () => ({ default: { from: vi.fn(), rpc: vi.fn() } }));
vi.mock('../../logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { LIBRARY_FAMILIES } = await import('./detect.js');

const analytics = (over) => ({
  page: '/pricing',
  cur_sessions: 40,
  prev_sessions: 42,
  cur_engaged: 30,
  cur_key_events: 8,
  prev_key_events: 5,
  ...over,
});

const run = (traffic) =>
  LIBRARY_FAMILIES.find((f) => f.name === 'aiTraffic').run({
    brandId: 'b1',
    now: new Date('2026-10-15T00:00:00Z'),
    traffic: async () => traffic,
  });

describe('the AI-traffic family', () => {
  it("records each page's engagement and key events from Analytics, and the site's", async () => {
    const found = await run({
      analytics: [
        analytics(),
        // Engaged far below the site: underperforming.
        analytics({
          page: '/guide',
          cur_sessions: 50,
          prev_sessions: 52,
          cur_engaged: 10,
          cur_key_events: 0,
          prev_key_events: 0,
        }),
      ],
      // The snippet counts visits only.
      snippet: [{ page: 'https://acme.example/blog', cur_sessions: 16, prev_sessions: 20 }],
    });
    const byKind = Object.fromEntries(found.map((f) => [f.kind, f.payload]));

    expect(byKind.ai_landing_page_winner).toEqual({
      entity: 'pages',
      targets: [
        {
          id: '/pricing',
          label: '/pricing',
          before: 42,
          now: 40,
          engagedRate: 0.75,
          keyEvents: 8,
          keyEventsBefore: 5,
          keyRate: 0.2,
        },
      ],
      siteEngagedRate: 0.444,
      siteKeyRate: 0.089,
    });
    expect(byKind.ai_landing_underperforming.targets[0]).toMatchObject({
      id: '/guide',
      engagedRate: 0.2,
    });
    expect(byKind.ai_traffic_slipping.targets).toEqual([
      { id: 'https://acme.example/blog', label: 'https://acme.example/blog', before: 20, now: 16 },
    ]);
  });

  it("counts a drop's falling pages apart from its sessions", async () => {
    const found = await run({
      analytics: [
        analytics({ page: '/a', prev_sessions: 40, cur_sessions: 10 }),
        analytics({ page: '/b', prev_sessions: 20, cur_sessions: 10 }),
      ],
      snippet: [],
    });
    const drop = found.find((f) => f.kind === 'ai_traffic_drop');
    expect(drop).toMatchObject({ previousValue: 60, currentValue: 20 });
    expect(drop.payload.pageCount).toBe(2);
    expect(drop.payload.targets.map((t) => t.id)).toEqual(['/a', '/b']);
  });

  it('records no rates without Analytics', async () => {
    const found = await run({
      analytics: [],
      snippet: [{ page: '/blog', cur_sessions: 16, prev_sessions: 20 }],
    });
    expect(found[0].payload).toEqual({
      entity: 'pages',
      targets: [{ id: '/blog', label: '/blog', before: 20, now: 16 }],
    });
  });
});
