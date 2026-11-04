import { afterEach, describe, expect, it, vi } from 'vitest';

// record.js reaches the admin client at import time, whose config hard-exits
// without SUPABASE_* env (as in CI). Its `rpc` is replaced per test below.
vi.mock('../../config/supabase.js', () => ({ default: { rpc: vi.fn(), from: vi.fn() } }));
vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../pulse/metrics.js', () => ({ computePulseMetrics: vi.fn() }));

import supabaseAdmin from '../../config/supabase.js';
import { uncitedMentionCandidates } from './record.js';
import { ENGINE_THRESHOLDS } from '../../config/actionEngine.js';

const { detection } = ENGINE_THRESHOLDS;
const DAY_MS = 86_400_000;
const MAX_ROWS = 1000;

const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const uncited = (n) => ({ prompt_id: uuid(n), runs: 3, total_mentions: 2, total_citations: 0 });
const cited = (n) => ({ prompt_id: uuid(n), runs: 3, total_mentions: 2, total_citations: 1 });

/**
 * PostgREST in miniature for one RPC: rows sorted by `.order()`, sliced by
 * `.range()`, and never more than max_rows in one response. An un-ranged call
 * gets the first 1000 rows and no sign that more exist — the defect itself.
 * `afterFirstPage` runs once the first response is out, standing in for a
 * write that lands between two pages.
 */
function serve(rows, { afterFirstPage = null } = {}) {
  const calls = [];
  supabaseAdmin.rpc.mockImplementation((name, params) => {
    const call = { name, params, order: null, range: null };
    calls.push(call);
    const respond = () => {
      const sorted = call.order
        ? [...rows].sort((a, b) => a[call.order].localeCompare(b[call.order]))
        : rows;
      const [from, to] = call.range ?? [0, MAX_ROWS - 1];
      const data = sorted.slice(from, Math.min(to + 1, from + MAX_ROWS));
      if (calls.indexOf(call) === 0) afterFirstPage?.(rows);
      return { data, error: null };
    };
    const query = {
      order(key) {
        call.order = key;
        return query;
      },
      range(from, to) {
        call.range = [from, to];
        return query;
      },
      then: (resolve, reject) => Promise.resolve(respond()).then(resolve, reject),
    };
    return query;
  });
  return calls;
}

const now = new Date('2026-10-16T06:00:00.000Z');

afterEach(() => {
  supabaseAdmin.rpc.mockReset();
});

describe('uncitedMentionCandidates', () => {
  /**
   * The regression: one response stops at 1000 rows without an error, so a
   * brand with 1500 uncited prompts was told it had at most 1000.
   */
  it('counts uncited prompts past the first 1000', async () => {
    const rows = [
      ...Array.from({ length: 1500 }, (_, i) => uncited(i)),
      ...Array.from({ length: 300 }, (_, i) => cited(1500 + i)),
    ];
    const calls = serve(rows.reverse());

    const [signal] = await uncitedMentionCandidates('brand-1', now);

    expect(signal).toMatchObject({ kind: 'uncited_mentions', currentValue: 1500 });
    // Every uncited prompt the action will count, up to 1000 (AC-009).
    expect(signal.payload.promptIds).toEqual(Array.from({ length: 1000 }, (_, i) => uuid(i)));
    expect(calls.map((c) => c.range)).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });

  /** `range` without an order is a promise the database never made. */
  it('pages the detection window in prompt order', async () => {
    const calls = serve(Array.from({ length: 1200 }, (_, i) => uncited(i)));

    await uncitedMentionCandidates('brand-1', now);

    const windowFrom = new Date(now.getTime() - detection.windowDays * DAY_MS);
    for (const call of calls) {
      expect(call).toMatchObject({
        name: 'prompt_visibility_summaries',
        params: {
          p_brand_id: 'brand-1',
          p_date_from: windowFrom.toISOString(),
          p_date_to: now.toISOString(),
        },
        order: 'prompt_id',
      });
    }
  });

  /**
   * A prompt answered for the first time between two pages sorts ahead of
   * the rest and pushes the first page's last row onto the second. Counting
   * rows would report one prompt more than the brand has.
   */
  it('counts a prompt repeated at a page boundary once', async () => {
    const rows = Array.from({ length: 1500 }, (_, i) => uncited(i + 1));
    serve(rows, { afterFirstPage: (served) => served.push(cited(0)) });

    const [signal] = await uncitedMentionCandidates('brand-1', now);

    expect(signal.currentValue).toBe(1500);
    expect(new Set(signal.payload.promptIds).size).toBe(signal.payload.promptIds.length);
  });

  it('stays quiet below the minimum number of prompts', async () => {
    serve(Array.from({ length: detection.uncitedMinPrompts - 1 }, (_, i) => uncited(i)));

    expect(await uncitedMentionCandidates('brand-1', now)).toEqual([]);
  });

  it('throws when a page fails', async () => {
    supabaseAdmin.rpc.mockImplementation(() => {
      const query = {
        order: () => query,
        range: () => query,
        then: (resolve) => resolve({ data: null, error: { message: 'statement timeout' } }),
      };
      return query;
    });

    await expect(uncitedMentionCandidates('brand-1', now)).rejects.toThrow('statement timeout');
  });
});
