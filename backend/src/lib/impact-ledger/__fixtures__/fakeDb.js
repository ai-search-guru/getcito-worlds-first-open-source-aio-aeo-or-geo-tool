import { randomUUID } from 'node:crypto';

/**
 * An in-memory stand-in for the tables the impact ledger reads and writes,
 * with the PostgREST calls it makes. A read gives at most `maxRows` rows
 * (PostgREST's max_rows, 1000 in supabase/config.toml), the rest dropped
 * without an error, so a reader that doesn't page loses rows as it would
 * live. Every call is recorded ({ table, op }); `fail(table, op)` returning
 * true answers that call with a database error.
 */

/** A row's value at a column, or at an embedded table's column (`prompt_sets.brand_id`). */
function valueAt(row, column) {
  if (column in row || !column.includes('.')) return row[column];
  return column.split('.').reduce((value, key) => value?.[key], row);
}

/** PostgreSQL's order: ascending puts nulls last. */
function compareBy(orders) {
  return (a, b) => {
    for (const { column, ascending = true } of orders) {
      const x = valueAt(a, column) ?? null;
      const y = valueAt(b, column) ?? null;
      if (x === y) continue;
      if (x === null) return ascending ? 1 : -1;
      if (y === null) return ascending ? -1 : 1;
      return (x < y ? -1 : 1) * (ascending ? 1 : -1);
    }
    return 0;
  };
}

/** The unique keys an upsert's onConflict names, by table. Nulls never conflict (00425). */
const UNIQUE = {
  impact_measurements: ['ship_event_id'],
  impact_control_sets: ['impact_measurement_id', 'checkpoint'],
  ship_events: ['content_draft_delivery_id'],
};

/** The embeds the queries name (`ship_events!…!inner(…)`): table → embedded table → [column, its key]. */
const EMBEDS = {
  impact_measurements: { ship_events: ['ship_event_id', 'id'] },
  ship_events: { organizations: ['organization_id', 'id'] },
  content_draft_deliveries: { organizations: ['organization_id', 'id'] },
};

/**
 * A row with the tables its select embeds, as `!inner` joins do: a row
 * whose embedded row is missing is dropped (null).
 */
function embed(tables, table, row, columns) {
  const out = { ...row };
  for (const [name, [local, remote]] of Object.entries(EMBEDS[table] ?? {})) {
    if (!new RegExp(`\\b${name}[!(]`).test(columns)) continue;
    const found = (tables[name] ?? []).find((other) => other[remote] === row[local]);
    if (!found) return null;
    const nested = embed(tables, name, found, columns);
    if (!nested) return null;
    out[name] = nested;
  }
  return out;
}

