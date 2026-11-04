import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Content Agent's runs, step by step (CE-027/035, 00249): written as they
 * go, shown in the editor, and stopped from it — a run stopped keeps nothing.
 */

let rows;
let writes;
let failInsert;
/** The error an insert answers, when it isn't `failInsert`'s. */
let insertError;
let failDelete = false;
/** The reads made, each with its filters. */
let reads;

vi.mock('../config/supabase.js', () => ({
  default: {
    from: (table) => {
      const call = { table, filters: [] };
      const chain = {
        insert: (value) => {
          writes.push({ table, op: 'insert', value });
          return {
            select: () => ({
              single: async () =>
                insertError
                  ? { data: null, error: insertError }
                  : failInsert
                    ? { data: null, error: new Error('down') }
                    : { data: { id: 'run-1' }, error: null },
            }),
          };
        },
        update: (value) => (writes.push({ table, op: 'update', value, call }), chain),
        delete: () => {
          writes.push({ table, op: 'delete', call });
          return failDelete
            ? { eq: async () => ({ error: new Error('down') }) }
            : {
                eq: (col, v) => (
                  call.filters.push(['eq', col, v]),
                  Promise.resolve({ error: null })
                ),
              };
        },
        select: (columns) => ((call.columns = columns), reads.push(call), chain),
        eq: (col, v) => (call.filters.push(['eq', col, v]), chain),
        is: (col, v) => (call.filters.push(['is', col, v]), chain),
        in: (col, v) => (call.filters.push(['in', col, v]), chain),
        gt: (col, v) => (call.filters.push(['gt', col, v]), chain),
        lt: (col, v) => (call.filters.push(['lt', col, v]), chain),
        gte: () => chain,
        or: () => chain,
        order: () => chain,
        limit: () => chain,
        maybeSingle: async () => ({ data: rows[table] ?? null, error: null }),
        then: (resolve) => resolve({ data: rows.updated ?? [], error: null }),
      };
      return chain;
    },
  },
}));
vi.mock('./logger.js', () => ({ logger: { warn: vi.fn(), error: vi.fn() } }));

const {
  RunStoppedError,
  advanceRun,
  callSignal,
  dropRun,
  finishRun,
  fixUnderWay,
  isStop,
  runCall,
  runSteps,
  startRun,
  stopDraftRun,
  stopIfStopped,
  wasStopped,
} = await import('./contentRuns.js');

beforeEach(() => {
  rows = {};
  writes = [];
  reads = [];
  failInsert = false;
  insertError = null;
});

describe('fixUnderWay', () => {
  it('finds a fix or a hand-off still going on the draft, not one a stopped server left nor one Stop ended', async () => {
    rows.updated = [{ id: 'run-1' }];
    await expect(fixUnderWay('d1')).resolves.toBe(true);
    const [read] = reads;
    expect(read.table).toBe('content_agent_runs');
    expect(read.filters).toEqual([
      ['eq', 'draft_id', 'd1'],
      ['in', 'kind', ['fix', 'handoff']],
      ['is', 'finished_at', null],
      // Stopped: its batch is dropped, so a Start or another Fix may go.
      ['is', 'stopped_at', null],
      ['gt', 'started_at', expect.any(String)],
    ]);
    // Within RUN_STALE_MS: an older one is a stopped server's.
    expect(Date.now() - Date.parse(read.filters[4][2])).toBeGreaterThanOrEqual(10 * 60_000);
    rows.updated = [];
    await expect(fixUnderWay('d1')).resolves.toBe(false);
  });
});

describe('runSteps', () => {
  it('names each kind’s steps by the work the server does, with the run’s counts', () => {
    expect(runSteps('fix', { rules: 4, sources: 52 })).toEqual([
      { key: 'read_rules', count: 4 },
      { key: 'gather_sources', count: 52 },
      { key: 'write_changes', count: null },
      { key: 'check_sources', count: null },
    ]);
    expect(runSteps('rewrite', { sources: 52, rules: 14 }).map((s) => s.key)).toEqual([
      'read_rules',
      'gather_sources',
      'rewrite_page',
      'check_sources',
    ]);
    expect(runSteps('brief', { sources: 52 })).toEqual([
      { key: 'gather_sources', count: 52 },
      { key: 'write_outline', count: null },
      { key: 'match_fanouts', count: null },
    ]);
    expect(runSteps('write', {}).map((s) => s.count)).toEqual([null, null, null, null]);
  });
});

