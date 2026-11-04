import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * PROMPT-013: a prompt's detail page reads its volume. prompt_volumes is a
 * server-only table, so it's read only for a prompt the caller can see.
 */

let visible: { id: string } | null;
let volumeRow: Record<string, unknown> | null;
const volumeReads: string[] = [];

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    from: () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: visible, error: null }),
      };
      return chain;
    },
  })),
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const chain = {
        select: () => chain,
        eq: (_column: string, value: string) => {
          volumeReads.push(`${table}:${value}`);
          return chain;
        },
        maybeSingle: async () => ({ data: volumeRow, error: null }),
      };
      return chain;
    },
  },
}));

const { getPromptVolume } = await import('./promptVolume');

beforeEach(() => {
  visible = { id: 'p1' };
  volumeRow = {
    est_ai_volume: 1080,
    total_google_volume: 2400,
    google_volumes: { a: 4400, b: 2400, c: 880 },
    ai_volume_multiplier: '0.450',
    keywords: ['a', 'b', 'c'],
    fetched_at: '2026-10-10T19:28:41Z',
  };
  volumeReads.length = 0;
});

describe('getPromptVolume', () => {
  it("reads the prompt's volume for its estimate", async () => {
    expect(await getPromptVolume('p1')).toEqual({
      estAiVolume: 1080,
      totalGoogleVolume: 2400,
      googleVolumes: { a: 4400, b: 2400, c: 880 },
      aiVolumeMultiplier: 0.45,
      keywords: ['a', 'b', 'c'],
      fetchedAt: '2026-10-10T19:28:41Z',
    });
    expect(volumeReads).toEqual(['prompt_volumes:p1']);
  });

  it("reads nothing for a prompt the caller can't see, and null without a volume", async () => {
    visible = null;
    expect(await getPromptVolume('p1')).toBeNull();
    expect(volumeReads).toEqual([]);

    visible = { id: 'p1' };
    volumeRow = null;
    expect(await getPromptVolume('p1')).toBeNull();
  });
});
