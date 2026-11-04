import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A prompt's real demand (PROMPT-014, 00370) as get_prompt_volumes returns
 * it: short, as a list of prompts carries one each (one read_at, the top
 * query alone, People Also Ask's count and first three questions); null for a
 * row the sweep wrote before reading anything; and a failed read never takes
 * the volumes down with it.
 */

const calls: { brandId: unknown; ids: string[] }[] = [];
let failing = false;
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({
        eq: (_brandColumn: string, brandId: unknown) => ({
          in: async (_column: string, ids: string[]) => {
            calls.push({ brandId, ids });
            if (failing) return { data: null, error: { message: 'statement timeout' } };
            return {
              data: ids.map((id) => ({ prompt_id: id, signals: 1, gsc: { impressions: 5 } })),
              error: null,
            };
          },
        }),
      }),
    }),
  },
}));

const { promptDemandOf, readPromptDemand } = await import('./promptDemand');

describe('promptDemandOf', () => {
  it('reads each signal in short', () => {
    expect(
      promptDemandOf({
        prompt_id: 'p1',
        level: 'medium',
        signals: 4,
        keyword: 'espresso grinder',
        gsc: {
          impressions: 120,
          clicks: 3,
          queries: 2,
          top: { query: 'best espresso grinder', impressions: 90, clicks: 2 },
          at: '2026-10-27',
        },
        trends: { points: [1, 2], trend: 'steady', change: null, at: '2026-10-21' },
        paa: {
          questions: [
            { question: 'Which grinder is best?', url: 'https://a.example/', domain: 'a.example' },
            { question: 'Is a burr grinder worth it?', url: null, domain: null },
            { question: 'How fine for espresso?', url: null, domain: null },
            { question: 'Manual or electric?', url: null, domain: null },
          ],
          at: '2026-10-21',
        },
        youtube: { videos: 18, views: 240000, results: 900, top: null, at: '2026-10-21' },
        updated_at: '2026-10-27',
      }),
    ).toEqual({
      level: 'medium',
      signals_read: 4,
      read_at: '2026-10-27',
      search_console: {
        impressions: 120,
        clicks: 3,
        queries: 2,
        top_query: 'best espresso grinder',
      },
      google_trends: { trend: 'steady', change_percent: null },
      people_also_ask: {
        count: 4,
        questions: [
          'Which grinder is best?',
          'Is a burr grinder worth it?',
          'How fine for espresso?',
        ],
      },
      youtube: { videos: 18, views: 240000 },
    });
  });

  it('leaves a signal never read null, and a level it does not know out', () => {
    const demand = promptDemandOf({
      prompt_id: 'p1',
      level: 'huge',
      signals: 1,
      gsc: null,
      trends: { trend: 'sideways', at: '2026-10-21' },
    });
    expect(demand).toMatchObject({
      level: null,
      signals_read: 1,
      search_console: null,
      google_trends: { trend: null, change_percent: null },
      people_also_ask: null,
      youtube: null,
    });
  });

  it('reads a row the sweep wrote before reading anything as no demand yet', () => {
    // The nightly sweep writes the row when it sets the paid tasks (promptDemand.js).
    expect(
      promptDemandOf({
        prompt_id: 'p1',
        signals: 0,
        keyword: 'espresso grinder',
        gsc: null,
        trends: null,
        paa: null,
        youtube: null,
        tasks: { posted_at: '2026-10-28', trends: 'task-1', paa: null, youtube: null },
      }),
    ).toBeNull();
  });
});

describe('readPromptDemand', () => {
  beforeEach(() => {
    calls.length = 0;
    failing = false;
  });

  it("reads the brand's prompts a hundred at a time", async () => {
    const ids = Array.from({ length: 250 }, (_, i) => `p${i}`);
    const demand = await readPromptDemand('b1', ids);
    expect(calls.map((call) => call.ids.length)).toEqual([100, 100, 50]);
    expect(calls.every((call) => call.brandId === 'b1')).toBe(true);
    expect(demand.size).toBe(250);
  });

  it('answers none, logged, when the read fails', async () => {
    failing = true;
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await readPromptDemand('b1', ['p1'])).size).toBe(0);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
