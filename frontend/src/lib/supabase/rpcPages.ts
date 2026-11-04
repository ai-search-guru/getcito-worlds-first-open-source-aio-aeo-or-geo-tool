/** PostgREST's max_rows (supabase/config.toml). A page larger than it would read short and end early. */
export const RPC_PAGE_SIZE = 1000;

/** 100,000 rows: far past any brand's window, and a bound on a runaway loop. */
const MAX_PAGES = 100;

/**
 * Every row a set-returning RPC gives back.
 *
 * PostgREST returns at most 1000 rows per request, and an RPC is no
 * exception: the rest are dropped without an error, the #430/#464 defect
 * family. `page` asks for one slice in a fixed order (each caller orders by
 * its RPC's key), and slices are read until one comes back short. A result
 * under 1000 rows still takes a single request. Each slice is its own query,
 * so rows written in between can shift a later slice by a row: a caller
 * should key rows by id rather than sum them as they come. Every page re-runs
 * the RPC, so an expensive aggregate is better returned as one jsonb value
 * (as prompt_position_summaries_json, 00153, does).
 */
export async function readAllRpcRows<T>(
  page: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let i = 0; i < MAX_PAGES; i++) {
    const from = i * RPC_PAGE_SIZE;
    const { data, error } = await page(from, from + RPC_PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if ((data ?? []).length < RPC_PAGE_SIZE) return rows;
  }
  console.warn(`[rpc-pages] stopped after ${MAX_PAGES} pages; the result may be incomplete`);
  return rows;
}
