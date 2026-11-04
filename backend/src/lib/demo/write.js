/**
 * How the demo's modules write their rows: in chunks, a few statements at a
 * time, and, when a demo is rebuilt, over the rows already there instead of
 * after clearing them.
 *
 * A rebuild keeps the old data on show until the new data is in: every row
 * is written over the one with the same key (the generators' ids are
 * deterministic, so a rebuild writes the same rows again with new dates), and
 * only then are the rows this build didn't write deleted. Someone opening the
 * demo mid-rebuild sees last week's numbers, never an empty page.
 *
 * Other modules write through it too: `insertChunks(db, table, rows)` in
 * place of a loop of inserts, or, to be rebuilt in place, `ctx.write` (see
 * DEMO_MODULES in index.js).
 */

/** Rows per statement. */
export const CHUNK = 250;
/** Statements one module has in flight at once. */
export const CONCURRENCY = 4;
/** Rows per page when reading which keys a table holds. */
const PAGE = 1000;
/** Keys per delete statement (they travel in the URL). */
const DELETE_CHUNK = 100;

/**
 * A queue running at most `limit` tasks at once: `run(task)` resolves or
 * rejects as the task does. After the first failure no queued task starts;
 * each rejects with that first failure.
 *
 * @param {number} [limit]
 * @returns {(task: () => Promise<any>) => Promise<any>}
 */
export function limiter(limit = CONCURRENCY) {
  let active = 0;
  let failure = null;
  const queue = [];
  const next = () => {
    while (active < limit && queue.length > 0) {
      const job = queue.shift();
      if (failure) {
        job.reject(failure);
        continue;
      }
      active += 1;
      Promise.resolve()
        .then(job.task)
        .then(job.resolve, (err) => {
          failure ??= err;
          job.reject(err);
        })
        .finally(() => {
          active -= 1;
          next();
        });
    }
  };
  return (task) =>
    new Promise((resolve, reject) => {
      queue.push({ task, resolve, reject });
      next();
    });
}

/**
 * Like Promise.all, but settles every promise before it rejects: a failed
 * write never leaves another one still running behind the error.
 *
 * @param {Promise<any>[]} promises
 */
export async function allSettledOrThrow(promises) {
  const results = await Promise.allSettled(promises);
  const failed = results.find((r) => r.status === 'rejected');
  if (failed) throw failed.reason;
  return results.map((r) => r.value);
}

function chunked(rows, size) {
  const chunks = [];
  for (let i = 0; i < rows.length; i += size) chunks.push(rows.slice(i, i + size));
  return chunks;
}

/**
 * Writes `rows` into `table`, `chunk` rows per statement, at most
 * `concurrency` statements at once (or through a shared `run` queue). With
 * `onConflict` (the key's columns), a row overwrites the one with the same
 * key instead of failing on it.
 *
 * @param {object} db supabase client
 * @param {string} table
 * @param {object[]} rows
 * @param {{ chunk?: number, concurrency?: number, run?: Function, onConflict?: string }} [options]
 */
export async function insertChunks(
  db,
  table,
  rows,
  { chunk = CHUNK, concurrency = CONCURRENCY, run = limiter(concurrency), onConflict } = {},
) {
  await allSettledOrThrow(
    chunked(rows, chunk).map((part) =>
      run(async () => {
        const query = db.from(table);
        const { error } = onConflict
          ? await query.upsert(part, { onConflict })
          : await query.insert(part);
        if (error) throw new Error(`demo ${table} insert: ${error.message}`);
      }),
    ),
  );
}

const keyOf = (row, columns) => JSON.stringify(columns.map((c) => row[c] ?? null));

/** Every key of `table` under `column` in `values`, page by page. */
async function readKeys(db, table, columns, column, values) {
  const keys = [];
  for (let from = 0; ; from += PAGE) {
    let query = db.from(table).select(columns.join(', '));
    query = Array.isArray(values) ? query.in(column, values) : query.eq(column, values);
    // Ordered by the whole key, so no row falls between two pages.
    for (const c of columns) query = query.order(c);
    const { data, error } = await query.range(from, from + PAGE - 1);
    if (error) throw new Error(`demo ${table} read: ${error.message}`);
    keys.push(...(data ?? []));
    if (!data || data.length < PAGE) return keys;
  }
}

