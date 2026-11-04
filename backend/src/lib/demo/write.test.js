import { describe, expect, it } from 'vitest';
import { allSettledOrThrow, demoWriter, insertChunks, limiter } from './write.js';

/**
 * How the demo writes its rows: a few statements at a time, and on a
 * rebuild over the old rows, deleting only the ones not written again.
 */

const tick = (ms = 1) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * An in-memory stand-in for the admin client: tables of rows, the
 * statements it ran, and how many were in flight at most.
 */
function fakeDb(tables = {}, { failOn = null } = {}) {
  const db = { tables, statements: [], inFlight: 0, maxInFlight: 0 };
  const matches = (row, filters) =>
    filters.every(([op, column, value]) =>
      op === 'in' ? value.includes(row[column]) : row[column] === value,
    );
  db.from = (table) => {
    const q = { table, op: 'select', filters: [], order: [], range: null };
    const run = async () => {
      db.inFlight += 1;
      db.maxInFlight = Math.max(db.maxInFlight, db.inFlight);
      await tick();
      db.inFlight -= 1;
      db.statements.push(q);
      if (failOn && failOn(q)) return { data: null, error: { message: 'boom' } };
      const rows = (tables[table] ??= []);
      if (q.op === 'insert') {
        rows.push(...q.payload.map((r) => ({ ...r })));
        return { data: null, error: null };
      }
      if (q.op === 'upsert') {
        const columns = q.onConflict.split(',');
        for (const row of q.payload) {
          const same = rows.find((r) => columns.every((c) => r[c] === row[c]));
          if (same) Object.assign(same, row);
          else rows.push({ ...row });
        }
        return { data: null, error: null };
      }
      const hit = rows.filter((r) => matches(r, q.filters));
      if (q.op === 'delete') {
        tables[table] = rows.filter((r) => !hit.includes(r));
        return { data: null, error: null };
      }
      const sorted = [...hit].sort((a, b) => {
        for (const c of q.order) {
          if (a[c] !== b[c]) return String(a[c]) < String(b[c]) ? -1 : 1;
        }
        return 0;
      });
      const [from, to] = q.range ?? [0, sorted.length];
      const columns = q.columns.split(',').map((c) => c.trim());
      return {
        data: sorted
          .slice(from, to + 1)
          .map((r) => Object.fromEntries(columns.map((c) => [c, r[c]]))),
        error: null,
      };
    };
    const chain = {
      insert: (payload) => ((q.op = 'insert'), (q.payload = payload), chain),
      upsert: (payload, { onConflict }) => (
        (q.op = 'upsert'),
        (q.payload = payload),
        (q.onConflict = onConflict),
        chain
      ),
      select: (columns) => ((q.columns = columns), chain),
      delete: () => ((q.op = 'delete'), chain),
      eq: (column, value) => (q.filters.push(['eq', column, value]), chain),
      in: (column, values) => (q.filters.push(['in', column, values]), chain),
      match: (obj) => {
        for (const [column, value] of Object.entries(obj)) q.filters.push(['eq', column, value]);
        return chain;
      },
      order: (column) => (q.order.push(column), chain),
      range: (from, to) => ((q.range = [from, to]), chain),
      then: (resolve, reject) => run().then(resolve, reject),
    };
    return chain;
  };
  return db;
}

const rowsOf = (n, make) => Array.from({ length: n }, (_, i) => make(i));

describe('limiter', () => {
  it('runs at most `limit` tasks at once, each resolving as its task does', async () => {
    const run = limiter(2);
    let active = 0;
    let most = 0;
    const task = (value) => async () => {
      active += 1;
      most = Math.max(most, active);
      await tick(2);
      active -= 1;
      return value;
    };
    expect(await Promise.all([1, 2, 3, 4, 5].map((v) => run(task(v))))).toEqual([1, 2, 3, 4, 5]);
    expect(most).toBe(2);
  });

  it('starts nothing after a failure; the queued tasks reject with it', async () => {
    const run = limiter(1);
    const started = [];
    const task = (name, fail) => async () => {
      started.push(name);
      await tick();
      if (fail) throw new Error(`${name} failed`);
      return name;
    };
    const results = await Promise.allSettled([
      run(task('a')),
      run(task('b', true)),
      run(task('c')),
      run(task('d')),
    ]);
    expect(started).toEqual(['a', 'b']);
    expect(results.map((r) => r.value ?? r.reason.message)).toEqual([
      'a',
      'b failed',
      'b failed',
      'b failed',
    ]);
  });
});

