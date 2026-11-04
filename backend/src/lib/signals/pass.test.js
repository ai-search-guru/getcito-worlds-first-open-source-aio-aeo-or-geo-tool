import { beforeEach, describe, expect, it, vi } from 'vitest';

const from = vi.fn();
vi.mock('../../config/supabase.js', () => ({ default: { from: (...a) => from(...a) } }));
vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const recordSignalsForBrand = vi.fn();
const generateActionsForBrand = vi.fn();
vi.mock('./record.js', () => ({ recordSignalsForBrand: (...a) => recordSignalsForBrand(...a) }));
vi.mock('../action-center/generate.js', () => ({
  generateActionsForBrand: (...a) => generateActionsForBrand(...a),
}));
const rescoreBrandActions = vi.fn();
vi.mock('../action-center/priorityData.js', () => ({
  rescoreBrandActions: (...a) => rescoreBrandActions(...a),
}));
const activeBrandFilter = vi.fn();
const isBrandActive = vi.fn();
vi.mock('../activeSubscriptions.js', () => ({
  activeBrandFilter: (...a) => activeBrandFilter(...a),
  isBrandActive: (...a) => isBrandActive(...a),
}));
const sweepActionTasks = vi.fn();
vi.mock('../action-center/task-writer/index.js', () => ({
  sweepActionTasks: (...a) => sweepActionTasks(...a),
}));
const sweepStaleActions = vi.fn();
vi.mock('../action-center/stale.js', () => ({
  sweepStaleActions: (...a) => sweepStaleActions(...a),
}));

import { runFirstSignalPass, runSignalCatchUp, runSignalPass } from './pass.js';

const BRAND = 'brand-1';
const NOW = new Date('2026-09-25T06:00:00Z');
const RUN_AT = '2026-09-25T02:13:00.000Z';

/**
 * Enough PostgREST to drive the pass: `tracking_runs` and `signal_runs`
 * answer from the fixtures, and every write is recorded.
 */
function mockDb({ runs = [], passes = [] } = {}) {
  const writes = [];
  writes.filters = [];
  from.mockImplementation((table) => {
    const builder = {
      select: () => builder,
      eq: (column, value) => {
        writes.filters.push({ table, column, value });
        return builder;
      },
      not: () => builder,
      gte: () => builder,
      order: () => builder,
      limit: () => builder,
      upsert: (row) => {
        writes.push({ table, row });
        return Promise.resolve({ error: null });
      },
      then: (resolve, reject) => {
        const data = table === 'tracking_runs' ? runs : table === 'signal_runs' ? passes : [];
        return Promise.resolve({ data, error: null }).then(resolve, reject);
      },
    };
    return builder;
  });
  return writes;
}

beforeEach(() => {
  sweepStaleActions.mockReset();
  sweepStaleActions.mockResolvedValue({ marked: 1, cleared: 0 });
  from.mockReset();
  recordSignalsForBrand.mockReset();
  generateActionsForBrand.mockReset();
  rescoreBrandActions.mockReset();
  rescoreBrandActions.mockResolvedValue(3);
  recordSignalsForBrand.mockResolvedValue({ inserted: 2, refreshed: 1 });
  generateActionsForBrand.mockResolvedValue({ created: 1, refreshed: 0 });
  // Every brand's organization on a plan unless a test says otherwise.
  activeBrandFilter.mockReset().mockResolvedValue(() => true);
  isBrandActive.mockReset().mockResolvedValue(true);
  sweepActionTasks.mockReset().mockResolvedValue({ written: 0, skipped: 0, failed: 0 });
});

