import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A brand's facts read again each week (Quality CE-047): the brands read
 * before whose site was read over a week ago, a bounded number a night.
 */

vi.mock('../config/supabase.js', () => ({ default: {} }));
let cloud;
vi.mock('../config/plans.js', () => ({
  isCloud: () => cloud,
  isSubscriptionActive: (status) => status === 'active' || status === 'trialing',
}));
vi.mock('./brandFacts.js', () => ({ refreshOnce: vi.fn() }));

const { GONE_KEEP_DAYS, REFRESH_DAYS, SWEEP_DEADLINE_MS, sweepBrandFacts } =
  await import('./brandFactsSweep.js');

const NOW = Date.parse('2026-10-24T03:00:00Z');
const DAY = 86_400_000;

/** The tables read, and each write as it was asked. */
function fakeDb(tables) {
  const writes = [];
  const reads = [];
  const db = {
    from: (table) => {
      const q = { op: 'select', filters: [], payload: null };
      const chain = {
        select: (columns) => (reads.push({ table, columns }), chain),
        eq: (col, value) => (q.filters.push(['eq', col, value]), chain),
        neq: (col, value) => (q.filters.push(['neq', col, value]), chain),
        in: (col, value) => (q.filters.push(['in', col, value]), chain),
        lt: (col, value) => (q.filters.push(['lt', col, value]), chain),
        order: () => chain,
        limit: (n) => (q.filters.push(['limit', n]), chain),
        update: (payload) => ((q.op = 'update'), (q.payload = payload), chain),
        delete: () => ((q.op = 'delete'), chain),
        then: (resolve) => {
          if (q.op === 'select') {
            reads.at(-1).filters = q.filters;
            return resolve({ data: tables[table] ?? [], error: null });
          }
          writes.push({ table, op: q.op, payload: q.payload, filters: q.filters });
          return resolve({ error: null });
        },
      };
      return chain;
    },
  };
  return { db, writes, reads };
}

const row = (brand, org, daysAgo) => ({
  brand_id: brand,
  checked_at: new Date(NOW - daysAgo * DAY).toISOString(),
  brands: { organization_id: org, is_active: true },
});

beforeEach(() => {
  vi.stubEnv('CONTENT_QUALITY_PHASE', '2');
  cloud = true;
});
afterEach(() => vi.unstubAllEnvs());

