/**
 * An in-memory stand-in for the service-role Supabase client, for Chat's
 * tests: tables of plain rows, the filters and statements the activity log,
 * Undo and the idempotency keys use, and unique keys that refuse a second
 * row as Postgres does (23505). Each statement runs whole at once, after a
 * turn of the event loop, so two calls started together interleave between
 * statements as two requests would. Tests only.
 */

type Row = Record<string, unknown>;
type Filter = (row: Row) => boolean;
type Result = {
  data: unknown;
  error: { code?: string; message: string } | null;
  count?: number | null;
};

export interface FakeSupabase {
  tables: Record<string, Row[]>;
  /** Columns that are unique together, per table. */
  unique: Record<string, string[][]>;
  /** Defaults a new row gets, per table, computed at insert. */
  defaults: Record<string, () => Row>;
  /** A table whose next statements fail with this error. */
  failures: Record<string, { code?: string; message: string }>;
  /** Every statement, in order: [table, kind]. */
  log: [string, string][];
  /** Database functions by name, for rpc(). */
  rpcs: Record<string, (args: Record<string, unknown>) => unknown>;
  /**
   * PostgREST's max_rows: a select returns at most this many rows, whatever
   * its limit, as the real API cuts them without an error. Unset: no cap.
   */
  maxRows?: number;
  from(table: string): Builder;
  rpc(name: string, args?: Record<string, unknown>): Promise<Result>;
}

interface Builder extends PromiseLike<Result> {
  select(columns?: string, options?: { count?: 'exact'; head?: boolean }): Builder;
  insert(rows: Row | Row[]): Builder;
  /** Insert, or on a clash of `onConflict`'s columns update (or with `ignoreDuplicates`, keep) the row. */
  upsert(rows: Row | Row[], options?: { onConflict?: string; ignoreDuplicates?: boolean }): Builder;
  update(patch: Row): Builder;
  delete(): Builder;
  eq(column: string, value: unknown): Builder;
  neq(column: string, value: unknown): Builder;
  in(column: string, values: unknown[]): Builder;
  is(column: string, value: null): Builder;
  not(column: string, operator: 'is', value: null): Builder;
  lt(column: string, value: string): Builder;
  gt(column: string, value: unknown): Builder;
  /** At or after: an ISO time, or a number. */
  gte(column: string, value: unknown): Builder;
  /** At or before: an ISO time, or a number; a null cell never passes. */
  lte(column: string, value: unknown): Builder;
  /**
   * PostgREST's `or`: a row passes any of the comma-separated `column.op.value`
   * terms (eq, neq, is null, lt a date — as saveContentDraft's agent check) or
   * `and(…)` groups of them.
   */
  or(filter: string): Builder;
  /**
   * A full-text match (`fts`): every `'word':*` term of `query`, joined by `&`,
   * starts a word of the row's `column` — a test row holds its search
   * column as plain words.
   */
  textSearch(column: string, query: string, options?: { config?: string }): Builder;
  order(column: string, options?: { ascending?: boolean }): Builder;
  limit(count: number): Builder;
  /** Rows `from` to `to`, both included, after the order. */
  range(from: number, to: number): Builder;
  maybeSingle(): Promise<Result>;
  single(): Promise<Result>;
}

let counter = 0;
/** A fresh uuid-shaped id. */
export const fakeId = () => {
  counter += 1;
  return `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`;
};

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** A filter's column of a row: a JSON field (`data->>key`, `data->a->>b`) as PostgREST reads it. */
function cellOf(row: Row, column: string): unknown {
  const [base, ...keys] = column.split(/->>?/);
  let value: unknown = row[base];
  for (const key of keys) {
    value = value && typeof value === 'object' ? (value as Row)[key] : undefined;
  }
  return value;
}

/**
 * A select's JSON fields (`alias:column->key`), as PostgREST reads them:
 * each comes with the row under its alias, else its last key, beside the
 * row's own columns.
 */
function jsonFields(columns: string | undefined): ((row: Row) => Row)[] {
  return (columns ?? '').split(',').flatMap((entry) => {
    const match = entry.trim().match(/^(?:(\w+):)?(\w+)((?:->\w+)+)$/);
    if (!match) return [];
    const [, alias, column, path] = match;
    const keys = path.split('->').filter(Boolean);
    return [
      (row: Row) => {
        let value: unknown = row[column];
        for (const key of keys) {
          value = value && typeof value === 'object' ? (value as Row)[key] : undefined;
        }
        return { [alias ?? keys[keys.length - 1]]: value ?? null };
      },
    ];
  });
}

