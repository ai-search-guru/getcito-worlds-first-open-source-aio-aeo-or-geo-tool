import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpAuthContext } from '@/lib/mcpAuth';
import type { SnippetReading } from '@/lib/trafficSnippet';

/**
 * get_ai_traffic (MCP) and get_ai_traffic_summary (Chat): 0 visits comes
 * with whether the tracking snippet is installed (00433), so a brand
 * without it isn't read as one with no AI traffic.
 */

let snippet: SnippetReading;
let brandFound = true;

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: brandFound ? { id: 'b1' } : null, error: null }),
      };
      return chain;
    },
  },
}));
vi.mock('@/lib/trafficScan', () => ({
  countTrafficLogs: async () => 0,
  scanTrafficLogs: async () => {},
}));
vi.mock('@/lib/trafficSnippet', () => ({ readSnippet: async () => snippet }));

const { getAiTrafficFor } = await import('./data');

const auth: McpAuthContext = {
  userId: 'user-1',
  email: null,
  organizationId: 'org-1',
  apiKeyId: 'key-1',
  brandAccess: 'all',
  role: 'admin',
};
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();

describe('getAiTrafficFor', () => {
  beforeEach(() => {
    brandFound = true;
    snippet = { lastVisitAt: null, foundAt: null, checkedAt: null };
  });

  it('says the snippet isn’t detected when it was never seen', async () => {
    expect(await getAiTrafficFor(auth, { brandId: 'b1' })).toEqual({
      tracking: 'not_detected',
      total_visits: 0,
      platform_breakdown: [],
      top_pages: [],
      country_breakdown: [],
    });
  });

  it('says installed and quiet when the check found it, active with a recent visit', async () => {
    snippet = { lastVisitAt: null, foundAt: daysAgo(1), checkedAt: daysAgo(1) };
    expect((await getAiTrafficFor(auth, { brandId: 'b1' }))!.tracking).toBe('installed_quiet');
    snippet = { lastVisitAt: daysAgo(2), foundAt: null, checkedAt: null };
    expect((await getAiTrafficFor(auth, { brandId: 'b1' }))!.tracking).toBe('active');
  });

  it('reads nothing for a brand outside the organization', async () => {
    brandFound = false;
    expect(await getAiTrafficFor(auth, { brandId: 'b1' })).toBeNull();
  });
});