describe('runSignalPass', () => {
  it('records signals, generates actions, and logs the pass against the run', async () => {
    const writes = mockDb({ runs: [{ completed_at: RUN_AT }] });

    const result = await runSignalPass(BRAND, { now: NOW });

    expect(recordSignalsForBrand).toHaveBeenCalledOnce();
    expect(generateActionsForBrand).toHaveBeenCalledOnce();
    expect(result.trackingRunAt).toBe(RUN_AT);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      table: 'signal_runs',
      row: { brand_id: BRAND, tracking_run_at: RUN_AT, outcome: 'recorded' },
    });
  });

  /**
   * The row is the whole point of the ledger: written only when the pass
   * finished, so a pass that threw is exactly what the sweep can find.
   */
  it('logs nothing when recording throws, so the sweep can find the night', async () => {
    const writes = mockDb({ runs: [{ completed_at: RUN_AT }] });
    recordSignalsForBrand.mockRejectedValue(new Error('canceling statement due to timeout'));

    await expect(runSignalPass(BRAND, { now: NOW })).rejects.toThrow(/timeout/);

    expect(writes).toHaveLength(0);
  });

  it('logs nothing when action generation throws', async () => {
    const writes = mockDb({ runs: [{ completed_at: RUN_AT }] });
    generateActionsForBrand.mockRejectedValue(new Error('boom'));

    await expect(runSignalPass(BRAND, { now: NOW })).rejects.toThrow('boom');

    expect(writes).toHaveLength(0);
  });

  /**
   * A run with no fresh results is a decision, not a failure — recording it
   * stops the sweep from retrying the same empty night every morning.
   */
  it('logs a deliberate skip and does not generate actions', async () => {
    const writes = mockDb({ runs: [{ completed_at: RUN_AT }] });
    recordSignalsForBrand.mockResolvedValue({ skipped: 'no_fresh_results' });

    await runSignalPass(BRAND, { now: NOW });

    expect(generateActionsForBrand).not.toHaveBeenCalled();
    expect(writes[0].row.outcome).toBe('skipped');
  });

  /**
   * The generator is what scores the active actions again each night; with
   * no generator, the pass scores them itself.
   */
  it("still scores the brand's active actions on a skipped night", async () => {
    const writes = mockDb({ runs: [{ completed_at: RUN_AT }] });
    recordSignalsForBrand.mockResolvedValue({ skipped: 'no_fresh_results' });

    await runSignalPass(BRAND, { now: NOW });

    expect(rescoreBrandActions).toHaveBeenCalledWith(BRAND, { now: NOW });
    expect(writes[0].row.detail.actions).toEqual({ rescored: 3 });
  });

  it('logs a skipped night even when its scores fail', async () => {
    const writes = mockDb({ runs: [{ completed_at: RUN_AT }] });
    recordSignalsForBrand.mockResolvedValue({ skipped: 'no_fresh_results' });
    rescoreBrandActions.mockRejectedValue(new Error('timeout'));

    await runSignalPass(BRAND, { now: NOW });

    expect(writes[0].row).toMatchObject({ outcome: 'skipped', detail: { actions: null } });
  });

  // 00432: an action left New with no one on it for a month is marked stale.
  it('marks stale actions on a recorded night and a skipped one, and logs it', async () => {
    let writes = mockDb({ runs: [{ completed_at: RUN_AT }] });
    recordSignalsForBrand.mockResolvedValue({ inserted: 0 });
    generateActionsForBrand.mockResolvedValue({ created: 0 });
    await runSignalPass(BRAND, { now: NOW });
    expect(sweepStaleActions).toHaveBeenCalledWith(BRAND, { now: NOW });
    expect(writes[0].row.detail.stale).toEqual({ marked: 1, cleared: 0 });

    writes = mockDb({ runs: [{ completed_at: RUN_AT }] });
    recordSignalsForBrand.mockResolvedValue({ skipped: 'no_fresh_results' });
    await runSignalPass(BRAND, { now: NOW });
    expect(sweepStaleActions).toHaveBeenCalledTimes(2);
  });

  it('logs the pass even when marking stale actions fails', async () => {
    const writes = mockDb({ runs: [{ completed_at: RUN_AT }] });
    recordSignalsForBrand.mockResolvedValue({ inserted: 0 });
    generateActionsForBrand.mockResolvedValue({ created: 0 });
    sweepStaleActions.mockRejectedValue(new Error('timeout'));
    await runSignalPass(BRAND, { now: NOW });
    expect(writes[0].row).toMatchObject({ outcome: 'recorded', detail: { stale: null } });
  });

  it('leaves the scores to the generator on a recorded night', async () => {
    mockDb({ runs: [{ completed_at: RUN_AT }] });

    await runSignalPass(BRAND, { now: NOW });

    expect(rescoreBrandActions).not.toHaveBeenCalled();
  });

  it('does nothing for a brand whose nightly run has never stamped', async () => {
    const writes = mockDb({ runs: [] });

    const result = await runSignalPass(BRAND, { now: NOW });

    expect(result).toEqual({ skipped: 'no_stamped_run' });
    expect(recordSignalsForBrand).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
  });

  it("has tonight's new actions' tasks written", async () => {
    mockDb({ runs: [{ completed_at: RUN_AT }] });

    await runSignalPass(BRAND, { now: NOW });

    expect(isBrandActive).toHaveBeenCalledWith(BRAND);
    expect(sweepActionTasks).toHaveBeenCalledWith({ brandId: BRAND, now: NOW });
  });

  /**
   * Once the plan has ended (2026-10-27): no signal, no action, no task
   * written, no score, and no row, so a plan bought within the catch-up's
   * window still gets the night.
   */
  it("records nothing and raises no action for a brand whose organization's plan has ended", async () => {
    const writes = mockDb({ runs: [{ completed_at: RUN_AT }] });
    isBrandActive.mockResolvedValue(false);

    const result = await runSignalPass(BRAND, { now: NOW });

    expect(result).toEqual({ skipped: 'subscription_inactive' });
    expect(isBrandActive).toHaveBeenCalledWith(BRAND);
    expect(recordSignalsForBrand).not.toHaveBeenCalled();
    expect(generateActionsForBrand).not.toHaveBeenCalled();
    expect(rescoreBrandActions).not.toHaveBeenCalled();
    expect(sweepActionTasks).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
    expect(from).not.toHaveBeenCalled();
  });

  it('throws, recording nothing, when it cannot tell whether the plan has ended', async () => {
    const writes = mockDb({ runs: [{ completed_at: RUN_AT }] });
    isBrandActive.mockRejectedValue(new Error('brands read: timeout'));

    await expect(runSignalPass(BRAND, { now: NOW })).rejects.toThrow('brands read');
    expect(recordSignalsForBrand).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
  });
});