describe('a run', () => {
  it('is written with its steps, moves on, and ends done with what it learned', async () => {
    const run = await startRun({
      draftId: 'd1',
      kind: 'fix',
      counts: { rules: 2, sources: 3 },
    });
    expect(run.id).toBe('run-1');
    // Runs a stopped server left on the draft are closed first.
    expect(writes[0]).toMatchObject({
      table: 'content_agent_runs',
      op: 'update',
      value: { outcome: 'failed', finished_at: expect.any(String) },
    });
    // Only runs older than any still going: another tab's run goes on.
    expect(writes[0].call.filters).toEqual([
      ['eq', 'draft_id', 'd1'],
      ['is', 'finished_at', null],
      ['lt', 'started_at', expect.any(String)],
    ]);
    expect(writes[1]).toMatchObject({
      table: 'content_agent_runs',
      op: 'insert',
      value: { draft_id: 'd1', kind: 'fix' },
    });
    await advanceRun(run, 2);
    expect(writes[2].value).toMatchObject({ step: 2 });
    expect(writes[2].call.filters).toContainEqual(['is', 'finished_at', null]);
    await finishRun(run, 'done', { 2: 4 });
    expect(writes[3].value).toMatchObject({
      outcome: 'done',
      step: 4,
      steps: expect.arrayContaining([{ key: 'write_changes', count: 4 }]),
    });
  });

  it('still runs when it can’t be written: no steps, and its timeout', async () => {
    failInsert = true;
    const run = await startRun({ draftId: 'd1', kind: 'brief', counts: {} });
    expect(run.id).toBeNull();
    await advanceRun(run, 1);
    await finishRun(run, 'done');
    // The earlier runs' close and the insert: no step, no end.
    expect(writes).toHaveLength(2);
    expect(await wasStopped(run)).toBe(false);
  });

  it('is stopped by a request: marked, its model call aborted, and nothing kept', async () => {
    const run = await startRun({ draftId: 'd1', kind: 'fix', counts: {} });
    rows.updated = [{ id: 'run-1', claimed_at: null }];
    // The runs it stopped, each with the claim it holds (none for a Fix).
    await expect(stopDraftRun('d1')).resolves.toEqual([{ id: 'run-1', claimed_at: null }]);
    const mark = writes.find((w) => w.op === 'update' && 'stopped_at' in w.value);
    expect(mark.value).toEqual({ stopped_at: expect.any(String) });
    expect(mark.call.columns).toBe('id, claimed_at');
    // Only a run under way: one a stopped server left long ago isn't.
    expect(mark.call.filters).toEqual([
      ['eq', 'draft_id', 'd1'],
      ['is', 'finished_at', null],
      ['is', 'stopped_at', null],
      ['gt', 'started_at', expect.any(String)],
    ]);
    // The run the editor shows, when it names it.
    rows.updated = [];
    await stopDraftRun('d1', 'run-9');
    const named = writes.filter((w) => w.op === 'update' && 'stopped_at' in w.value).at(-1);
    expect(named.call.filters).toContainEqual(['eq', 'id', 'run-9']);
    expect(run.signal.aborted).toBe(true);
    expect(isStop(new Error('This operation was aborted'), run)).toBe(true);
    await expect(stopIfStopped(run)).rejects.toBeInstanceOf(RunStoppedError);
    await finishRun(run, 'stopped');
  });

  it('reads a stop made on another server, and answers no run under way', async () => {
    const run = await startRun({ draftId: 'd1', kind: 'fix', counts: {} });
    rows.content_agent_runs = { stopped_at: '2026-10-23T10:00:00Z' };
    expect(await wasStopped(run)).toBe(true);
    expect(isStop(new RunStoppedError(), run)).toBe(true);
    expect(isStop(new Error('model down'), run)).toBe(false);
    await finishRun(run, 'failed');
    rows.updated = [];
    await expect(stopDraftRun('d1')).resolves.toEqual([]);
  });

  it('carries the claim a Start or Rewrite holds on the draft, none for a Fix', async () => {
    await startRun({
      draftId: 'd1',
      kind: 'write',
      counts: {},
      claimedAt: '2026-10-23T10:00:00.000Z',
    });
    await startRun({ draftId: 'd1', kind: 'fix', counts: {} });
    const inserts = writes.filter((w) => w.op === 'insert').map((w) => w.value);
    expect(inserts[0]).toMatchObject({ kind: 'write', claimed_at: '2026-10-23T10:00:00.000Z' });
    expect(inserts[1]).toMatchObject({ kind: 'fix', claimed_at: null });
  });

  it('sends no call once stopped, and keeps the hold of one a Stop aborted', async () => {
    const budget = { keep: vi.fn(async () => {}) };
    // Stopped before its call: nothing is sent, and the hold can go.
    const run = await startRun({ draftId: 'd1', kind: 'fix', counts: {} });
    rows.content_agent_runs = { stopped_at: '2026-10-23T10:00:00Z' };
    const call = vi.fn();
    await expect(runCall(run, budget, 1000, call)).rejects.toBeInstanceOf(RunStoppedError);
    expect(call).not.toHaveBeenCalled();
    expect(budget.keep).not.toHaveBeenCalled();
    await finishRun(run, 'stopped');

    // Stopped while its call is out: the provider bills it, so the hold stays.
    rows.content_agent_runs = null;
    const next = await startRun({ draftId: 'd1', kind: 'fix', counts: {} });
    let sent = () => {};
    const out = runCall(
      next,
      budget,
      60_000,
      (signal) =>
        new Promise((_, reject) => {
          signal.addEventListener('abort', () => reject(new Error('This operation was aborted')));
          sent();
        }),
    );
    await new Promise((resolve) => (sent = resolve));
    rows.updated = [{ id: 'run-1' }];
    await stopDraftRun('d1');
    await expect(out).rejects.toThrow('aborted');
    expect(budget.keep).toHaveBeenCalledTimes(1);
    await finishRun(next, 'stopped');

    // With the real budget: the stopped call leaves its usage row.
    const { reserveAiBudget } = await import('./planGuard.js');
    const real = await reserveAiBudget('o1', { feature: 'content', modelId: 'm', draftId: 'd1' });
    const again = await startRun({ draftId: 'd1', kind: 'fix', counts: {} });
    let sentAgain = () => {};
    const outAgain = runCall(
      again,
      real,
      60_000,
      (signal) =>
        new Promise((_, reject) => {
          signal.addEventListener('abort', () => reject(new Error('This operation was aborted')));
          sentAgain();
        }),
    );
    await new Promise((resolve) => (sentAgain = resolve));
    await stopDraftRun('d1');
    await expect(outAgain).rejects.toThrow('aborted');
    await real.release();
    expect(writes).toContainEqual(
      expect.objectContaining({
        table: 'prompt_improve_usage',
        op: 'insert',
        value: expect.objectContaining({ feature: 'content', content_draft_id: 'd1' }),
      }),
    );
    await finishRun(again, 'stopped');

    // A call that fails on its own lets the hold go as before.
    const third = await startRun({ draftId: 'd1', kind: 'fix', counts: {} });
    await expect(
      runCall(third, budget, 1000, async () => {
        throw new Error('model down');
      }),
    ).rejects.toThrow('model down');
    expect(budget.keep).toHaveBeenCalledTimes(1);
    await finishRun(third, 'failed');
  });

  it('tells its own Stop from a call that timed out', async () => {
    const run = await startRun({ draftId: 'd1', kind: 'fix', counts: {} });
    const signal = callSignal(run, 1);
    await new Promise((resolve) => setTimeout(resolve, 20));
    // The call's timeout fired, not the run's Stop: a failure, not a stop.
    expect(signal.aborted).toBe(true);
    expect(run.signal.aborted).toBe(false);
    expect(isStop(Object.assign(new Error('timed out'), { name: 'TimeoutError' }), run)).toBe(
      false,
    );
    await finishRun(run, 'failed');
  });
});