export function createFakeSupabase(): FakeSupabase {
  const fake: FakeSupabase = {
    tables: {},
    unique: {},
    defaults: {},
    failures: {},
    log: [],
    rpcs: {},
    async rpc(name, args = {}) {
      await tick();
      fake.log.push([name, 'rpc']);
      const fn = fake.rpcs[name];
      // As PostgREST answers a function it doesn't know (a migration not applied yet).
      if (!fn) return { data: null, error: { code: 'PGRST202', message: `No function ${name}` } };
      return { data: await fn(args), error: null };
    },
    from(table) {
      let kind: 'select' | 'insert' | 'upsert' | 'update' | 'delete' = 'select';
      let conflict: { columns: string[]; ignore: boolean } = { columns: ['id'], ignore: false };
      let payload: Row | Row[] | null = null;
      let returning = false;
      const filters: Filter[] = [];
      const sorts: { column: string; ascending: boolean }[] = [];
      let max: number | null = null;
      let offset = 0;
      let counting: { head: boolean } | null = null;
      let fields: ((row: Row) => Row)[] = [];
      const read = (row: Row) =>
        fields.reduce<Row>((out, field) => ({ ...out, ...field(row) }), { ...row });

      const rows = () => (fake.tables[table] ??= []);
      const clash = (row: Row, others: Row[]) =>
        (fake.unique[table] ?? []).some((columns) =>
          others.some((other) => other !== row && columns.every((c) => other[c] === row[c])),
        );

      const run = async (): Promise<Result> => {
        await tick();
        fake.log.push([table, kind]);
        const failure = fake.failures[table];
        if (failure) return { data: null, error: failure };
        const matching = rows().filter((row) => filters.every((f) => f(row)));
        if (kind === 'select') {
          const sorted = [...matching].sort((a, b) => {
            for (const sort of sorts) {
              const x = a[sort.column] as string | number;
              const y = b[sort.column] as string | number;
              if (x !== y) return (x < y ? -1 : 1) * (sort.ascending ? 1 : -1);
            }
            return 0;
          });
          const cap = Math.min(max ?? Infinity, fake.maxRows ?? Infinity);
          const limited = sorted.slice(offset, cap === Infinity ? undefined : offset + cap);
          if (counting) {
            const data = counting.head ? null : limited.map(read);
            return { data, error: null, count: matching.length };
          }
          return { data: limited.map(read), error: null };
        }
        if (kind === 'delete') {
          fake.tables[table] = rows().filter((row) => !matching.includes(row));
          return { data: returning ? matching : null, error: null };
        }
        if (kind === 'update') {
          const patched = matching.map((row) => ({ ...row, ...(payload as Row) }));
          const after = rows().map((row) => patched[matching.indexOf(row)] ?? row);
          if (patched.some((row) => clash(row, after))) {
            return { data: null, error: { code: '23505', message: 'duplicate key' } };
          }
          fake.tables[table] = after;
          return { data: returning ? patched.map((row) => ({ ...row })) : null, error: null };
        }
        if (kind === 'upsert') {
          const written: Row[] = [];
          let after = [...rows()];
          for (const row of Array.isArray(payload) ? payload : [payload!]) {
            const at = after.findIndex((other) =>
              conflict.columns.every((c) => other[c] === row[c]),
            );
            if (at >= 0) {
              if (conflict.ignore) continue;
              after[at] = { ...after[at], ...row };
              written.push(after[at]);
            } else {
              const added = { id: fakeId(), ...(fake.defaults[table]?.() ?? {}), ...row };
              after = [...after, added];
              written.push(added);
            }
          }
          if (written.some((row) => clash(row, after))) {
            return { data: null, error: { code: '23505', message: 'duplicate key' } };
          }
          fake.tables[table] = after;
          return { data: returning ? written.map((row) => ({ ...row })) : null, error: null };
        }
        const added = (Array.isArray(payload) ? payload : [payload!]).map((row) => ({
          id: fakeId(),
          ...(fake.defaults[table]?.() ?? {}),
          ...row,
        }));
        const after = [...rows(), ...added];
        if (added.some((row) => clash(row, after))) {
          return { data: null, error: { code: '23505', message: 'duplicate key' } };
        }
        fake.tables[table] = after;
        return { data: returning ? added.map((row) => ({ ...row })) : null, error: null };
      };

      const one = async (strict: boolean): Promise<Result> => {
        const result = await run();
        if (result.error) return result;
        const list = (result.data as Row[] | null) ?? [];
        if (list.length > 1) return { data: null, error: { message: 'more than one row' } };
        if (strict && list.length === 0) return { data: null, error: { message: 'no rows' } };
        return { data: list[0] ?? null, error: null };
      };

      const builder: Builder = {
        select(columns, options) {
          if (kind !== 'select') returning = true;
          else {
            fields = jsonFields(columns);
            if (options?.count) counting = { head: options.head ?? false };
          }
          return builder;
        },
        insert(rowsIn) {
          kind = 'insert';
          payload = rowsIn;
          return builder;
        },
        upsert(rowsIn, options) {
          kind = 'upsert';
          payload = rowsIn;
          conflict = {
            columns: (options?.onConflict ?? 'id').split(',').map((c) => c.trim()),
            ignore: options?.ignoreDuplicates ?? false,
          };
          return builder;
        },
        update(patch) {
          kind = 'update';
          payload = patch;
          return builder;
        },
        delete() {
          kind = 'delete';
          return builder;
        },
        eq(column, value) {
          filters.push((row) => cellOf(row, column) === value);
          return builder;
        },
        neq(column, value) {
          filters.push((row) => cellOf(row, column) !== value);
          return builder;
        },
        in(column, values) {
          filters.push((row) => values.includes(cellOf(row, column)));
          return builder;
        },
        is(column, value) {
          filters.push((row) => (cellOf(row, column) ?? null) === value);
          return builder;
        },
        not(column, _operator, value) {
          filters.push((row) => (cellOf(row, column) ?? null) !== value);
          return builder;
        },
        lt(column, value) {
          filters.push(
            (row) =>
              typeof row[column] === 'string' &&
              Date.parse(row[column] as string) < Date.parse(value),
          );
          return builder;
        },
        gt(column, value) {
          filters.push((row) => (row[column] as number) > (value as number));
          return builder;
        },
        gte(column, value) {
          const at = (v: unknown) => (typeof v === 'string' ? Date.parse(v) : (v as number));
          filters.push((row) => row[column] !== null && at(row[column]) >= at(value));
          return builder;
        },
        lte(column, value) {
          const at = (v: unknown) => (typeof v === 'string' ? Date.parse(v) : (v as number));
          filters.push(
            (row) =>
              row[column] !== null && row[column] !== undefined && at(row[column]) <= at(value),
          );
          return builder;
        },
        or(filter) {
          // Split at the commas outside parentheses and quotes.
          const top = (text: string) => {
            const parts: string[] = [];
            let depth = 0;
            let quoted = false;
            let start = 0;
            [...text].forEach((ch, i) => {
              if (ch === '"') quoted = !quoted;
              else if (quoted) return;
              else if (ch === '(') depth += 1;
              else if (ch === ')') depth -= 1;
              else if (ch === ',' && depth === 0) {
                parts.push(text.slice(start, i));
                start = i + 1;
              }
            });
            parts.push(text.slice(start));
            return parts;
          };
          // One `column.op.value` term: eq, neq, is null, lt a date; `column.not.op.value` negated.
          const term = (condition: string): ((row: Row) => boolean) => {
            const negated = /^([^.]+)\.not\.(.*)$/.exec(condition);
            if (negated) {
              const inner = term(`${negated[1]}.${negated[2]}`);
              return (row) => !inner(row);
            }
            const [column, op, ...rest] = condition.split('.');
            const raw = rest.join('.').replace(/^"|"$/g, '');
            const value = raw === 'null' ? null : raw;
            return (row: Row) => {
              const cell = row[column] ?? null;
              if (op === 'is' || (op === 'eq' && value === null)) return cell === value;
              if (op === 'eq') return cell !== null && String(cell) === value;
              if (op === 'neq') return cell !== null && String(cell) !== value;
              if (op === 'lt') {
                return typeof cell === 'string' && Date.parse(cell) < Date.parse(String(value));
              }
              throw new Error(`The fake has no or-operator ${op}`);
            };
          };
          const groups = top(filter).map((group) => {
            const inner = /^and\((.*)\)$/.exec(group);
            return (inner ? top(inner[1]) : [group]).map(term);
          });
          filters.push((row) => groups.some((conditions) => conditions.every((c) => c(row))));
          return builder;
        },
        textSearch(column, query) {
          // Words as Postgres's parser keeps them, roughly: split on spaces,
          // punctuation trimmed from the ends ("nike.com" stays one word).
          const wordOf = (text: string) =>
            text.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
          const terms = query.split(' & ').map((term) =>
            wordOf(
              term
                .trim()
                .replace(/^'(.*)':\*$/, '$1')
                .replace(/''/g, "'"),
            ),
          );
          filters.push((row) => {
            const words = String(row[column] ?? '')
              .split(/\s+/)
              .map(wordOf);
            return terms.every((term) => words.some((word) => word.startsWith(term)));
          });
          return builder;
        },
        order(column, options) {
          sorts.push({ column, ascending: options?.ascending ?? true });
          return builder;
        },
        limit(count) {
          max = count;
          return builder;
        },
        range(from, to) {
          offset = from;
          max = to - from + 1;
          return builder;
        },
        maybeSingle: () => one(false),
        single: () => one(true),
        then(resolve, reject) {
          return run().then(resolve, reject);
        },
      };
      return builder;
    },
  };
  return fake;
}