describe('runSignalCatchUp', () => {
  it('re-runs a brand whose run stamped but whose pass never finished', async () => {
    const writes = mockDb({ runs: [{ brand_id: BRAND, completed_at: RUN_AT }], passes: [] });

    const summary = await runSignalCatchUp({ now: NOW });

    expect(summary).toMatchObject({ recovered: 1, healthy: 0, failed: 0 });
    expect(writes).toHaveLength(1);
  });

  it('leaves a brand alone once its pass is logged', async () => {
    const writes = mockDb({
      runs: [{ brand_id: BRAND, completed_at: RUN_AT }],
      passes: [{ brand_id: BRAND, tracking_run_at: RUN_AT }],
    });

    const summary = await runSignalCatchUp({ now: NOW });

    expect(summary).toMatchObject({ recovered: 0, healthy: 1 });
    expect(recordSignalsForBrand).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
  });

  /** One brand's timeout must not cost every brand behind it in the loop. */
  it('carries on past a brand that fails', async () => {
    mockDb({
      runs: [
        { brand_id: 'big', completed_at: RUN_AT },
        { brand_id: 'small', completed_at: RUN_AT },
      ],
    });
    recordSignalsForBrand.mockImplementation((brandId) =>
      brandId === 'big' ? Promise.reject(new Error('statement timeout')) : Promise.resolve({}),
    );

    const summary = await runSignalCatchUp({ now: NOW });

    expect(summary).toMatchObject({ recovered: 1, failed: 1 });
    expect(recordSignalsForBrand).toHaveBeenCalledTimes(2);
  });

  it('considers only the newest run per brand', async () => {
    mockDb({
      runs: [
        { brand_id: BRAND, completed_at: RUN_AT },
        { brand_id: BRAND, completed_at: '2026-09-24T02:10:00.000Z' },
      ],
    });

    const summary = await runSignalCatchUp({ now: NOW });

    expect(summary.recovered).toBe(1);
  });

  it("catches up no pass for a brand whose organization's plan has ended", async () => {
    const writes = mockDb({
      runs: [
        { brand_id: 'paying', completed_at: RUN_AT },
        { brand_id: 'lapsed', completed_at: RUN_AT },
      ],
    });
    activeBrandFilter.mockResolvedValue((brandId) => brandId === 'paying');

    const summary = await runSignalCatchUp({ now: NOW });

    expect(activeBrandFilter).toHaveBeenCalledWith(['paying', 'lapsed']);
    expect(summary).toMatchObject({ recovered: 1, healthy: 0, failed: 0, inactive: 1 });
    expect(recordSignalsForBrand).toHaveBeenCalledTimes(1);
    expect(recordSignalsForBrand.mock.calls[0][0]).toBe('paying');
    expect(writes.map((w) => w.row.brand_id)).toEqual(['paying']);
  });

  it('reports rather than throws when the sweep itself fails', async () => {
    from.mockImplementation(() => {
      throw new Error('connection refused');
    });

    expect(await runSignalCatchUp({ now: NOW })).toEqual({ error: true });
  });
});