export function fakeDb(seed = {}, { maxRows = 1000, now = () => new Date().toISOString() } = {}) {
  const tables = {};
  for (const [name, rows] of Object.entries(seed)) tables[name] = rows.map((row) => ({ ...row }));
  const calls = [];
  const db = {
    tables,
    calls,
    maxRead: 0,
    fail: null,
    /**
     * ship_cms_publish (00428), as its SQL decides, in one step (the draft's
     * lock): the send's own, else the one it is noted on, else the draft's
     * cms_publish within p_republish_days (the latest before it, else the
     * nearest after it), noted, else a new ship event. `beforeShip` runs
     * first, so a test can make another call land while this one waits.
     */
    beforeShip: null,
    async rpc(name, args) {
      if (name !== 'ship_cms_publish') throw new Error(`unexpected rpc ${name}`);
      if (!Number.isInteger(args.p_republish_days) || args.p_republish_days < 1) {
        throw new Error('ship_cms_publish needs p_republish_days');
      }
      await db.beforeShip?.(args);
      calls.push({ table: 'ship_events', op: 'rpc' });
      if (db.fail?.('ship_events', 'rpc')) {
        return { data: null, error: { code: '57014', message: 'canceling statement' } };
      }
      const rows = (tables.ship_events ??= []);
      const own = rows.find((row) => row.content_draft_delivery_id === args.p_delivery_id);
      if (own) return { data: [{ ship_event_id: own.id, created: false }], error: null };
      const noted = rows.find((row) =>
        (row.republished_delivery_ids ?? []).includes(args.p_delivery_id),
      );
      if (noted) return { data: [{ ship_event_id: noted.id, created: false }], error: null };
      const at = Date.parse(args.p_shipped_at);
      if (args.p_content_draft_id) {
        const first = rows
          .filter(
            (row) =>
              row.brand_id === args.p_brand_id &&
              row.content_draft_id === args.p_content_draft_id &&
              row.kind === 'cms_publish' &&
              Math.abs(Date.parse(row.shipped_at) - at) <= args.p_republish_days * 86_400_000,
          )
          .sort((a, b) => {
            const [x, y] = [Date.parse(a.shipped_at), Date.parse(b.shipped_at)];
            return Number(x > at) - Number(y > at) || Math.abs(x - at) - Math.abs(y - at);
          })[0];
        if (first) {
          if (at > Date.parse(first.republished_at ?? first.shipped_at)) {
            first.republished_at = args.p_shipped_at;
          }
          const noted = first.republished_delivery_ids ?? [];
          if (!noted.includes(args.p_delivery_id) && noted.length < 50) {
            first.republished_delivery_ids = [...noted, args.p_delivery_id];
          }
          return { data: [{ ship_event_id: first.id, created: false }], error: null };
        }
      }
      const row = {
        id: randomUUID(),
        created_at: now(),
        organization_id: args.p_organization_id,
        brand_id: args.p_brand_id,
        kind: 'cms_publish',
        title: args.p_title,
        content_draft_id: args.p_content_draft_id,
        content_draft_delivery_id: args.p_delivery_id,
        url: args.p_url,
        action_id: args.p_action_id,
        source: 'content_editor',
        change_type: 'content',
        shipped_at: args.p_shipped_at,
        shipped_by: args.p_shipped_by,
        execution_mode: args.p_execution_mode,
        run_id: args.p_run_id ?? null,
        agent_id: args.p_agent_id ?? null,
        agent_run_id: args.p_agent_run_id ?? null,
        republished_at: null,
        republished_delivery_ids: [],
      };
      rows.push(row);
      return { data: [{ ship_event_id: row.id, created: true }], error: null };
    },
    from(table) {
      tables[table] ??= [];
      const state = {
        op: 'select',
        filters: [],
        order: [],
        range: null,
        one: false,
        payload: null,
      };
      let returning = false;
      let options = null;
      const match = (row) => state.filters.every((test) => test(row));
      const run = () => {
        calls.push({ table, op: state.op });
        if (db.fail?.(table, state.op)) {
          return { data: null, error: { code: '57014', message: 'canceling statement' } };
        }
        const rows = tables[table];
        const stamp = now();
        if (state.op === 'insert' || state.op === 'upsert') {
          const key = UNIQUE[table];
          const out = [];
          for (const values of [state.payload].flat()) {
            const taken =
              key &&
              key.every((k) => values[k] != null) &&
              rows.find((row) => key.every((k) => row[k] === values[k]));
            if (taken) {
              if (state.op === 'upsert' && !options?.ignoreDuplicates) {
                Object.assign(taken, values, { updated_at: stamp });
                out.push({ ...taken });
              }
              continue;
            }
            const row = { id: randomUUID(), created_at: stamp, updated_at: stamp, ...values };
            rows.push(row);
            out.push({ ...row });
          }
          return { data: returning ? out : null, error: null };
        }
        if (state.op === 'update') {
          const changed = rows.filter(match);
          for (const row of changed) Object.assign(row, state.payload, { updated_at: stamp });
          return { data: returning ? changed.map((row) => ({ ...row })) : null, error: null };
        }
        const found = rows
          .map((row) => embed(tables, table, row, state.columns))
          .filter((row) => row && match(row))
          .sort(compareBy(state.order));
        const [start, end] = state.range ?? [0, found.length - 1];
        const data = found
          .slice(start, end + 1)
          .slice(0, maxRows)
          .map((row) => ({ ...row }));
        db.maxRead = Math.max(db.maxRead, data.length);
        if (state.one) return { data: data[0] ?? null, error: null };
        return { data, error: null };
      };
      const chain = {
        select: (columns = '') => {
          if (state.op !== 'select') returning = true;
          else state.columns = columns;
          return chain;
        },
        insert: (payload) => ((state.op = 'insert'), (state.payload = payload), chain),
        upsert: (payload, opts) => (
          (state.op = 'upsert'),
          (state.payload = payload),
          (options = opts),
          chain
        ),
        update: (payload) => ((state.op = 'update'), (state.payload = payload), chain),
        eq: (column, value) => (state.filters.push((row) => valueAt(row, column) === value), chain),
        in: (column, values) => (
          state.filters.push((row) => values.includes(valueAt(row, column))),
          chain
        ),
        // An array column sharing a value with `values` (PostgREST's ov, &&).
        overlaps: (column, values) => (
          state.filters.push((row) => (valueAt(row, column) ?? []).some((v) => values.includes(v))),
          chain
        ),
        is: (column, value) => (
          state.filters.push((row) => (valueAt(row, column) ?? null) === value),
          chain
        ),
        gte: (column, value) => (
          state.filters.push(
            (row) => valueAt(row, column) != null && valueAt(row, column) >= value,
          ),
          chain
        ),
        lte: (column, value) => (
          state.filters.push(
            (row) => valueAt(row, column) != null && valueAt(row, column) <= value,
          ),
          chain
        ),
        lt: (column, value) => (
          state.filters.push((row) => valueAt(row, column) != null && valueAt(row, column) < value),
          chain
        ),
        // Only `.not(column, 'is', null)`: an embedded column's too.
        not: (column, operator, value) => {
          if (operator !== 'is') throw new Error(`unexpected not.${operator}`);
          state.filters.push((row) => (valueAt(row, column) ?? null) !== value);
          return chain;
        },
        order: (column, opts = {}) => (state.order.push({ column, ...opts }), chain),
        range: (from, to) => ((state.range = [from, to]), chain),
        limit: (n) => ((state.range = [0, n - 1]), chain),
        maybeSingle: () => ((state.one = true), chain),
        then(resolve, reject) {
          return Promise.resolve(run()).then(resolve, reject);
        },
      };
      return chain;
    },
  };
  return db;
}
