import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Google queries you don't track yet (AT-009): Search Console's queries with
 * clicks, minus the ones an active prompt covers by Prompt Suggestions'
 * rule, most clicks first.
 */

const rpc = vi.fn();
let prompts = [];
const promptReads = [];

function promptsChain() {
  const calls = {};
  const chain = {
    select: () => chain,
    eq: (col, val) => {
      calls[col] = val;
      return chain;
    },
    order: () => chain,
    range: async (from, to) => {
      promptReads.push({ ...calls, from, to });
      return { data: prompts.slice(from, to + 1), error: null };
    },
  };
  return chain;
}

vi.mock('../config/supabase.js', () => ({
  default: { rpc: (...args) => rpc(...args), from: () => promptsChain() },
}));

const { UNTRACKED_QUERY_SCAN, untrackedGoogleQueries } = await import('./untrackedQueries.js');

beforeEach(() => {
  rpc.mockReset();
  promptReads.length = 0;
  prompts = [
    { id: 'p1', text: 'Best espresso beans for a home grinder?' },
    { id: 'p2', text: 'Which coffee subscription ships to offices?' },
  ];
  rpc.mockResolvedValue({
    data: {
      last_day: '2026-10-17',
      since: '2026-10-11',
      until: '2026-10-17',
      capped: false,
      rows: [
        { query: 'espresso beans', clicks: 40, impressions: 900 },
        { query: 'cold brew ratio', clicks: '25', impressions: 610 },
        { query: 'coffee subscription offices', clicks: 12, impressions: 300 },
        { query: 'how to descale an espresso machine', clicks: 9, impressions: 400 },
        { query: 'the', clicks: 3, impressions: 50 },
      ],
    },
    error: null,
  });
});

describe('untrackedGoogleQueries', () => {
  it('keeps the queries no active prompt covers, most clicks first', async () => {
    const result = await untrackedGoogleQueries('b1', {
      since: '2026-10-13',
      until: '2026-10-19',
      limit: 1,
    });
    expect(rpc).toHaveBeenCalledWith('ai_traffic_google_queries', {
      p_brand_id: 'b1',
      p_since: '2026-10-13',
      p_until: '2026-10-19',
      p_latest: true,
      p_limit: UNTRACKED_QUERY_SCAN,
    });
    expect(promptReads[0]).toMatchObject({ 'prompt_sets.brand_id': 'b1', is_active: true });
    expect(result).toEqual({
      lastDay: '2026-10-17',
      since: '2026-10-11',
      until: '2026-10-17',
      count: 2,
      capped: false,
      rows: [{ query: 'cold brew ratio', clicks: 25, impressions: 610 }],
    });
  });

  it('reads every prompt past the 1,000-row page, and says when the scan was capped', async () => {
    prompts = [
      ...Array.from({ length: 1000 }, (_, i) => ({ id: `x${i}`, text: `filler prompt ${i}` })),
      { id: 'late', text: 'Cold brew ratio for a big batch' },
    ];
    rpc.mockResolvedValue({
      data: {
        last_day: '2026-10-17',
        since: null,
        until: '2026-10-17',
        capped: true,
        rows: [{ query: 'cold brew ratio', clicks: 25, impressions: 610 }],
      },
      error: null,
    });
    const result = await untrackedGoogleQueries('b1', { since: null, until: '2026-10-19' });
    expect(promptReads.map((r) => [r.from, r.to])).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    expect(result).toMatchObject({ count: 0, capped: true, rows: [] });
  });

  it('throws when the read fails', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(
      untrackedGoogleQueries('b1', { since: null, until: '2026-10-19' }),
    ).rejects.toThrow('boom');
  });
});
