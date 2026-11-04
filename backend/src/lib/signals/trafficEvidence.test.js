import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The evidence of a traffic signal (AC-001): per page, AI visits by platform
 * from one source, and the prompts naming the page as their target.
 */

let result = {};
let calls = [];
vi.mock('../../config/supabase.js', () => ({
  default: {
    rpc: async (name, args) => {
      calls.push({ name, args });
      return result;
    },
  },
}));

const { summarizeReferrals, trafficEvidence } = await import('./trafficEvidence.js');

const row = (over) => ({
  page: '/pricing',
  platform: 'chatgpt.com',
  cur_sessions: 4,
  prev_sessions: 9,
  ...over,
});

describe('summarizeReferrals', () => {
  it('lists the platforms with visits, most first, and totals them', () => {
    expect(
      summarizeReferrals([
        row({ platform: 'perplexity.ai', cur_sessions: 1, prev_sessions: 0 }),
        row(),
        row({ platform: 'claude.ai', cur_sessions: 0, prev_sessions: 0 }),
        row({ platform: null, cur_sessions: 1, prev_sessions: 2 }),
      ]),
    ).toEqual({
      sessions: 6,
      before: 11,
      platforms: [
        { platform: 'chatgpt.com', sessions: 4, before: 9 },
        { platform: 'unknown', sessions: 1, before: 2 },
        { platform: 'perplexity.ai', sessions: 1, before: 0 },
      ],
    });
  });
});

describe('trafficEvidence', () => {
  const now = new Date('2026-10-15T12:00:00Z');

  beforeEach(() => {
    calls = [];
    result = {
      data: {
        analytics: [row()],
        snippet: [
          // Analytics has /pricing: its snippet visits are the same visits.
          row({ platform: 'gemini.google.com', cur_sessions: 50 }),
          row({ page: '/guide', cur_sessions: 2, prev_sessions: 1 }),
        ],
        prompts: [
          { page: '/pricing', prompt_id: 'p1', text: 'Best coffee subscription?' },
          { page: '/pricing', prompt_id: 'p2', text: 'Coffee gifts' },
        ],
      },
      error: null,
    };
  });

  it('reads the two windows once, and picks one source per page', async () => {
    const evidence = await trafficEvidence('b1', ['/pricing', '/guide', '/about'], { now });
    expect(calls).toEqual([
      {
        name: 'ae_page_traffic_evidence',
        args: {
          p_brand_id: 'b1',
          p_pages: ['/pricing', '/guide', '/about'],
          p_cur_from: '2026-10-02',
          p_cur_to: '2026-10-15',
          p_prev_from: '2026-09-18',
          p_prev_to: '2026-10-01',
          p_exact: false,
        },
      },
    ]);
    expect(evidence.get('/pricing')).toEqual({
      referrals: {
        page: '/pricing',
        source: 'analytics',
        sessions: 4,
        before: 9,
        platforms: [{ platform: 'chatgpt.com', sessions: 4, before: 9 }],
      },
      prompts: [
        { id: 'p1', text: 'Best coffee subscription?' },
        { id: 'p2', text: 'Coffee gifts' },
      ],
    });
    expect(evidence.get('/guide').referrals).toMatchObject({ source: 'snippet', sessions: 2 });
    // A page no AI engine sent anyone to says so.
    expect(evidence.get('/about')).toEqual({
      referrals: { page: '/about', source: null, sessions: 0, before: 0, platforms: [] },
      prompts: [],
    });
  });

  it("reads the whole site's visits for a site-wide signal", async () => {
    result.data = { analytics: [], snippet: [row({ page: null })], prompts: [] };
    const evidence = await trafficEvidence('b1', null, { now });
    expect(calls[0].args).toMatchObject({ p_pages: null, p_exact: false });
    expect(evidence.get(null).referrals).toMatchObject({
      page: null,
      source: 'snippet',
      sessions: 4,
    });
  });

  it("matches the detector's own pages as written", async () => {
    await trafficEvidence('b1', ['https://acme.example/pricing?ref=ai'], { now, exact: true });
    expect(calls[0].args.p_exact).toBe(true);
  });

  it('throws when the read fails, for the recorder to keep what it had', async () => {
    result = { data: null, error: { message: 'timeout' } };
    await expect(trafficEvidence('b1', ['/pricing'], { now })).rejects.toThrow(
      'traffic evidence read failed: timeout',
    );
  });
});
