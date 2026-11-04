/**
 * Reading every row of a set-returning RPC.
 *
 * PostgREST returns at most 1000 rows per request (`max_rows` in
 * supabase/config.toml), and an RPC is no exception: the rest are dropped
 * without an error. On 2026-10-16 that cost the Tracked Prompts page most of
 * its Positions at 30 and 90 days; the server's per-prompt reads had the same
 * cap, so a brand past 1000 prompts lost the rest from the pulse's movers and
 * the uncited-mention signal.
 *
 * The web reads the same RPCs through frontend/src/lib/supabase/rpcPages.ts; this
 * is the server's copy of that loop.
 */

import { logger } from './logger.js';

/** PostgREST's max_rows. A page larger than it would read short and end early. */
export const RPC_PAGE_SIZE = 1000;

/** 100,000 rows: far past any brand's window, and a bound on a runaway loop. */
export const MAX_RPC_PAGES = 100;

/**
 * `page(from, to)` asks for one slice in a fixed order — each caller orders by
 * its RPC's key, because `range` without an order is a promise the database
 * never made — and slices are read until one comes back short. A result under
 * 1000 rows still takes a single request.
 *
 * Each slice is its own query, so a row written in between can shift a later
 * slice by one and repeat a row at the boundary: callers that count rows drop
 * repeats by key.
 *
 * Returns supabase-js's own `{ data, error }` shape so call sites keep the
 * error handling they already have. A failing slice is reported and what was
 * read before it is discarded: a partial read would look like a complete one.
 */
export async function readAllRpcRows(name, page) {
  const rows = [];
  for (let i = 0; i < MAX_RPC_PAGES; i++) {
    const from = i * RPC_PAGE_SIZE;
    const { data, error } = await page(from, from + RPC_PAGE_SIZE - 1);
    if (error) return { data: null, error };
    rows.push(...(data ?? []));
    if ((data ?? []).length < RPC_PAGE_SIZE) return { data: rows, error: null };
  }
  logger.warn(
    { rpc: name, read: rows.length },
    '[rpc-pages] page limit reached; the result covers only what was read',
  );
  return { data: rows, error: null };
}
