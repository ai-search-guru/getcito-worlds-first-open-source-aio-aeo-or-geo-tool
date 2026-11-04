import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * #1002 — Competitor Gaps reads the daily rollups (00203) like the other
 * Citations tabs, and the raw functions only for a single-prompt filter, or
 * a 24h view before the brand's first completed run.
 */

let rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
let tablesRead: string[] = [];
let latestRun: { started_at: string; completed_at: string } | null = null;

const TABLE_ROWS: Record<string, unknown[]> = {
  brand_domains: [{ domain: 'www.Acme.example' }],
  competitors: [{ id: 'c1', name: 'Rival', domain: 'https://rival.example/' }],
  prompts: [{ id: 'p-topic' }],
};

function fakeQueryBuilder(table: string) {
  tablesRead.push(table);
  const builder = {
    select: () => builder,
    eq: () => builder,
    in: () => builder,
    not: () => builder,
    order: () => builder,
    limit: () => builder,
    then: (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) => {
      const data = table === 'tracking_runs' ? (latestRun ? [latestRun] : []) : TABLE_ROWS[table];
      return Promise.resolve({ data: data ?? [], error: null }).then(onFulfilled, onRejected);
    },
  };
  return builder;
}

function rpcResult(fn: string) {
  if (fn.startsWith('citation_gap_domains')) {
    return [
      {
        domain: null,
        competitor_answers: 0,
        appears_in_ours: false,
        strength: 0,
        competitor_names: [],
        our_answer_count: 4,
        total_answers: 20,
      },
      {
        domain: 'reviews.example',
        competitor_answers: 3,
        appears_in_ours: false,
        strength: 0.75,
        competitor_names: ['Rival'],
        our_answer_count: 4,
        total_answers: 20,
      },
      {
        domain: 'news.example',
        competitor_answers: 5,
        appears_in_ours: true,
        strength: 1.2,
        competitor_names: ['Rival'],
        our_answer_count: 4,
        total_answers: 20,
      },
    ];
  }
  return [
    { competitor_id: 'c1', domain: 'reviews.example', answers_feeding: 3, strength: 0.75 },
    { competitor_id: 'c1', domain: 'news.example', answers_feeding: 6, strength: 1.5 },
  ];
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: (table: string) => fakeQueryBuilder(table),
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      return { data: rpcResult(fn), error: null };
    },
  }),
}));

import { getCitationGaps } from './citations';

beforeEach(() => {
  rpcCalls = [];
  tablesRead = [];
  latestRun = null;
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-20T12:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('getCitationGaps', () => {
  it('reads the daily rollups for a preset, over whole UTC days', async () => {
    const gaps = await getCitationGaps('b1', { datePreset: '30d' });

    expect(rpcCalls.map((c) => c.fn).sort()).toEqual([
      'citation_competitor_sources_daily',
      'citation_gap_domains_daily',
    ]);
    for (const { args } of rpcCalls) {
      expect(args).toMatchObject({
        p_brand_id: 'b1',
        p_day_from: '2026-09-21',
        p_day_to: '2026-10-20',
        p_brand_domains: ['acme.example'],
        p_competitor_domains: ['rival.example'],
      });
      expect(args).not.toHaveProperty('p_date_from');
    }

    // The rows map as before: a domain seen where we're present is no gap,
    // but still marks the competitor's source as citing us too.
    expect(gaps.totalAnswers).toBe(20);
    expect(gaps.ourAnswerCount).toBe(4);
    expect(gaps.gapDomains.map((g) => g.domain)).toEqual(['reviews.example']);
    expect(gaps.byCompetitor.c1.map((s) => [s.domain, s.alsoCitesUs])).toEqual([
      ['news.example', true],
      ['reviews.example', false],
    ]);
    expect(gaps.competitors).toEqual([{ id: 'c1', name: 'Rival' }]);
  });

  it('passes a topic filter to the rollups without resolving its prompts', async () => {
    await getCitationGaps('b1', { datePreset: '7d', topicIds: ['t1'] });

    expect(tablesRead).not.toContain('prompts');
    expect(rpcCalls.every((c) => c.fn.endsWith('_daily'))).toBe(true);
    expect(rpcCalls[0].args).toMatchObject({ p_topic_ids: ['t1'], p_day_from: '2026-10-14' });
  });

  it('keeps a single-prompt filter on the raw functions', async () => {
    await getCitationGaps('b1', { datePreset: '30d', promptIds: ['p1'] });

    expect(rpcCalls.map((c) => c.fn).sort()).toEqual([
      'citation_competitor_sources',
      'citation_gap_domains',
    ]);
    expect(rpcCalls[0].args).toMatchObject({ p_prompt_ids: ['p1'] });
    expect(rpcCalls[0].args).not.toHaveProperty('p_day_from');
  });

  it("reads 24h as the latest completed run's days", async () => {
    latestRun = { started_at: '2026-10-19T23:30:00Z', completed_at: '2026-10-20T01:10:00Z' };
    await getCitationGaps('b1', { datePreset: '24h' });

    expect(rpcCalls.every((c) => c.fn.endsWith('_daily'))).toBe(true);
    expect(rpcCalls[0].args).toMatchObject({ p_day_from: '2026-10-19', p_day_to: '2026-10-20' });
  });

  it('stays on the raw functions for 24h before the first completed run', async () => {
    await getCitationGaps('b1', { datePreset: '24h' });

    expect(rpcCalls.some((c) => c.fn.endsWith('_daily'))).toBe(false);
  });
});
