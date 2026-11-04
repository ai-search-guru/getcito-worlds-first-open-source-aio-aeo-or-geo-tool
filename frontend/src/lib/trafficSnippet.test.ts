import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { readSnippet } from './trafficSnippet';

/** A client answering the newest visit and the brand's kept check (00433). */
function clientOf(
  visit: { data: unknown; error: unknown },
  brand: { data: unknown; error: unknown },
): SupabaseClient {
  return {
    from: (table: string) => {
      const answer = table === 'ai_traffic_logs' ? visit : brand;
      const chain = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        limit: () => chain,
        maybeSingle: async () => answer,
      };
      return chain;
    },
  } as unknown as SupabaseClient;
}

describe('readSnippet', () => {
  it('reads the newest AI visit and the home page check', async () => {
    const read = await readSnippet(
      clientOf(
        { data: { created_at: '2026-10-30T09:00:00Z' }, error: null },
        {
          data: {
            snippet_found_at: '2026-10-31T09:00:00Z',
            snippet_checked_at: '2026-10-31T09:00:00Z',
          },
          error: null,
        },
      ),
      'b1',
    );
    expect(read).toEqual({
      lastVisitAt: '2026-10-30T09:00:00Z',
      foundAt: '2026-10-31T09:00:00Z',
      checkedAt: '2026-10-31T09:00:00Z',
    });
  });

  it('reads the visits alone before 00433 is applied', async () => {
    const read = await readSnippet(
      clientOf(
        { data: null, error: null },
        { data: null, error: { code: '42703', message: 'column does not exist' } },
      ),
      'b1',
    );
    expect(read).toEqual({ lastVisitAt: null, foundAt: null, checkedAt: null });
  });

  it('fails on any other error', async () => {
    await expect(
      readSnippet(
        clientOf({ data: null, error: { message: 'timeout' } }, { data: null, error: null }),
        'b1',
      ),
    ).rejects.toThrow('timeout');
  });
});
