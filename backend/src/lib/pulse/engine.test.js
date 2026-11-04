import { beforeEach, describe, expect, it, vi } from 'vitest';

// The module imports the supabase admin client, whose config hard-exits when
// SUPABASE_* env is absent (as in CI) — stub it before the import chain.
const from = vi.fn();
vi.mock('../../config/supabase.js', () => ({ default: { from: (...a) => from(...a) } }));

import { generatePulseForBrand, pulseWindowKey, runPulseCatchUp } from './engine.js';

/**
 * Pulse window dedupe (#701).
 *
 * Two mails an hour apart carried identical figures because the daily KPI
 * window anchors to the tracking-run ledger while the dedupe slot is keyed on
 * the calendar date. The window key is what lets the second one recognise
 * itself as a repeat.
 */
describe('pulseWindowKey', () => {
  const anchored = (to) => ({ window: { from: '2026-08-10T05:15:56Z', to, runAnchored: true } });

  it('keys a run-anchored digest on the end of its window', () => {
    expect(pulseWindowKey(anchored('2026-08-10T05:15:57.682Z'))).toBe('2026-08-10T05:15:57.682Z');
  });

  it('gives two digests of the same run the same key, whatever date they are filed under', () => {
    // The production pair: a recovery pulse dated to the missed day and the
    // brand's own pulse dated to today, both computed from the run that
    // completed at 05:15:57.
    const recovery = anchored('2026-08-10T05:15:57.682Z');
    const ownRun = anchored('2026-08-10T05:15:57.682Z');

    expect(pulseWindowKey(recovery)).toBe(pulseWindowKey(ownRun));
  });

  it('gives digests of different runs different keys', () => {
    expect(pulseWindowKey(anchored('2026-08-10T05:15:57.682Z'))).not.toBe(
      pulseWindowKey(anchored('2026-08-11T04:02:11.104Z')),
    );
  });

  it('returns null for a clock-anchored window, which could never match', () => {
    // Weekly digests and brands with no completed run end their window at
    // `now`, so comparing them would suppress nothing and only risk
    // suppressing something it should not.
    expect(
      pulseWindowKey({ window: { from: '2026-08-06T00:00:00Z', to: '2026-08-13T00:00:00Z' } }),
    ).toBeNull();
  });

  it('returns null when the digest predates the window field', () => {
    expect(pulseWindowKey({ windowDays: 1, kpis: { totalResults: 12 } })).toBeNull();
    expect(pulseWindowKey(undefined)).toBeNull();
  });

  it('returns null when a run-anchored window has no end, rather than a false match', () => {
    expect(pulseWindowKey({ window: { runAnchored: true } })).toBeNull();
  });
});

/**
 * Catch-up sweep scope: only cron runs can have a "missed" pulse, because the
 * pulse trigger never fires for manual or backfill runs in the first place.
 * Sweeping those mailed every new brand twice on its first morning — the
 * onboarding run (deliberately unpulsed) was "recovered" at cycle start, then
 * the brand's own daily run pulsed an hour later.
 */
describe('runPulseCatchUp', () => {
  // Minimal filtering query fake: applies eq/not/gte predicates to the given
  // rows and resolves like postgrest ({ data, count, error: null }).
  function fakeTable(rows) {
    const filters = [];
    const matches = () => rows.filter((r) => filters.every((f) => f(r)));
    const builder = {
      select: () => builder,
      eq: (col, val) => (filters.push((r) => r[col] === val), builder),
      gte: (col, val) => (filters.push((r) => r[col] >= val), builder),
      not: (col, op, val) => {
        if (op === 'is' && val === null) filters.push((r) => r[col] !== null);
        return builder;
      },
      order: () => builder,
      then: (resolve) => {
        const data = matches();
        return Promise.resolve({ data, count: data.length, error: null }).then(resolve);
      },
    };
    return builder;
  }

  let queriedTables;

  beforeEach(() => {
    from.mockReset();
    queriedTables = [];
  });

  function tables(fixtures) {
    from.mockImplementation((table) => {
      queriedTables.push(table);
      return fakeTable(fixtures[table] ?? []);
    });
  }

  const recent = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  it('ignores manual and backfill runs — they were never owed a pulse', async () => {
    tables({
      tracking_runs: [
        { brand_id: 'new-brand', completed_at: recent, source: 'manual' },
        { brand_id: 'old-brand', completed_at: recent, source: 'backfill' },
      ],
    });

    const res = await runPulseCatchUp();

    expect(res).toEqual({ sent: 0, skipped: 0 });
    expect(queriedTables).not.toContain('sent_pulses');
  });

  it('still considers a cron run with no pulse row after it', async () => {
    tables({
      tracking_runs: [{ brand_id: 'brand-1', completed_at: recent, source: 'cron' }],
      // A pulse already recorded after the run: the sweep looks, then skips.
      sent_pulses: [{ brand_id: 'brand-1', created_at: new Date().toISOString() }],
    });

    const res = await runPulseCatchUp();

    expect(res).toEqual({ sent: 0, skipped: 0 });
    expect(queriedTables).toContain('sent_pulses');
  });
});

/** A demo brand (00380) is sample data: no pulse is ever written or mailed for it. */
describe('generatePulseForBrand', () => {
  beforeEach(() => from.mockReset());

  it('skips a demo brand before reading anything else', async () => {
    const queried = [];
    from.mockImplementation((table) => {
      queried.push(table);
      const builder = {
        select: () => builder,
        eq: () => builder,
        single: async () => ({
          data: { id: 'demo', name: 'Brewline Coffee', is_active: true, is_demo: true },
          error: null,
        }),
      };
      return builder;
    });

    expect(await generatePulseForBrand('demo')).toEqual({ skipped: 'demo_brand' });
    expect(queried).toEqual(['brands']);
  });
});
