import { beforeEach, describe, expect, it, vi } from 'vitest';

/** The editor's Impact tab (CE-016): one page's numbers, as content_page_impact reads them. */

const BRAND = '33333333-3333-3333-3333-333333333333';
const PAGE = 'https://acme.example.com/pricing';

let rpcCalls: { fn: string; args: unknown }[];
let rpcResult: { data: unknown; error: { message: string } | null };

vi.mock('@/lib/action-center/assignees', () => ({ readAssignees: vi.fn(async () => new Map()) }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: {} }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    rpc: async (fn: string, args: unknown) => {
      rpcCalls.push({ fn, args });
      return rpcResult;
    },
  })),
}));

const { getContentImpact, getContentResults } = await import('./contentDrafts');

beforeEach(() => {
  rpcCalls = [];
  rpcResult = { data: null, error: null };
});

describe('getContentImpact', () => {
  it('reads the page over the period asked for', async () => {
    const impact = {
      citations: { cur: 4, prev: 2 },
      aiVisits: { cur: 0, prev: 0 },
      gscClicks: { cur: 12, prev: 20 },
      gscSince: '2026-05-01',
      prompts: [],
      overlap: [],
    };
    rpcResult = { data: impact, error: null };
    expect(await getContentImpact(BRAND, PAGE, 90)).toEqual(impact);
    expect(rpcCalls).toEqual([
      { fn: 'content_page_impact', args: { p_brand_id: BRAND, p_page: PAGE, p_days: 90 } },
    ]);
  });

  it('returns null for a brand outside the member’s organization', async () => {
    expect(await getContentImpact(BRAND, PAGE, 30)).toBeNull();
  });

  it('throws when the read fails', async () => {
    rpcResult = { data: null, error: { message: 'boom' } };
    await expect(getContentImpact(BRAND, PAGE, 30)).rejects.toThrow('boom');
  });

  it('reads nothing for a malformed brand, a period not offered, or a page without an address', async () => {
    await expect(getContentImpact('b1', PAGE, 30)).rejects.toThrow('invalid');
    await expect(getContentImpact(BRAND, PAGE, 14)).rejects.toThrow('invalid');
    await expect(getContentImpact(BRAND, '/pricing', 30)).rejects.toThrow('invalid');
    await expect(getContentImpact(BRAND, 'javascript:alert(1)', 30)).rejects.toThrow('invalid');
    expect(rpcCalls).toEqual([]);
  });
});

describe('getContentResults', () => {
  it('reads the page’s results over the period asked for', async () => {
    const results = {
      analytics: true,
      purchases: false,
      sources: [
        {
          platform: 'chatgpt.com',
          visits: 9,
          sessions: 12,
          keyEvents: 5,
          keyEventSessions: 4,
          transactions: 0,
          revenue: 0,
        },
      ],
    };
    rpcResult = { data: results, error: null };
    expect(await getContentResults(BRAND, PAGE, 7)).toEqual(results);
    expect(rpcCalls).toEqual([
      { fn: 'content_page_results', args: { p_brand_id: BRAND, p_page: PAGE, p_days: 7 } },
    ]);
  });

  it('returns null outside the organization and throws when the read fails', async () => {
    expect(await getContentResults(BRAND, PAGE, 30)).toBeNull();
    rpcResult = { data: null, error: { message: 'boom' } };
    await expect(getContentResults(BRAND, PAGE, 30)).rejects.toThrow('boom');
  });

  it('reads nothing for a malformed brand, a period not offered, or a page without an address', async () => {
    await expect(getContentResults('b1', PAGE, 30)).rejects.toThrow('invalid');
    await expect(getContentResults(BRAND, PAGE, 60)).rejects.toThrow('invalid');
    await expect(getContentResults(BRAND, '/pricing', 30)).rejects.toThrow('invalid');
    expect(rpcCalls).toEqual([]);
  });
});