/**
 * A new brand's first run is a manual one. Passes otherwise wait for the
 * nightly run, which left a new brand's Action Center empty for up to a day.
 */
describe('runFirstSignalPass', () => {
  it('runs a pass against the manual run a brand with no passes just finished', async () => {
    const writes = mockDb({ runs: [{ completed_at: RUN_AT }], passes: [] });

    const result = await runFirstSignalPass(BRAND, { now: NOW });

    expect(result.trackingRunAt).toBe(RUN_AT);
    expect(generateActionsForBrand).toHaveBeenCalledOnce();
    // Any source: the run it covers is not a nightly one.
    expect(writes.filters).not.toContainEqual({
      table: 'tracking_runs',
      column: 'source',
      value: 'cron',
    });
  });

  /** Otherwise every manual refresh would re-run detection. */
  it('does nothing for a brand that has had a pass', async () => {
    const writes = mockDb({
      runs: [{ completed_at: RUN_AT }],
      passes: [{ brand_id: BRAND }],
    });

    expect(await runFirstSignalPass(BRAND, { now: NOW })).toEqual({ skipped: 'not_first' });
    expect(recordSignalsForBrand).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
  });

  it('does nothing when no run has stamped', async () => {
    mockDb({ runs: [], passes: [] });

    expect(await runFirstSignalPass(BRAND, { now: NOW })).toEqual({ skipped: 'no_stamped_run' });
    expect(recordSignalsForBrand).not.toHaveBeenCalled();
  });

  it("raises nothing for a new brand whose organization's plan has ended", async () => {
    const writes = mockDb({ runs: [{ completed_at: RUN_AT }], passes: [] });
    isBrandActive.mockResolvedValue(false);

    expect(await runFirstSignalPass(BRAND, { now: NOW })).toEqual({
      skipped: 'subscription_inactive',
    });
    expect(generateActionsForBrand).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
  });

  it('leaves the nightly pass reading nightly runs only', async () => {
    const writes = mockDb({ runs: [{ completed_at: RUN_AT }] });

    await runSignalPass(BRAND, { now: NOW });

    expect(writes.filters).toContainEqual({
      table: 'tracking_runs',
      column: 'source',
      value: 'cron',
    });
  });
});
