import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpAuthContext } from '@/lib/mcpAuth';

/**
 * get_prompt_volumes (PROMPT-013): each prompt's estimated AI volume comes
 * with its likely range, how sure it is and that it is an estimate, worked out
 * as the dashboard does; and its real demand (PROMPT-014), where it was read.
 */

let rows: Record<string, unknown>[] = [];
/** prompt_demand's rows (00370). */
let demandRows: Record<string, unknown>[] = [];
let demandFails = false;

function builder(table: string) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    in: async (_column: string, ids: string[]) =>
      demandFails
        ? { data: null, error: { message: 'statement timeout' } }
        : { data: demandRows.filter((r) => ids.includes(r.prompt_id as string)), error: null },
    order: () => chain,
    limit: async () => ({ data: rows, error: null }),
    maybeSingle: async () => ({ data: table === 'brands' ? { id: 'b1' } : null, error: null }),
  };
  return chain;
}

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: { from: (table: string) => builder(table) },
}));

const { getPromptVolumesFor } = await import('./data');

const auth: McpAuthContext = {
  userId: 'user-1',
  email: null,
  organizationId: 'org-1',
  apiKeyId: 'key-1',
  brandAccess: 'all',
  role: 'admin',
};

const row = (over: Record<string, unknown>) => ({
  prompt_id: 'p1',
  intent: 'commercial',
  keywords: ['a', 'b', 'c'],
  google_volumes: { a: 1000, b: 1200, c: 1500 },
  total_google_volume: 1200,
  est_ai_volume: 540,
  ai_volume_multiplier: 0.45,
  competition_index: 40,
  competition: 'MEDIUM',
  fetched_at: new Date().toISOString(),
  prompts: { text: 'Best espresso grinder?' },
  ...over,
});

describe('getPromptVolumesFor', () => {
  beforeEach(() => {
    demandRows = [];
    demandFails = false;
  });

  it('adds the range, confidence and type to each prompt', async () => {
    rows = [
      row({}),
      row({
        prompt_id: 'p2',
        keywords: ['x'],
        google_volumes: { x: 2000 },
        total_google_volume: 2000,
        est_ai_volume: 900,
      }),
    ];
    const volumes = await getPromptVolumesFor(auth, { brandId: 'b1' });
    expect(
      volumes!.map((v) => [
        v.prompt_id,
        v.est_ai_volume,
        v.est_ai_volume_low,
        v.est_ai_volume_high,
        v.volume_confidence,
        v.volume_type,
      ]),
    ).toEqual([
      // Three agreeing keywords: high, ±25%.
      ['p1', 540, 400, 680, 'high', 'estimate'],
      // One keyword: low, half to twice.
      ['p2', 900, 450, 1800, 'low', 'estimate'],
    ]);
  });

  it('counts one level less once the volumes are over six months old', async () => {
    rows = [row({ fetched_at: '2025-01-01T00:00:00Z' })];
    const [volume] = (await getPromptVolumesFor(auth, { brandId: 'b1' }))!;
    expect(volume.volume_confidence).toBe('medium');
  });

  it("adds each prompt's real demand where it was read, null where it wasn't", async () => {
    rows = [row({}), row({ prompt_id: 'p2' })];
    demandRows = [
      {
        prompt_id: 'p1',
        level: 'high',
        signals: 2,
        keyword: 'espresso grinder',
        gsc: {
          impressions: 1800,
          clicks: 40,
          queries: 3,
          top: { query: 'best espresso grinder', impressions: 1200, clicks: 30 },
          at: '2026-10-27T02:00:00Z',
        },
        trends: { points: [10, 20], trend: 'rising', change: 35, at: '2026-10-25T02:00:00Z' },
        paa: null,
        youtube: null,
        updated_at: '2026-10-27T02:00:00Z',
      },
    ];
    const volumes = (await getPromptVolumesFor(auth, { brandId: 'b1' }))!;
    expect(volumes[0].measured_demand).toEqual({
      level: 'high',
      signals_read: 2,
      read_at: '2026-10-27T02:00:00Z',
      search_console: {
        impressions: 1800,
        clicks: 40,
        queries: 3,
        top_query: 'best espresso grinder',
      },
      google_trends: { trend: 'rising', change_percent: 35 },
      people_also_ask: null,
      youtube: null,
    });
    expect(volumes[1].measured_demand).toBeNull();
  });

  it('still answers the volumes when the demand read fails', async () => {
    rows = [row({})];
    demandFails = true;
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const [volume] = (await getPromptVolumesFor(auth, { brandId: 'b1' }))!;
    expect(volume.est_ai_volume).toBe(540);
    expect(volume.measured_demand).toBeNull();
    error.mockRestore();
  });
});