describe('sweepBrandFacts', () => {
  it('reads the active brands read over a week ago, each once, the longest waiting first', async () => {
    const { db, reads } = fakeDb({
      brand_fact_pages: [
        row('b1', 'o1', 9),
        row('b1', 'o1', 9),
        row('b2', 'o2', 8),
        row('b3', 'o1', 8),
      ],
      organizations: [
        { id: 'o1', subscription_status: 'active' },
        { id: 'o2', subscription_status: 'active' },
      ],
    });
    const refresh = vi.fn().mockResolvedValue({ noDomain: false, paused: false });
    expect(await sweepBrandFacts({ now: NOW, limit: 2, db, refresh })).toEqual({
      read: 2,
      paused: 0,
      skipped: 0,
      failed: 0,
    });
    expect(refresh.mock.calls).toEqual([
      ['b1', { orgId: 'o1', now: NOW }],
      ['b2', { orgId: 'o2', now: NOW }],
    ]);
    expect(reads[0].filters).toEqual(
      expect.arrayContaining([
        ['lt', 'checked_at', new Date(NOW - REFRESH_DAYS * DAY).toISOString()],
        ['eq', 'brands.is_active', true],
        // Never a demo brand (00380).
        ['eq', 'brands.is_demo', false],
        ['limit', 12],
      ]),
    );
  });

  it('marks an unsubscribed or domainless brand read, and leaves a workspace whose budget ran out', async () => {
    const { db, writes } = fakeDb({
      brand_fact_pages: [
        row('b1', 'o1', 9),
        row('b2', 'o2', 9),
        row('b3', 'o3', 9),
        row('b4', 'o3', 9),
        row('b5', 'o4', 9),
      ],
      organizations: [
        { id: 'o1', subscription_status: 'canceled' },
        { id: 'o2', subscription_status: 'active' },
        { id: 'o3', subscription_status: 'trialing' },
        { id: 'o4', subscription_status: 'active' },
      ],
    });
    const refresh = vi.fn(async (brandId) => {
      if (brandId === 'b2') return { noDomain: true, paused: false };
      if (brandId === 'b3') return { noDomain: false, paused: true };
      if (brandId === 'b5') throw new Error('database down');
      return { noDomain: false, paused: false };
    });
    expect(await sweepBrandFacts({ now: NOW, db, refresh })).toEqual({
      read: 0,
      paused: 1,
      skipped: 2,
      failed: 1,
    });
    // b4 shares b3's spent budget: left for the next run, not marked read.
    expect(refresh.mock.calls.map(([id]) => id)).toEqual(['b2', 'b3', 'b5']);
    expect(writes.filter((w) => w.table === 'brand_fact_pages')).toEqual([
      expect.objectContaining({
        payload: { checked_at: new Date(NOW).toISOString() },
        filters: [['in', 'brand_id', ['b1', 'b2']]],
      }),
      // A missed page stays missed, its retry after a day kept.
      expect.objectContaining({
        payload: { checked_at: new Date(NOW).toISOString(), status: 'failed' },
        filters: [
          ['in', 'brand_id', ['b5']],
          ['neq', 'status', 'missed'],
        ],
      }),
      expect.objectContaining({
        payload: { checked_at: new Date(NOW).toISOString() },
        filters: [
          ['in', 'brand_id', ['b5']],
          ['eq', 'status', 'missed'],
        ],
      }),
    ]);
  });

  it('counts toward its limit only the brands it tried: a spent workspace’s don’t take the others’ turn', async () => {
    const { db } = fakeDb({
      brand_fact_pages: [
        row('a1', 'o1', 9),
        row('a2', 'o1', 9),
        row('a3', 'o1', 9),
        row('b1', 'o2', 8),
      ],
      organizations: [
        { id: 'o1', subscription_status: 'active' },
        { id: 'o2', subscription_status: 'active' },
      ],
    });
    const refresh = vi.fn(async (brandId) => ({ noDomain: false, paused: brandId === 'a1' }));
    await sweepBrandFacts({ now: NOW, limit: 2, db, refresh });
    expect(refresh.mock.calls.map(([id]) => id)).toEqual(['a1', 'b1']);
  });

  it('drops approved facts gone from the site for a month', async () => {
    const { db, writes } = fakeDb({ brand_fact_pages: [] });
    await sweepBrandFacts({ now: NOW, db, refresh: vi.fn() });
    expect(writes).toEqual([
      {
        table: 'brand_facts',
        op: 'delete',
        payload: null,
        filters: [
          ['eq', 'status', 'approved'],
          ['lt', 'gone_at', new Date(NOW - GONE_KEEP_DAYS * DAY).toISOString()],
        ],
      },
    ]);
  });

  it('reads every brand due when self-hosted, and nothing before phase 2', async () => {
    cloud = false;
    const { db } = fakeDb({ brand_fact_pages: [row('b1', 'o1', 9)] });
    const refresh = vi.fn().mockResolvedValue({ noDomain: false, paused: false });
    await sweepBrandFacts({ now: NOW, db, refresh });
    expect(refresh).toHaveBeenCalledTimes(1);
    vi.stubEnv('CONTENT_QUALITY_PHASE', '1');
    refresh.mockClear();
    expect(await sweepBrandFacts({ now: NOW, db, refresh })).toEqual({ skipped: 'off' });
    expect(refresh).not.toHaveBeenCalled();
  });

  it('stops reading at its deadline, the brands left first in line next run', async () => {
    const { db } = fakeDb({
      brand_fact_pages: [row('b1', 'o1', 9), row('b2', 'o1', 9)],
      organizations: [{ id: 'o1', subscription_status: 'active' }],
    });
    const clock = vi.spyOn(Date, 'now');
    let t = NOW;
    clock.mockImplementation(() => t);
    const refresh = vi.fn(async () => {
      t += SWEEP_DEADLINE_MS + 1;
      return { noDomain: false, paused: false };
    });
    await sweepBrandFacts({ now: NOW, db, refresh });
    expect(refresh.mock.calls.map(([id]) => id)).toEqual(['b1']);
    clock.mockRestore();
  });
});
