import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';

/**
 * Route-level tests for volume analysis.
 *
 * The unit tests around analyzeBrandVolumes cover which prompts get analyzed.
 * What only shows up here is the contract the Prompts page depends on: that a
 * brand of any size is accepted, that the answer comes back before the run
 * does, and that a second click cannot start a second pass.
 */

class PlanLimitError extends Error {
  constructor(message, statusCode = 403) {
    super(message);
    this.name = 'PlanLimitError';
    this.statusCode = statusCode;
  }
}

const enforceVolumeQuota = vi.fn();
const getVolumeQuotaStatus = vi.fn();
const assertBrandAccess = vi.fn();
const getVolumeProgress = vi.fn();
const analyzeBrandVolumes = vi.fn();
const insert = vi.fn();

/**
 * The plan ended: requireFeature refuses with 402 unless the route gave it
 * readOnly, as the real one does.
 */
let planEnded = false;
const requireFeature = (_feature, options) => (req, res, next) =>
  planEnded && !options?.readOnly ? res.status(402).json({ error: 'plan_limit' }) : next();

/** Rows a read of each table answers (GET /brand); a table not here only inserts. */
let rows = {};
function from(table) {
  if (!(table in rows)) return { insert };
  const chain = {
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    then: (resolve) => resolve({ data: rows[table], error: null }),
  };
  return chain;
}

/** Lets a test hold a run open and decide exactly when it ends. */
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

let server;
let baseUrl;

async function startApp() {
  vi.resetModules();
  vi.doMock('../lib/planGuard.js', () => ({
    PlanLimitError,
    enforceVolumeQuota,
    getVolumeQuotaStatus,
    requireFeature,
  }));
  vi.doMock('../lib/access.js', () => ({
    assertBrandAccess,
    assertPromptAccess: vi.fn(),
  }));
  vi.doMock('../lib/volumeAnalysis.js', () => ({
    getVolumeProgress,
    analyzeBrandVolumes,
    mapVolumeRow: (r) => r,
    fetchAndSaveVolumes: vi.fn(),
  }));
  vi.doMock('../config/supabase.js', () => ({ default: { from } }));
  vi.doMock('../lib/logger.js', () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() };
    return { default: logger, logger };
  });
  vi.doMock('../lib/aiProvider.js', () => ({ resolveModel: vi.fn() }));
  vi.doMock('../lib/dataforseoCodes.js', () => ({
    regionToLocationCode: vi.fn(),
    languageToCode: vi.fn(),
  }));

  const { default: router } = await import('./volumes.js');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'u1' };
    req.log = { error: vi.fn(), info: vi.fn() };
    next();
  });
  app.use('/api/volumes', router);

  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/volumes`;
}

const post = (body) =>
  fetch(`${baseUrl}/analyze-batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

