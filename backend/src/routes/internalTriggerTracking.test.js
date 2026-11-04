import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

/**
 * The first run after a payment, asked for by the Stripe return page and the
 * webhook: the run that starts it also starts the volume analysis.
 */

const startFirstRun = vi.fn();
const runTrackingJob = vi.fn();
const analyzeBrandVolumes = vi.fn();
const isDemoBrand = vi.fn();
vi.mock('../lib/firstRun.js', () => ({ startFirstRun: (...args) => startFirstRun(...args) }));
vi.mock('../lib/jobRunner.js', () => ({ runTrackingJob: (...args) => runTrackingJob(...args) }));
vi.mock('../lib/volumeAnalysis.js', () => ({
  analyzeBrandVolumes: (...args) => analyzeBrandVolumes(...args),
}));

vi.mock('../middleware/demoBrand.js', () => ({
  DEMO_BRAND: { code: 'demo_brand' },
  isDemoBrand: (...args) => isDemoBrand(...args),
}));

const { default: router } = await import('./internalTriggerTracking.js');

const io = { emit: vi.fn() };
const log = { error: vi.fn() };
let server;
let url;

beforeEach(async () => {
  vi.stubEnv('CRON_SECRET', 'secret');
  startFirstRun.mockReset().mockResolvedValue({ job: { id: 'job1' }, created: true });
  runTrackingJob.mockReset();
  analyzeBrandVolumes.mockReset().mockResolvedValue({});
  isDemoBrand.mockReset().mockResolvedValue(false);
  log.error.mockReset();
  const app = express();
  app.set('io', io);
  app.use(express.json());
  app.use((req, _res, next) => {
    req.log = log;
    next();
  });
  app.use('/api/internal/trigger-tracking', router);
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  url = `http://127.0.0.1:${server.address().port}/api/internal/trigger-tracking`;
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await new Promise((resolve) => server.close(resolve));
});

const send = (body, secret = 'secret') =>
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
    body: JSON.stringify(body),
  });

describe('POST /api/internal/trigger-tracking', () => {
  it('starts the run it created, and the volume analysis with it', async () => {
    const since = '2026-10-29T10:00:00.000Z';
    const res = await send({ brandId: 'b1', since });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, jobId: 'job1', created: true });
    expect(startFirstRun).toHaveBeenCalledWith({ brandId: 'b1', since });
    // Ahead of the queue (jobRunner.js).
    expect(runTrackingJob).toHaveBeenCalledWith('job1', io, { priority: true });
    expect(analyzeBrandVolumes).toHaveBeenCalledWith('b1', { onlyMissing: true });
  });

  it('hands back the run already started, and starts nothing more', async () => {
    startFirstRun.mockResolvedValue({ job: { id: 'job0' }, created: false });
    const res = await send({ brandId: 'b1' });

    expect(await res.json()).toEqual({ success: true, jobId: 'job0', created: false });
    expect(runTrackingJob).not.toHaveBeenCalled();
    expect(analyzeBrandVolumes).not.toHaveBeenCalled();
  });

  it('keeps the run when the volume analysis fails', async () => {
    analyzeBrandVolumes.mockRejectedValue(new Error('volumes down'));
    const res = await send({ brandId: 'b1' });

    expect(res.status).toBe(200);
    await vi.waitFor(() => expect(log.error).toHaveBeenCalled());
  });

  it.each([
    ['no brand', {}],
    ['an empty brand', { brandId: '' }],
    ['a time that is not ISO', { brandId: 'b1', since: 'yesterday' }],
  ])('refuses %s with 400, starting nothing', async (_name, body) => {
    const res = await send(body);

    expect(res.status).toBe(400);
    expect(startFirstRun).not.toHaveBeenCalled();
  });

  it('refuses a demo brand with 402, starting nothing', async () => {
    isDemoBrand.mockResolvedValue(true);
    const res = await send({ brandId: 'demo' });

    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ code: 'demo_brand' });
    expect(isDemoBrand).toHaveBeenCalledWith('demo');
    expect(startFirstRun).not.toHaveBeenCalled();
    expect(analyzeBrandVolumes).not.toHaveBeenCalled();
  });

  it('refuses a caller without the secret', async () => {
    const res = await send({ brandId: 'b1' }, 'wrong');

    expect(res.status).toBe(401);
    expect(startFirstRun).not.toHaveBeenCalled();
  });

  it('answers 500 when the jobs cannot be read', async () => {
    startFirstRun.mockRejectedValue(new Error('Failed to read tracking jobs: timeout'));
    const res = await send({ brandId: 'b1' });

    expect(res.status).toBe(500);
    expect(runTrackingJob).not.toHaveBeenCalled();
  });
});
