/**
 * Splitting a PostgREST `.in(column, ids)` filter across several requests.
 *
 * PostgREST carries `.in(...)` values in the query string, so one filter over
 * N uuids costs about 39 characters of URL each. The Prompts page asks for
 * every volume row a brand owns in a single call, and the largest brand's 402
 * prompts built a 15,792-character request — close enough to the edge's URL
 * ceiling that roughly one call in four was rejected before it ever reached
 * PostgREST. Those attempts left no trace in the database logs, the route
 * could only report that the query had failed, and the page dropped its
 * volume and competition columns with a "temporarily unavailable" toast.
 *
 * Every other brand's equivalent request is under 4 kB and has never failed,
 * so the cure is to keep each request in that range rather than to grow the
 * ceiling. Chunks run in parallel, so the extra round trips cost close to
 * nothing.
 *
 * `backend/src/routes/prompts.js` already does this by hand for fan-out intent
 * lookups (`FANOUT_INTENT_LOOKUP_CHUNK`); this is the same idea, shared.
 */

/**
 * Ids per request. 100 uuids is roughly 4 kB of URL — the size the busiest
 * brands have always been served at.
 */
export const IN_FILTER_CHUNK = 100;

/** Split ids into `chunkSize`-sized slices, dropping duplicates. */
export function chunkIds(ids, chunkSize = IN_FILTER_CHUNK) {
  const unique = [...new Set(ids)];
  const chunks = [];
  for (let i = 0; i < unique.length; i += chunkSize) {
    chunks.push(unique.slice(i, i + chunkSize));
  }
  return chunks;
}

/**
 * Run one `.in(column, ids)` query as several smaller ones.
 *
 * `buildQuery` receives a slice of the ids and returns the PostgREST query for
 * that slice. Rows come back concatenated in chunk order, so a caller that
 * needs a global order or a global `limit` must apply it after the call.
 * Ordering *within* a single id's rows survives untouched, because an id only
 * ever appears in one chunk — which is what lets callers that group by id keep
 * their existing `.order(...)`.
 *
 * Returns supabase-js's own `{ data, error }` shape so call sites keep the
 * error handling they already have. The first failing chunk is reported and
 * the remaining results are discarded.
 */
export async function selectInChunks(ids, buildQuery, chunkSize = IN_FILTER_CHUNK) {
  const chunks = chunkIds(ids, chunkSize);
  if (chunks.length === 0) return { data: [], error: null };

  const settled = await Promise.all(chunks.map((chunk) => buildQuery(chunk)));

  const data = [];
  for (const result of settled) {
    if (result?.error) return { data: null, error: result.error };
    data.push(...(result?.data ?? []));
  }
  return { data, error: null };
}