beforeEach(async () => {
  vi.clearAllMocks();
  rows = {};
  planEnded = false;
  enforceVolumeQuota.mockResolvedValue({ remaining: -1, orgId: 'org1' });
  assertBrandAccess.mockResolvedValue(undefined);
  getVolumeProgress.mockResolvedValue({ total: 100, analyzed: 0 });
  analyzeBrandVolumes.mockResolvedValue([]);
  insert.mockResolvedValue({ error: null });
  await startApp();
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe('POST /analyze-batch', () => {
  // The failure this whole change exists for: the route used to refuse more
  // than 50 prompts, so the page's own "Analyze 100 prompts" button returned
  // 400 every time.
  it('accepts a brand with 100 prompts', async () => {
    const res = await post({ brandId: 'b1' });

    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ started: 100, running: true });
  });

  it('answers before the run finishes, not after', async () => {
    const run = deferred();
    analyzeBrandVolumes.mockReturnValue(run.promise);

    const res = await post({ brandId: 'b1' });

    // The response is already here while the run is still outstanding — an
    // eleven-minute request would be cut long before this point.
    expect(res.status).toBe(202);
    run.resolve([]);
  });

  it('starts only the prompts that have no volumes yet', async () => {
    getVolumeProgress.mockResolvedValue({ total: 100, analyzed: 60 });

    expect(await (await post({ brandId: 'b1' })).json()).toMatchObject({ started: 40 });
    expect(analyzeBrandVolumes).toHaveBeenCalledWith(
      'b1',
      expect.objectContaining({ onlyMissing: true }),
    );
  });

  it('starts every active prompt under force', async () => {
    getVolumeProgress.mockResolvedValue({ total: 100, analyzed: 60 });

    expect(await (await post({ brandId: 'b1', force: true })).json()).toMatchObject({
      started: 100,
    });
    expect(analyzeBrandVolumes).toHaveBeenCalledWith(
      'b1',
      expect.objectContaining({ force: true, onlyMissing: false }),
    );
  });

  it('does nothing when every active prompt already has volumes', async () => {
    getVolumeProgress.mockResolvedValue({ total: 100, analyzed: 100 });

    const res = await post({ brandId: 'b1' });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ started: 0, running: false });
    expect(analyzeBrandVolumes).not.toHaveBeenCalled();
  });

  // Two clicks would otherwise analyze every prompt twice and bill the quota
  // twice. The claim is taken before the first await for exactly this reason.
  it('refuses to start a second run while one is in flight', async () => {
    const run = deferred();
    analyzeBrandVolumes.mockReturnValue(run.promise);

    await post({ brandId: 'b1' });
    const second = await post({ brandId: 'b1' });

    expect(second.status).toBe(202);
    expect(await second.json()).toMatchObject({ started: 0, running: true });
    expect(analyzeBrandVolumes).toHaveBeenCalledTimes(1);

    run.resolve([]);
  });

  // Sequential clicks are the easy case. Two arriving together are the real
  // one: reading "not running" and then awaiting the progress count leaves a
  // gap both requests pass through, and the brand gets analyzed twice.
  it('refuses a second run even when both clicks arrive together', async () => {
    const run = deferred();
    analyzeBrandVolumes.mockReturnValue(run.promise);
    // The progress read is what yields control between the check and the claim.
    getVolumeProgress.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ total: 100, analyzed: 0 }), 5)),
    );

    const [a, b] = await Promise.all([post({ brandId: 'b1' }), post({ brandId: 'b1' })]);
    const bodies = [await a.json(), await b.json()];

    expect(analyzeBrandVolumes).toHaveBeenCalledTimes(1);
    expect(bodies.filter((x) => x.started > 0)).toHaveLength(1);

    run.resolve([]);
  });

  it('holds no claim against a different brand', async () => {
    const run = deferred();
    analyzeBrandVolumes.mockReturnValue(run.promise);

    await post({ brandId: 'b1' });
    await post({ brandId: 'b2' });

    expect(analyzeBrandVolumes).toHaveBeenCalledTimes(2);
    run.resolve([]);
  });

  it('lets the brand start again once the run has ended', async () => {
    const run = deferred();
    analyzeBrandVolumes.mockReturnValue(run.promise);
    await post({ brandId: 'b1' });

    run.resolve([]);
    await new Promise((resolve) => setTimeout(resolve, 10));

    analyzeBrandVolumes.mockResolvedValue([]);
    const again = await post({ brandId: 'b1' });
    expect(await again.json()).toMatchObject({ started: 100, running: true });
    expect(analyzeBrandVolumes).toHaveBeenCalledTimes(2);
  });

  // A failed run must not leave the brand permanently claimed — the next click
  // would report "already running" forever with nothing running.
  it('releases the claim when the run fails', async () => {
    analyzeBrandVolumes.mockRejectedValueOnce(new Error('upstream down'));
    await post({ brandId: 'b1' });
    await new Promise((resolve) => setTimeout(resolve, 10));

    analyzeBrandVolumes.mockResolvedValue([]);
    expect(await (await post({ brandId: 'b1' })).json()).toMatchObject({ started: 100 });
  });

  it('releases the claim when the progress read fails', async () => {
    getVolumeProgress.mockRejectedValueOnce(new Error('db blip'));
    expect((await post({ brandId: 'b1' })).status).toBe(500);

    getVolumeProgress.mockResolvedValue({ total: 100, analyzed: 0 });
    expect(await (await post({ brandId: 'b1' })).json()).toMatchObject({ started: 100 });
  });

  it('requires a brand', async () => {
    expect((await post({})).status).toBe(400);
  });

  // The page distinguishes this from a generic failure so it can offer the
  // upgrade wording; it has to arrive as a code, not as prose.
  it('reports an exhausted quota as quota_exceeded', async () => {
    enforceVolumeQuota.mockRejectedValueOnce(new PlanLimitError('Monthly limit reached (4/4).'));

    const res = await post({ brandId: 'b1' });

    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('quota_exceeded');
  });

  it('bills the quota once per run, not once per prompt', async () => {
    analyzeBrandVolumes.mockResolvedValue([
      { promptId: 'p1' },
      { promptId: 'p2' },
      { promptId: 'p3' },
    ]);

    await post({ brandId: 'b1' });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ prompt_count: 3 }));
  });

  it('bills nothing when every prompt in the run failed', async () => {
    analyzeBrandVolumes.mockResolvedValue([{ promptId: 'p1', error: 'boom' }]);

    await post({ brandId: 'b1' });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(insert).not.toHaveBeenCalled();
  });
});

