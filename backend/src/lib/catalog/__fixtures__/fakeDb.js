import { randomUUID } from 'node:crypto';

/**
 * A row's value at a column, at a JSON path in it as PostgREST reads one
 * (`shopping_path->>builtAt`), or at an embedded table's column (`brands.is_demo`).
 */
function valueAt(row, column) {
  const at = column.indexOf('->>');
  if (at < 0) {
    if (column in row || !column.includes('.')) return row[column];
    return column.split('.').reduce((value, key) => value?.[key], row);
  }
  const value = row[column.slice(0, at)]?.[column.slice(at + 3)];
  if (value == null) return null;
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/** PostgreSQL's order: ascending puts nulls last, descending first, unless told. */
function compareBy(orders) {
  return (a, b) => {
    for (const { column, ascending = true, nullsFirst = !ascending } of orders) {
      if (a[column] === b[column]) continue;
      if (a[column] == null) return nullsFirst ? -1 : 1;
      if (b[column] == null) return nullsFirst ? 1 : -1;
      const before = a[column] < b[column] ? -1 : 1;
      return ascending ? before : -before;
    }
    return 0;
  };
}

/** The rows deleted with a row of these tables (on delete cascade, 00278): table, column. */
const CASCADES = {
  catalog_products: [
    ['catalog_variants', 'product_id'],
    ['catalog_images', 'product_id'],
    ['catalog_product_categories', 'product_id'],
  ],
  catalog_orders: [['catalog_order_items', 'order_id']],
};

/**
 * An in-memory stand-in for the tables the catalog writes, with PostgREST's
 * calls as the sync and the sources make them, counting every write.
 * `maxRows` caps a read as PostgREST's max_rows does (1000 in
 * supabase/config.toml): the rest are dropped without an error.
 */
export function fakeDb({ maxRows = Infinity } = {}) {
  const tables = new Map();
  const rows = (name) => {
    if (!tables.has(name)) tables.set(name, []);
    return tables.get(name);
  };
  const writes = [];
  const uniqueKey = (table, row) => {
    if (table === 'catalog_categories') return `${row.brand_id}|${row.name}`;
    if (table === 'catalog_order_items') return `${row.order_id}|${row.external_line_id}`;
    if (table === 'catalog_source_credentials') return row.source_id;
    if (table === 'catalog_category_pages') return `${row.brand_id}|${row.category}`;
    if (table === 'cloro_countries') return `${row.model}|${row.country}`;
    if (table === 'content_shopping_checks') return row.draft_id;
    return `${row.brand_id}|${row.source}|${row.external_id}`;
  };
  // The unique keys' rows, by table, as the database's unique indexes find them.
  const byKey = new Map();
  const keyed = (table) => {
    if (!byKey.has(table)) byKey.set(table, new Map());
    return byKey.get(table);
  };

  function from(table) {
    const state = {
      filters: [],
      range: null,
      op: 'select',
      payload: null,
      returning: null,
      one: null,
      count: null,
      order: [],
    };
    const run = () => {
      const all = rows(table);
      const match = (row) =>
        state.filters.every(([kind, column, value]) => {
          const at = valueAt(row, column);
          if (kind === 'eq') return at === value;
          if (kind === 'neq') return at !== value;
          if (kind === 'is') return value === null ? at == null : at === value;
          if (kind === 'not_is') return value === null ? at != null : at !== value;
          // SQL's: a null is never less.
          if (kind === 'lt') return at != null && at < value;
          return value.includes(at);
        });
      if (state.op === 'select') {
        const found = all.filter(match).sort(compareBy([...state.order, { column: 'id' }]));
        // A count only, as `select(…, { count: 'exact', head: true })` asks.
        if (state.count === 'head') return { data: null, count: found.length, error: null };
        const [start, end] = state.range ?? [0, found.length];
        const data = found.slice(start, end + 1).slice(0, state.one ? undefined : maxRows);
        if (state.one) return { data: data[0] ?? null, error: null };
        return { data, error: null };
      }
      writes.push({
        table,
        op: state.op,
        count: Array.isArray(state.payload) ? state.payload.length : 1,
      });
      if (state.op === 'upsert') {
        const out = [];
        for (const values of [state.payload].flat()) {
          const key = uniqueKey(table, values);
          let row = keyed(table).get(key);
          if (row) Object.assign(row, values);
          else {
            row = { id: randomUUID(), removed_at: null, ...values };
            all.push(row);
            keyed(table).set(key, row);
          }
          out.push(row);
        }
        return { data: out, error: null };
      }
      if (state.op === 'insert') {
        const added = [state.payload].flat().map((values) => ({ id: randomUUID(), ...values }));
        all.push(...added);
        return { data: state.one ? added[0] : null, error: null };
      }
      if (state.op === 'update') {
        const changed = all.filter(match);
        for (const row of changed) Object.assign(row, state.payload);
        return { data: state.returning ? changed : null, error: null };
      }
      if (state.op === 'delete') {
        const deleted = all.filter(match);
        tables.set(
          table,
          all.filter((row) => !match(row)),
        );
        const ids = new Set(deleted.map((row) => row.id));
        for (const [child, column] of CASCADES[table] ?? []) {
          tables.set(
            child,
            rows(child).filter((row) => !ids.has(row[column])),
          );
        }
        return { data: state.returning ? deleted : null, error: null };
      }
      throw new Error(`unexpected ${state.op}`);
    };
    const builder = {
      // After a write, the rows it wrote, as PostgREST returns them. A
      // `{ head: true }` select asks for the count only.
      select: (_columns, options) => {
        if (state.op !== 'select') state.returning = true;
        if (options?.head) state.count = 'head';
        return builder;
      },
      eq: (column, value) => {
        state.filters.push(['eq', column, value]);
        return builder;
      },
      neq: (column, value) => {
        state.filters.push(['neq', column, value]);
        return builder;
      },
      is: (column, value) => {
        state.filters.push(['is', column, value]);
        return builder;
      },
      // Only `.not(column, 'is', value)`: a draft with a shopping path.
      not: (column, operator, value) => {
        if (operator !== 'is') throw new Error(`unexpected not.${operator}`);
        state.filters.push(['not_is', column, value]);
        return builder;
      },
      lt: (column, value) => {
        state.filters.push(['lt', column, value]);
        return builder;
      },
      single: () => {
        state.one = 'single';
        return builder;
      },
      maybeSingle: () => {
        state.one = 'maybe';
        return builder;
      },
      in: (column, values) => {
        state.filters.push(['in', column, values]);
        return builder;
      },
      order: (column, options) => {
        state.order.push({ column, ...options });
        return builder;
      },
      // The sweep's due filter: the tests' rows are all due.
      or: () => builder,
      limit: (n) => {
        state.range = [0, n - 1];
        return builder;
      },
      range: (start, end) => {
        state.range = [start, end];
        return builder;
      },
      upsert: (payload) => {
        state.op = 'upsert';
        state.payload = payload;
        return builder;
      },
      insert: (payload) => {
        state.op = 'insert';
        state.payload = payload;
        return builder;
      },
      update: (payload) => {
        state.op = 'update';
        state.payload = payload;
        return builder;
      },
      delete: () => {
        state.op = 'delete';
        return builder;
      },
      then: (onFulfilled, onRejected) => Promise.resolve(run()).then(onFulfilled, onRejected),
    };
    return builder;
  }
  return { db: { from }, rows, writes };
}