describe('allSettledOrThrow', () => {
  it('waits for every write to settle before it throws the failure', async () => {
    let slowDone = false;
    const slow = tick(10).then(() => {
      slowDone = true;
    });
    await expect(allSettledOrThrow([Promise.reject(new Error('boom')), slow])).rejects.toThrow(
      'boom',
    );
    expect(slowDone).toBe(true);
    expect(await allSettledOrThrow([Promise.resolve(1), 2])).toEqual([1, 2]);
  });
});

describe('insertChunks', () => {
  it('writes every row, a chunk per statement, a few statements at once', async () => {
    const db = fakeDb();
    const rows = rowsOf(1000, (i) => ({ id: `r${i}` }));
    await insertChunks(db, 'items', rows, { chunk: 100, concurrency: 4 });
    expect(db.tables.items).toHaveLength(1000);
    expect(db.statements).toHaveLength(10);
    expect(db.statements.every((s) => s.op === 'insert' && s.payload.length === 100)).toBe(true);
    expect(db.maxInFlight).toBe(4);
  });

  it('writes over the rows with the same key when given one', async () => {
    const db = fakeDb({ items: [{ a: 1, b: 2, v: 'old' }] });
    await insertChunks(db, 'items', [{ a: 1, b: 2, v: 'new' }], { onConflict: 'a,b' });
    expect(db.tables.items).toEqual([{ a: 1, b: 2, v: 'new' }]);
  });

  it("fails with the table's name, after the statements under way settle", async () => {
    const db = fakeDb({}, { failOn: (q) => q.payload?.[0]?.id === 'r100' });
    const rows = rowsOf(500, (i) => ({ id: `r${i}` }));
    await expect(insertChunks(db, 'items', rows, { chunk: 100, concurrency: 2 })).rejects.toThrow(
      'demo items insert: boom',
    );
    // The chunk beside the failed one finished; none started after it.
    expect(db.inFlight).toBe(0);
    expect(db.statements.length).toBeLessThan(5);
  });
});

