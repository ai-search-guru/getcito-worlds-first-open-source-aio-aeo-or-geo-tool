import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * AT-003: a reload or a second link from the same answer continues a visit
 * instead of counting as another (F5).
 */

const db = vi.hoisted(() => ({ calls: [], result: { data: null, error: null } }));

// A query builder that records every filter and answers with db.result.
vi.mock('../config/supabase.js', () => {
  const builder = {};
  for (const method of ['select', 'eq', 'gt', 'order', 'limit']) {
    builder[method] = (...args) => {
      db.calls.push([method, ...args]);
      return builder;
    };
  }
  builder.maybeSingle = async () => db.result;
  return {
    default: {
      from: (table) => {
        db.calls.push(['from', table]);
        return builder;
      },
    },
  };
});

const { findVisitOf, VISIT_GAP_MINUTES } = await import('./trafficVisits.js');

const NOW = Date.parse('2026-10-18T12:00:00.000Z');
const pageview = {
  brandId: 'b1',
  sourcePlatform: 'gemini.google.com',
  visitorKey: 'vk-1',
  userAgent: 'Mozilla/5.0',
  now: NOW,
};

beforeEach(() => {
  db.calls.length = 0;
  db.result = { data: null, error: null };
});

describe('findVisitOf', () => {
  it('starts a visit when the visitor has no pageview in the last 30 minutes', async () => {
    expect(await findVisitOf(pageview)).toBeNull();
  });

  it("looks for the same visitor's latest pageview from the same platform", async () => {
    await findVisitOf(pageview);
    expect(VISIT_GAP_MINUTES).toBe(30);
    expect(db.calls).toEqual([
      ['from', 'ai_traffic_logs'],
      ['select', 'id, visit_of'],
      ['eq', 'brand_id', 'b1'],
      ['eq', 'source_platform', 'gemini.google.com'],
      ['eq', 'visitor_key', 'vk-1'],
      ['eq', 'user_agent', 'Mozilla/5.0'],
      ['gt', 'created_at', '2026-10-18T11:30:00.000Z'],
      ['order', 'created_at', { ascending: false }],
      ['limit', 1],
    ]);
  });

  it('continues the visit its latest pageview started', async () => {
    db.result = { data: { id: 'p1', visit_of: null }, error: null };
    expect(await findVisitOf(pageview)).toBe('p1');
  });

  it('continues the visit its latest pageview belongs to', async () => {
    // p2 was itself a repeat of p1, so this pageview joins p1's visit.
    db.result = { data: { id: 'p2', visit_of: 'p1' }, error: null };
    expect(await findVisitOf(pageview)).toBe('p1');
  });

  it("starts a visit when it can't tell who the visitor is", async () => {
    expect(await findVisitOf({ ...pageview, visitorKey: null })).toBeNull();
    expect(await findVisitOf({ ...pageview, userAgent: null })).toBeNull();
    expect(db.calls).toEqual([]);
  });

  it('reports a failed lookup', async () => {
    db.result = { data: null, error: { message: 'timeout' } };
    await expect(findVisitOf(pageview)).rejects.toThrow('timeout');
  });
});
