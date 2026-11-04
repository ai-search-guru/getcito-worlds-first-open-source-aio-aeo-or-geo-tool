import { describe, expect, it, vi } from 'vitest';

vi.mock('../../config/supabase.js', () => ({ default: {} }));

const { FANOUT_INTENTS, fanoutIntentRows, fanoutIntents } = await import('./fanoutIntents.js');
const { INTENT_CRITERIA, normalizeIntentQuery } = await import('../intentExtraction.js');
const { PROMPTS } = await import('./brewline.js');

/**
 * The demo's fan-out searches, classified ahead into the shared intent
 * cache, so Query Fan-out shows the demo's intents without a model call.
 */

describe('fanoutIntentRows', () => {
  it('classifies every search the demo answers ran, with a label of the taxonomy', () => {
    const rows = fanoutIntentRows();
    const searches = new Set(PROMPTS.flatMap((p) => p.searches).map(normalizeIntentQuery));
    expect(rows.map((r) => r.query).sort()).toEqual([...searches].sort());
    for (const { query, intent } of rows) {
      expect(query).toBe(normalizeIntentQuery(query));
      expect(Object.keys(INTENT_CRITERIA)).toContain(intent);
    }
    // No intent kept for a search the demo no longer runs.
    expect(Object.keys(FANOUT_INTENTS).sort()).toEqual([...searches].sort());
  });
});

describe('fanoutIntents.build', () => {
  it('adds the rows the cache lacks, never overwriting one', async () => {
    const calls = [];
    const db = {
      from: (table) => ({
        upsert: async (rows, options) => {
          calls.push({ table, rows, options });
          return { error: null };
        },
      }),
    };
    expect(fanoutIntents.tables).toEqual([]);
    await fanoutIntents.build({ brandId: 'b', now: new Date(), db });
    expect(calls).toEqual([
      {
        table: 'fanout_query_intents',
        rows: fanoutIntentRows(),
        options: { onConflict: 'query', ignoreDuplicates: true },
      },
    ]);
  });
});
