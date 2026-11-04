import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { logger } from './logger.js';
import { MAX_RPC_PAGES, RPC_PAGE_SIZE, readAllRpcRows } from './rpcPages.js';

/** A set-returning RPC whose result has `total` rows, served as PostgREST would. */
function rpcOf(total) {
  const rows = Array.from({ length: total }, (_, i) => ({ n: i }));
  return vi.fn(async (from, to) => ({
    data: rows.slice(from, Math.min(to + 1, from + RPC_PAGE_SIZE)),
    error: null,
  }));
}

describe('readAllRpcRows', () => {
  it('reads every row past the 1000-row cap, a page at a time', async () => {
    const page = rpcOf(2500);

    const { data, error } = await readAllRpcRows('summaries', page);

    expect(error).toBeNull();
    expect(data).toHaveLength(2500);
    expect(data.at(-1)).toEqual({ n: 2499 });
    expect(page.mock.calls).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it('takes a single request when the result is under a page', async () => {
    const page = rpcOf(709);

    expect((await readAllRpcRows('summaries', page)).data).toHaveLength(709);
    expect(page).toHaveBeenCalledTimes(1);
  });

  it('asks once more when the last page is exactly full', async () => {
    const page = rpcOf(1000);

    expect((await readAllRpcRows('summaries', page)).data).toHaveLength(1000);
    expect(page).toHaveBeenCalledTimes(2);
  });

  it('treats a page without data as the end', async () => {
    const page = vi.fn(async () => ({ data: null, error: null }));

    expect(await readAllRpcRows('summaries', page)).toEqual({ data: [], error: null });
    expect(page).toHaveBeenCalledTimes(1);
  });

  /**
   * A partial read would look like a complete one — the 1000-row cap all over
   * again — so the first failing page wins and nothing read before it is kept.
   */
  it('reports the error of any page and discards what was read', async () => {
    const timeout = { message: 'canceling statement due to statement timeout' };
    const page = vi.fn(async (from) =>
      from === 0
        ? { data: Array.from({ length: RPC_PAGE_SIZE }, () => ({})), error: null }
        : { data: null, error: timeout },
    );

    expect(await readAllRpcRows('summaries', page)).toEqual({ data: null, error: timeout });
    expect(page).toHaveBeenCalledTimes(2);
  });

  it('stops at its page limit and says the result may be incomplete', async () => {
    const full = Array.from({ length: RPC_PAGE_SIZE }, (_, n) => ({ n }));
    const page = vi.fn(async () => ({ data: full, error: null }));

    const { data } = await readAllRpcRows('summaries', page);

    expect(data).toHaveLength(MAX_RPC_PAGES * RPC_PAGE_SIZE);
    expect(page).toHaveBeenCalledTimes(MAX_RPC_PAGES);
    expect(logger.warn).toHaveBeenCalledWith(
      { rpc: 'summaries', read: MAX_RPC_PAGES * RPC_PAGE_SIZE },
      expect.stringContaining('page limit reached'),
    );
  });
});

describe('RPC_PAGE_SIZE', () => {
  /**
   * A page larger than PostgREST's max_rows comes back short, and a short page
   * reads as the last one: the loop would stop after the first response and
   * bring the cap back without an error.
   */
  it('is no larger than the max_rows PostgREST is configured with', () => {
    const config = readFileSync(new URL('../../../supabase/config.toml', import.meta.url), 'utf8');
    const maxRows = Number(config.match(/^max_rows\s*=\s*(\d+)/m)?.[1]);

    expect(maxRows).toBeGreaterThan(0);
    expect(RPC_PAGE_SIZE).toBeLessThanOrEqual(maxRows);
  });
});