/**
 * The free run a brand gets when its setup finishes.
 *
 * Setup already starts tracking, so Cloro scrapes while the user watches. The
 * DataForSEO half was wired to the Stripe success route alone, which meant a
 * paying org's first brand got volumes and every brand added afterwards sat at
 * zero until someone found the Analyze button.
 *
 * What makes it safe to give away is the refusal below: a brand with volumes
 * has had its run, so this cannot be called in a loop for free analyses.
 */
describe('POST /bootstrap', () => {
  const bootstrap = (body) =>
    fetch(`${baseUrl}/bootstrap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('starts the run for a freshly created brand', async () => {
    const res = await bootstrap({ brandId: 'b1' });

    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ started: 100, running: true });
    expect(analyzeBrandVolumes).toHaveBeenCalledWith(
      'b1',
      expect.objectContaining({
        onlyMissing: true,
      }),
    );
  });

  it('costs the plan nothing', async () => {
    await bootstrap({ brandId: 'b1' });
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Neither the check nor the ledger row: the user did not ask for this run,
    // so it must not spend one of a Starter plan's four analyses.
    expect(enforceVolumeQuota).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it('declines a brand that already has volumes', async () => {
    getVolumeProgress.mockResolvedValue({ total: 100, analyzed: 1 });

    const res = await bootstrap({ brandId: 'b1' });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ started: 0, running: false });
    expect(analyzeBrandVolumes).not.toHaveBeenCalled();
  });

  it('leaves the brand free to start again after declining', async () => {
    getVolumeProgress.mockResolvedValue({ total: 100, analyzed: 1 });
    await bootstrap({ brandId: 'b1' });

    // A declined call that kept the claim would lock the Analyze button out
    // of the brand for the lifetime of the process.
    getVolumeProgress.mockResolvedValue({ total: 100, analyzed: 0 });
    expect(await (await post({ brandId: 'b1' })).json()).toMatchObject({ running: true });
  });

  it('declines a brand with no prompts at all', async () => {
    getVolumeProgress.mockResolvedValue({ total: 0, analyzed: 0 });

    expect(await (await bootstrap({ brandId: 'b1' })).json()).toMatchObject({ started: 0 });
    expect(analyzeBrandVolumes).not.toHaveBeenCalled();
  });

  it('starts nothing a second time when both calls arrive together', async () => {
    analyzeBrandVolumes.mockReturnValue(deferred().promise);

    const [a, b] = await Promise.all([bootstrap({ brandId: 'b1' }), bootstrap({ brandId: 'b1' })]);

    // Two setups finishing at once, or a retried server action: the claim has
    // to be taken before the counts are read, or both calls read "analyzed: 0"
    // and DataForSEO is paid twice for the same brand.
    expect(await Promise.all([a.json(), b.json()])).toEqual(
      expect.arrayContaining([{ started: 0, running: true }]),
    );
    expect(analyzeBrandVolumes).toHaveBeenCalledTimes(1);
  });

  it('does not start while the Analyze button is already running', async () => {
    analyzeBrandVolumes.mockReturnValue(deferred().promise);
    await post({ brandId: 'b1' });
    analyzeBrandVolumes.mockClear();

    const res = await bootstrap({ brandId: 'b1' });

    expect(res.status).toBe(202);
    expect(analyzeBrandVolumes).not.toHaveBeenCalled();
  });

  it('requires a brand', async () => {
    expect((await bootstrap({})).status).toBe(400);
  });

  it('refuses a brand the caller cannot reach', async () => {
    const denied = new Error('Forbidden');
    denied.status = 403;
    assertBrandAccess.mockRejectedValue(denied);

    expect((await bootstrap({ brandId: 'someone-elses' })).status).toBe(403);
    expect(analyzeBrandVolumes).not.toHaveBeenCalled();
  });

  it('releases the claim when the progress read fails', async () => {
    getVolumeProgress.mockRejectedValueOnce(new Error('db down'));
    expect((await bootstrap({ brandId: 'b1' })).status).toBe(500);

    expect(await (await bootstrap({ brandId: 'b1' })).json()).toMatchObject({ running: true });
  });
});

describe('GET /status/:brandId', () => {
  it('stays readable once the plan has ended (readOnly), while a run is refused', async () => {
    planEnded = true;
    getVolumeProgress.mockResolvedValue({ total: 100, analyzed: 40 });
    const res = await fetch(`${baseUrl}/status/b1`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ running: false, total: 100, analyzed: 40, done: 40 });
    expect((await post({ brandId: 'b1' })).status).toBe(402);
  });

  /**
   * Nothing reaches prompt_volumes until the lookup at the very end, so a
   * status built on row counts read 0/100 for the whole ten-minute wait and
   * then jumped straight to 100. The run reports its own progress instead.
   */
  it('counts the work in flight, not the rows on disk', async () => {
    const run = deferred();
    analyzeBrandVolumes.mockReturnValue(run.promise);
    await post({ brandId: 'b1' });

    const { onProgress } = analyzeBrandVolumes.mock.calls[0][1];
    onProgress({ done: 32, total: 100 });
    getVolumeProgress.mockResolvedValue({ total: 100, analyzed: 0 });

    const res = await fetch(`${baseUrl}/status/b1`);

    expect(await res.json()).toEqual({ running: true, total: 100, analyzed: 0, done: 32 });
    run.resolve([]);
  });

  it('moves as the run reports further progress', async () => {
    const run = deferred();
    analyzeBrandVolumes.mockReturnValue(run.promise);
    await post({ brandId: 'b1' });
    const { onProgress } = analyzeBrandVolumes.mock.calls[0][1];

    const seen = [];
    for (const done of [0, 40, 90]) {
      onProgress({ done, total: 100 });
      seen.push((await (await fetch(`${baseUrl}/status/b1`)).json()).done);
    }

    expect(seen).toEqual([0, 40, 90]);
    run.resolve([]);
  });

  // Once the run is over the rows are the truth, and they are what a page
  // arriving later has to go on.
  it('falls back to the rows on disk when nothing is running', async () => {
    getVolumeProgress.mockResolvedValue({ total: 100, analyzed: 100 });

    expect(await (await fetch(`${baseUrl}/status/b1`)).json()).toEqual({
      running: false,
      total: 100,
      analyzed: 100,
      done: 100,
    });
  });

  // The page reads this on load to decide whether to show its button or its
  // spinner; a refresh mid-run must not present the button again.
  it('still reports a run that was started before this request', async () => {
    const run = deferred();
    analyzeBrandVolumes.mockReturnValue(run.promise);
    await post({ brandId: 'b1' });

    expect((await (await fetch(`${baseUrl}/status/b1`)).json()).running).toBe(true);

    run.resolve([]);
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect((await (await fetch(`${baseUrl}/status/b1`)).json()).running).toBe(false);
  });
});

describe('GET /brand/:brandId', () => {
  beforeEach(() => {
    rows = {
      prompt_sets: [{ id: 'ps1' }],
      prompts: [{ id: 'p1', text: 'best espresso', category: 'coffee', prompt_set_id: 'ps1' }],
      prompt_volumes: [{ prompt_id: 'p1', est_ai_volume: 40 }],
    };
  });

  it('returns the kept volumes with the quota, read as a read', async () => {
    const quota = { used: 1, limit: 4, remaining: 3 };
    getVolumeQuotaStatus.mockResolvedValue(quota);
    const res = await fetch(`${baseUrl}/brand/b1`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.volumes).toEqual([
      { prompt_id: 'p1', est_ai_volume: 40, promptText: 'best espresso', promptCategory: 'coffee' },
    ]);
    expect(body.quota).toEqual(quota);
    // Read-only once the plan has ended: no 402 for a read.
    expect(getVolumeQuotaStatus).toHaveBeenCalledWith('u1', { readOnly: true });
  });

  it('still returns the volumes once the plan has ended', async () => {
    getVolumeQuotaStatus.mockResolvedValue({ used: 1, limit: 0, remaining: 0, noPlan: true });
    const res = await fetch(`${baseUrl}/brand/b1`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.volumes).toHaveLength(1);
    expect(body.quota).toEqual({ used: 1, limit: 0, remaining: 0, noPlan: true });
  });

  it('answers a plan refusal with its own status, not 500', async () => {
    getVolumeQuotaStatus.mockRejectedValue(
      new PlanLimitError('No organization found for user.', 400),
    );
    const res = await fetch(`${baseUrl}/brand/b1`);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'plan_limit' });
  });
});