/** Deletes the rows with the given keys: by the last column, within the others. */
async function deleteKeys(db, table, columns, rows, run) {
  const groups = new Map();
  const last = columns.at(-1);
  for (const row of rows) {
    const within = Object.fromEntries(columns.slice(0, -1).map((c) => [c, row[c]]));
    const group = JSON.stringify(within);
    if (!groups.has(group)) groups.set(group, { within, values: [] });
    groups.get(group).values.push(row[last]);
  }
  const statements = [...groups.values()].flatMap(({ within, values }) =>
    chunked(values, DELETE_CHUNK).map((part) => ({ within, part })),
  );
  await allSettledOrThrow(
    statements.map(({ within, part }) =>
      run(async () => {
        let query = db.from(table).delete();
        if (columns.length > 1) query = query.match(within);
        const { error } = await query.in(last, part);
        if (error) throw new Error(`demo ${table} prune: ${error.message}`);
      }),
    ),
  );
}

/**
 * A module's writer for one build of a demo brand.
 *
 * `write(table, rows)` writes over the rows with the same key (`keys[table]`,
 * the table's key columns, 'id' unless named): on a rebuild the old rows,
 * on a first build the rows a new brand's triggers may have made. On a
 * rebuild it remembers what it wrote; `prune()` then deletes the brand's
 * rows of those tables that this build didn't write, the last table's
 * first. A table without a brand_id names how to find the brand's
 * rows in `scopes[table]`: [its column, the written table that column points
 * at], e.g. prompts: ['prompt_set_id', 'prompt_sets'].
 *
 * A table whose rows have no key of their own (an identity id the database
 * gives, and no other unique columns) is written with
 * `write(table, rows, { generated: true })`: inserted, then, on a rebuild,
 * the brand's rows that were there before deleted at once. Nothing is empty
 * meanwhile; for a moment both are there.
 *
 * @param {{ db: object, brandId: string, rebuild?: boolean,
 *   keys?: Record<string, string>, scopes?: Record<string, [string, string]>,
 *   concurrency?: number }} args
 */
export function demoWriter({
  db,
  brandId,
  rebuild = false,
  keys = {},
  scopes = {},
  concurrency = CONCURRENCY,
}) {
  const run = limiter(concurrency);
  const columnsOf = (table) => (keys[table] ?? 'id').split(',').map((c) => c.trim());
  /** Per table written, in the order first written: the keys written. */
  const written = new Map();

  return {
    /**
     * @param {string} table
     * @param {object[]} rows
     * @param {{ chunk?: number, generated?: boolean }} [options]
     */
    async write(table, rows, { chunk, generated = false } = {}) {
      if (generated) {
        const before = rebuild ? await readKeys(db, table, ['id'], 'brand_id', brandId) : [];
        await insertChunks(db, table, rows, { chunk, run });
        if (before.length > 0) await deleteKeys(db, table, ['id'], before, run);
        return;
      }
      const columns = columnsOf(table);
      if (rebuild) {
        if (!written.has(table)) written.set(table, new Set());
        const seen = written.get(table);
        for (const row of rows) seen.add(keyOf(row, columns));
      }
      return insertChunks(db, table, rows, { chunk, run, onConflict: columns.join(',') });
    },

    /** On a rebuild: deletes the rows this build didn't write. Returns how many, by table. */
    async prune() {
      if (!rebuild) return {};
      const tables = [...written.keys()];
      const existing = new Map();
      const read = async (table) => {
        const columns = columnsOf(table);
        const scope = scopes[table];
        let rows;
        if (scope) {
          const [column, parent] = scope;
          const parentIds = (existing.get(parent) ?? []).map((r) => r.id);
          rows =
            parentIds.length === 0
              ? []
              : await readKeys(db, table, [...new Set([...columns, column])], column, parentIds);
        } else {
          rows = await readKeys(db, table, columns, 'brand_id', brandId);
        }
        existing.set(table, rows);
      };
      // The brand's own tables side by side, then those found through them.
      await allSettledOrThrow(tables.filter((t) => !scopes[t]).map((t) => run(() => read(t))));
      for (const table of tables.filter((t) => scopes[t])) await read(table);

      const pruned = {};
      for (const table of [...tables].reverse()) {
        const columns = columnsOf(table);
        const keep = written.get(table);
        const stale = existing.get(table).filter((row) => !keep.has(keyOf(row, columns)));
        if (stale.length === 0) continue;
        await deleteKeys(db, table, columns, stale, run);
        pruned[table] = stale.length;
      }
      return pruned;
    },
  };
}
