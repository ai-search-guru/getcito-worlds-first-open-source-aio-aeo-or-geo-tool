import { describe, expect, it, vi } from 'vitest';

// record.js reaches the admin client at import time, whose config hard-exits
// without SUPABASE_* env (as in CI). Its `from` is replaced per test below.
vi.mock('../../config/supabase.js', () => ({ default: { rpc: vi.fn(), from: vi.fn() } }));
vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../pulse/metrics.js', () => ({ computePulseMetrics: vi.fn() }));

import supabaseAdmin from '../../config/supabase.js';
import { auditCandidates } from './record.js';
import { ENGINE_THRESHOLDS } from '../../config/actionEngine.js';

const { auditLowScore } = ENGINE_THRESHOLDS.detection;

const now = new Date('2026-10-23T06:00:00.000Z');

/** site_audits in miniature: every chained filter passes, the rows come back as given. */
function serve(rows) {
  const query = new Proxy(
    {},
    {
      get: (_, key) =>
        key === 'then'
          ? (resolve, reject) => Promise.resolve({ data: rows, error: null }).then(resolve, reject)
          : () => query,
    },
  );
  supabaseAdmin.from.mockReturnValue(query);
}

/** A stored audit: Site Audit keeps its score from 0 to 1, the threshold is out of 100. */
const audit = (i, points) => ({
  url: `https://acme.example/p${i}`,
  total_score: points / 100,
  completed_at: now.toISOString(),
});

/** Site Audit's low pages (AC-009): the ten lowest to show, every address past them. */
describe('auditCandidates', () => {
  it('counts a page low only below the threshold out of 100', async () => {
    serve([audit(0, 63), audit(1, auditLowScore), audit(2, auditLowScore - 1), audit(3, 10)]);
    const [signal] = await auditCandidates('b1', now);
    expect(signal.currentValue).toBe(2);
    expect(signal.payload.urls).toEqual([
      { url: 'https://acme.example/p3', score: 0.1 },
      { url: 'https://acme.example/p2', score: (auditLowScore - 1) / 100 },
    ]);
  });

  it('raises nothing when every page scores at or above the threshold', async () => {
    serve([audit(0, 63), audit(1, 88)]);
    expect(await auditCandidates('b1', now)).toEqual([]);
  });

  it('lists no addresses beside the ten it shows', async () => {
    serve(Array.from({ length: 10 }, (_, i) => audit(i, auditLowScore - 1 - i)));
    const [signal] = await auditCandidates('b1', now);
    expect(signal.payload.urls).toHaveLength(10);
    expect(signal.payload).not.toHaveProperty('targetIds');
  });

  it('lists every low page’s address past them', async () => {
    serve(Array.from({ length: 12 }, (_, i) => audit(i, auditLowScore - 1 - i)));
    const [signal] = await auditCandidates('b1', now);
    expect(signal.payload.urls).toHaveLength(10);
    expect(signal.payload.targetIds).toHaveLength(12);
    expect(signal.currentValue).toBe(12);
  });
});