describe('demoWriter', () => {
  it("writes over what a new brand's triggers made on a first build, and prunes nothing", async () => {
    const db = fakeDb({ steps: [{ brand_id: 'b1', step: 'visibility', done: false }] });
    const writer = demoWriter({ db, brandId: 'b1', keys: { steps: 'brand_id,step' } });
    await writer.write('steps', [
      { brand_id: 'b1', step: 'visibility', done: true },
      { brand_id: 'b1', step: 'answers', done: true },
    ]);
    expect(await writer.prune()).toEqual({});
    expect(db.statements.map((s) => s.op)).toEqual(['upsert']);
    expect(db.tables.steps).toHaveLength(2);
  });

  it('shares one queue across tables written side by side', async () => {
    const db = fakeDb();
    const writer = demoWriter({ db, brandId: 'b1', concurrency: 3 });
    await Promise.all(
      ['a', 'b', 'c', 'd'].map((t) =>
        writer.write(
          t,
          rowsOf(500, (i) => ({ id: `${t}${i}` })),
          { chunk: 100 },
        ),
      ),
    );
    expect(db.statements).toHaveLength(20);
    expect(db.maxInFlight).toBe(3);
  });

  it('on a rebuild writes over the old rows, then deletes only the ones not written again', async () => {
    const db = fakeDb({
      results: [
        { id: 'r1', brand_id: 'b1', v: 'old' },
        { id: 'r2', brand_id: 'b1', v: 'old' },
        { id: 'r3', brand_id: 'b1', v: 'old' }, // no longer built
        { id: 'r9', brand_id: 'b2', v: 'other brand' },
      ],
      citations: [
        { result_id: 'r1', position: 1, brand_id: 'b1', v: 'old' },
        { result_id: 'r1', position: 2, brand_id: 'b1', v: 'old' }, // no longer built
        { result_id: 'r2', position: 1, brand_id: 'b1', v: 'old' },
        { result_id: 'r3', position: 1, brand_id: 'b1', v: 'old' }, // its answer is gone
        { result_id: 'r9', position: 1, brand_id: 'b2', v: 'other brand' },
      ],
    });
    const writer = demoWriter({
      db,
      brandId: 'b1',
      rebuild: true,
      keys: { citations: 'result_id,position' },
    });
    await writer.write('results', [
      { id: 'r1', brand_id: 'b1', v: 'new' },
      { id: 'r2', brand_id: 'b1', v: 'new' },
    ]);
    await writer.write('citations', [
      { result_id: 'r1', position: 1, brand_id: 'b1', v: 'new' },
      { result_id: 'r2', position: 1, brand_id: 'b1', v: 'new' },
    ]);
    // Written over, nothing deleted yet: the old rows stay on show.
    expect(db.statements.map((s) => s.op)).toEqual(['upsert', 'upsert']);
    expect(db.statements[1].onConflict).toBe('result_id,position');
    expect(db.tables.results).toHaveLength(4);

    expect(await writer.prune()).toEqual({ citations: 2, results: 1 });
    expect(db.tables.results).toEqual([
      { id: 'r1', brand_id: 'b1', v: 'new' },
      { id: 'r2', brand_id: 'b1', v: 'new' },
      { id: 'r9', brand_id: 'b2', v: 'other brand' },
    ]);
    expect(db.tables.citations.map((c) => `${c.result_id}:${c.position}:${c.v}`)).toEqual([
      'r1:1:new',
      'r2:1:new',
      'r9:1:other brand',
    ]);
    // The children before the parents.
    const deletes = db.statements.filter((s) => s.op === 'delete').map((s) => s.table);
    expect(deletes).toEqual(['citations', 'citations', 'results']);
  });

  it("finds a table's rows through the table it points at when it has no brand_id", async () => {
    const db = fakeDb({
      sets: [
        { id: 's1', brand_id: 'b1' },
        { id: 's9', brand_id: 'b2' },
      ],
      prompts: [
        { id: 'p1', set_id: 's1' },
        { id: 'p2', set_id: 's1' }, // no longer built
        { id: 'p9', set_id: 's9' }, // another brand's
      ],
    });
    const writer = demoWriter({
      db,
      brandId: 'b1',
      rebuild: true,
      scopes: { prompts: ['set_id', 'sets'] },
    });
    await writer.write('sets', [{ id: 's1', brand_id: 'b1' }]);
    await writer.write('prompts', [{ id: 'p1', set_id: 's1' }]);
    expect(await writer.prune()).toEqual({ prompts: 1 });
    expect(db.tables.prompts.map((p) => p.id)).toEqual(['p1', 'p9']);
  });

  it('replaces the rows of a table whose ids the database gives, old ones after the new', async () => {
    const db = fakeDb({
      events: [
        { id: 1, brand_id: 'b1', v: 'old' },
        { id: 2, brand_id: 'b1', v: 'old' },
        { id: 3, brand_id: 'b2', v: 'other brand' },
      ],
    });
    const writer = demoWriter({ db, brandId: 'b1', rebuild: true });
    await writer.write('events', [{ brand_id: 'b1', v: 'new' }], { generated: true });
    expect(db.statements.map((s) => `${s.op} ${s.table}`)).toEqual([
      'select events',
      'insert events',
      'delete events',
    ]);
    expect(db.tables.events.map((e) => e.v)).toEqual(['other brand', 'new']);
    // Nothing left for the prune.
    expect(await writer.prune()).toEqual({});
  });

  it('only inserts such rows on a first build', async () => {
    const db = fakeDb();
    const writer = demoWriter({ db, brandId: 'b1' });
    await writer.write('events', [{ brand_id: 'b1', v: 'new' }], { generated: true });
    expect(db.statements.map((s) => s.op)).toEqual(['insert']);
  });

  it('reads a large table page by page', async () => {
    const old = rowsOf(2500, (i) => ({ id: `r${String(i).padStart(4, '0')}`, brand_id: 'b1' }));
    const db = fakeDb({ results: old.map((r) => ({ ...r })) });
    const writer = demoWriter({ db, brandId: 'b1', rebuild: true });
    await writer.write('results', old.slice(0, 2000));
    expect(await writer.prune()).toEqual({ results: 500 });
    const reads = db.statements.filter((s) => s.op === 'select');
    expect(reads.map((s) => s.range)).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
    expect(db.tables.results).toHaveLength(2000);
  });
});
