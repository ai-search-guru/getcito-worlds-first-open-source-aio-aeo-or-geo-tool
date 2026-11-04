import { afterEach, describe, expect, it, vi } from 'vitest';

// metrics.js reaches the admin client at import time, whose config hard-exits
// without SUPABASE_* env (as in CI). Its `rpc` is replaced per test below.
vi.mock('../../config/supabase.js', () => ({ default: { rpc: vi.fn(), from: vi.fn() } }));
vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import supabaseAdmin from '../../config/supabase.js';
import { promptScores } from './metrics.js';

const MAX_ROWS = 1000;
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const summary = (n) => ({
  prompt_id: uuid(n),
  runs: 4,
  mention_answers: 2,
  citation_answers: 1,
  position_factor: 0.5,
});

/**
 * PostgREST in miniature for one RPC: rows sorted by `.order()`, sliced by
 * `.range()`, and never more than max_rows in one response. An un-ranged call
 * gets the first 1000 rows and no sign that more exist — the defect itself.
 */
function serve(rows, { failFirst = null } = {}) {
  const calls = [];
  supabaseAdmin.rpc.mockImplementation((name, params) => {
    const call = { name, params, order: null, range: null };
    calls.push(call);
    const respond = () => {
      if (failFirst && calls.indexOf(call) === 0) return { data: null, error: failFirst };
      const sorted = call.order
        ? [...rows].sort((a, b) => a[call.order].localeCompare(b[call.order]))
        : rows;
      const [from, to] = call.range ?? [0, MAX_ROWS - 1];
      return { data: sorted.slice(from, Math.min(to + 1, from + MAX_ROWS)), error: null };
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

const from = new Date('2026-10-02T00:00:00.000Z');
const to = new Date('2026-10-08T23:59:59.999Z');

afterEach(() => {
  vi.useRealTimers();
  supabaseAdmin.rpc.mockReset();
});

describe('promptScores', () => {
  /**
   * The regression: one response stops at 1000 rows without an error, so a
   * brand with 2500 prompts had 1500 of them silently missing from the
   * pulse's movers.
   */
  it('scores every prompt of a brand past 1000 prompts', async () => {
    const calls = serve(Array.from({ length: 2500 }, (_, i) => summary(2499 - i)));

    const scores = await promptScores('brand-1', from, to);

    expect(scores.size).toBe(2500);
    expect(scores.has(uuid(0))).toBe(true);
    expect(scores.has(uuid(2499))).toBe(true);
    expect(calls.map((c) => c.range)).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  /** `range` without an order is a promise the database never made. */
  it('pages the same window in prompt order', async () => {
    const calls = serve(Array.from({ length: 1200 }, (_, i) => summary(i)));

    await promptScores('brand-1', from, to);

    for (const call of calls) {
      expect(call).toMatchObject({
        name: 'prompt_visibility_summaries',
        params: {
          p_brand_id: 'brand-1',
          p_date_from: from.toISOString(),
          p_date_to: to.toISOString(),
        },
        order: 'prompt_id',
      });
    }
  });

  it('takes a single request for a brand under 1000 prompts', async () => {
    const calls = serve(Array.from({ length: 40 }, (_, i) => summary(i)));

    expect((await promptScores('brand-1', from, to)).size).toBe(40);
    expect(calls).toHaveLength(1);
  });

  /**
   * The pulse's reads have retried a timeout since #687; paging must not lose
   * that. The retry starts over from the first page, so no page is skipped.
   */
  it('retries a timed-out page from the first page', async () => {
    vi.useFakeTimers();
    const calls = serve(
      Array.from({ length: 1500 }, (_, i) => summary(i)),
      { failFirst: { message: 'canceling statement due to statement timeout' } },
    );

    const pending = promptScores('brand-1', from, to);
    await vi.advanceTimersByTimeAsync(3_000);

    expect((await pending).size).toBe(1500);
    expect(calls.map((c) => c.range)).toEqual([
      [0, 999],
      [0, 999],
      [1000, 1999],
    ]);
  });
});