describe('Quality’s hand-off runs (CE-051)', () => {
  it('reads the page’s checks first, and writes who started it', async () => {
    expect(runSteps('handoff', { checks: 6, sources: 12 }).map((s) => [s.key, s.count])).toEqual([
      ['read_checks', 6],
      ['gather_sources', 12],
      ['write_changes', null],
      ['check_sources', null],
    ]);
    await startRun({ draftId: 'd1', kind: 'handoff', counts: {}, origin: 'auto', strict: true });
    expect(writes.find((w) => w.op === 'insert').value).toMatchObject({
      kind: 'handoff',
      origin: 'auto',
    });
    // A person's is the column's default: a database before 00275 takes the row.
    writes = [];
    await startRun({ draftId: 'd1', kind: 'fix', counts: {} });
    expect(writes.find((w) => w.op === 'insert').value).not.toHaveProperty('origin');
  });

  it('claims an automatic one once: a second is 409 already, and a run that must be written throws', async () => {
    insertError = { code: '23505', message: 'duplicate key' };
    await expect(
      startRun({ draftId: 'd1', kind: 'handoff', counts: {}, origin: 'auto', strict: true }),
    ).rejects.toMatchObject({ status: 409, code: 'already' });
    insertError = null;
    failInsert = true;
    await expect(
      startRun({ draftId: 'd1', kind: 'handoff', counts: {}, origin: 'auto', strict: true }),
    ).rejects.toThrow('down');
    // Not strict: it runs unshown, as before.
    await expect(startRun({ draftId: 'd1', kind: 'fix', counts: {} })).resolves.toMatchObject({
      id: null,
    });
  });

  it('takes a run’s row back, so its claim goes', async () => {
    const run = await startRun({
      draftId: 'd1',
      kind: 'handoff',
      counts: {},
      origin: 'auto',
      strict: true,
    });
    await dropRun(run);
    expect(writes.find((w) => w.op === 'delete')).toMatchObject({
      table: 'content_agent_runs',
      call: { filters: [['eq', 'id', 'run-1']] },
    });
    // Not taken back (the delete failed): at least not left under way.
    writes = [];
    failDelete = true;
    await dropRun(run);
    expect(writes.map((w) => w.op)).toEqual(['delete', 'update']);
    expect(writes[1].value).toMatchObject({ outcome: 'failed' });
    failDelete = false;
    // No row written: nothing to take back.
    writes = [];
    await dropRun({ id: null });
    expect(writes).toEqual([]);
  });
});
