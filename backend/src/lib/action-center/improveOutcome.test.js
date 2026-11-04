import { describe, expect, it, vi } from 'vitest';

const from = vi.fn();
vi.mock('../../config/supabase.js', () => ({ default: { from: (...a) => from(...a) } }));
vi.mock('../logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const {
  POSITION_CHANGE,
  compareOutcome,
  outcomeWindow,
  platformVerdict,
  refreshImproveOutcome,
  sweepImproveOutcomes,
  trackingEndsAt,
} = await import('./improveOutcome.js');

const snap = (platform, over = {}) => ({
  platform,
  state: 'mentioned_late',
  runs: 7,
  mentionedRuns: 7,
  citedRuns: 0,
  mentionPosition: 2,
  citationRank: null,
  ...over,
});

describe('platformVerdict', () => {
  it('is not enough data when either side had no runs', () => {
    expect(platformVerdict(snap('a', { runs: 0 }), snap('a'))).toBe('not_enough_data');
    expect(platformVerdict(snap('a'), snap('a', { runs: 0 }))).toBe('not_enough_data');
    expect(platformVerdict(snap('a'), null)).toBe('not_enough_data');
  });

  it('counts starting to be mentioned as improved, and dropping out as declined', () => {
    const missing = snap('a', { mentionedRuns: 0, mentionPosition: null, state: 'not_mentioned' });
    expect(platformVerdict(missing, snap('a'))).toBe('improved');
    expect(platformVerdict(snap('a'), missing)).toBe('declined');
    expect(platformVerdict(missing, missing)).toBe('unchanged');
  });

  it('uses the Improve tab rule: fewer than half the runs is still not mentioned', () => {
    const none = snap('a', {
      runs: 10,
      mentionedRuns: 0,
      mentionPosition: null,
      state: 'not_mentioned',
    });
    const oneInTen = snap('a', {
      runs: 10,
      mentionedRuns: 1,
      mentionPosition: 1,
      state: 'not_mentioned',
    });
    const half = snap('a', { runs: 10, mentionedRuns: 5, mentionPosition: 3 });
    expect(platformVerdict(none, oneInTen)).toBe('unchanged');
    expect(platformVerdict(oneInTen, none)).toBe('unchanged');
    expect(platformVerdict(oneInTen, half)).toBe('improved');
    expect(platformVerdict(half, oneInTen)).toBe('declined');
  });

  it(`needs the position to move at least ${POSITION_CHANGE}`, () => {
    expect(
      platformVerdict(snap('a', { mentionPosition: 2 }), snap('a', { mentionPosition: 1.2 })),
    ).toBe('improved');
    expect(
      platformVerdict(snap('a', { mentionPosition: 2 }), snap('a', { mentionPosition: 1.6 })),
    ).toBe('unchanged');
    expect(
      platformVerdict(snap('a', { mentionPosition: 2 }), snap('a', { mentionPosition: 2.5 })),
    ).toBe('declined');
  });
});

describe('compareOutcome', () => {
  it('pairs each baseline platform with its read and counts the verdicts', () => {
    const result = compareOutcome(
      [
        snap('google-aimode'),
        snap('chatgpt-web', { mentionPosition: 3 }),
        snap('gemini-web', { runs: 0 }),
      ],
      [
        snap('google-aimode', { mentionPosition: 1.2 }),
        snap('chatgpt-web', { mentionPosition: 3.2 }),
        snap('gemini-web', { runs: 0 }),
      ],
    );
    expect(result.platforms.map((p) => [p.platform, p.verdict])).toEqual([
      ['google-aimode', 'improved'],
      ['chatgpt-web', 'unchanged'],
      ['gemini-web', 'not_enough_data'],
    ]);
    expect(result.summary).toEqual({
      total: 3,
      measurable: 2,
      improved: 1,
      declined: 0,
      avgBefore: 2.5,
      avgAfter: 2.2,
    });
  });

  it('leaves a not-mentioned side out of the position delta', () => {
    const result = compareOutcome(
      [
        snap('chatgpt-web', {
          runs: 10,
          mentionedRuns: 1,
          mentionPosition: 1,
          state: 'not_mentioned',
        }),
      ],
      [snap('chatgpt-web', { runs: 10, mentionedRuns: 8, mentionPosition: 3 })],
    );
    expect(result.platforms[0].verdict).toBe('improved');
    expect(result.summary).toMatchObject({ avgBefore: null, avgAfter: null });
  });
});

describe('windows', () => {
  it('reads the 7 days ending at the moment of the read', () => {
    expect(outcomeWindow(new Date('2026-10-13T10:00:00.000Z'))).toEqual({
      from: '2026-10-06T10:00:00.000Z',
      to: '2026-10-13T10:00:00.000Z',
    });
  });

  it('tracks a completed action for 30 days; an open one has no end', () => {
    expect(trackingEndsAt({ status: 'in_progress', completed_at: null })).toBeNull();
    expect(
      trackingEndsAt({
        status: 'completed',
        completed_at: '2026-10-01T00:00:00.000Z',
      }).toISOString(),
    ).toBe('2026-10-31T00:00:00.000Z');
  });
});

/** actions, prompt_results, brand_domains, and the writes a refresh makes. */
function mockDb(results, { actions = [] } = {}) {
  const writes = { updated: [], inserted: [], windows: [], filters: [] };
  from.mockImplementation((table) => {
    const b = {
      select: () => b,
      eq: (column, value) => {
        writes.filters.push({ table, eq: [column, value] });
        return b;
      },
      in: (column, values) => {
        writes.filters.push({ table, in: [column, values] });
        return b;
      },
      or: (filter) => {
        writes.filters.push({ table, or: filter });
        return b;
      },
      gte: (_c, v) => {
        writes.windows.push(v);
        return b;
      },
      lte: () => b,
      limit: () => Promise.resolve({ data: table === 'actions' ? actions : results, error: null }),
      update: (patch) => {
        writes.updated.push(patch);
        return { eq: () => Promise.resolve({ error: null }) };
      },
      insert: (row) => {
        writes.inserted.push({ table, row });
        return Promise.resolve({ error: null });
      },
      then: (resolve) => resolve({ data: table === 'brand_domains' ? [] : results, error: null }),
    };
    return b;
  });
  return writes;
}

const action = (over = {}) => ({
  id: 'a1',
  brand_id: 'b1',
  status: 'in_progress',
  completed_at: null,
  payload: { promptId: 'p1', region: null },
  baseline: { platforms: [snap('chatgpt-web', { mentionPosition: 3 })] },
  position_outcome: null,
  ...over,
});

const row = (position) => ({
  platform: 'chatgpt-web',
  mention_count: 1,
  mention_position: position,
  mentioned_entity_count: 5,
  citations: [],
});

describe('refreshImproveOutcome', () => {
  it('stores today’s 7-day read next to the baseline while the action is open', async () => {
    const writes = mockDb([row(1), row(2)]);
    const now = new Date('2026-10-20T06:00:00.000Z');
    const outcome = await refreshImproveOutcome(action(), { now });
    expect(outcome.final).toBe(false);
    expect(outcome.window.to).toBe(now.toISOString());
    expect(outcome.platforms[0]).toMatchObject({ verdict: 'improved' });
    expect(outcome.platforms[0].after).toMatchObject({ runs: 2, mentionPosition: 1.5 });
    expect(writes.updated).toHaveLength(1);
    expect(writes.inserted).toHaveLength(0);
  });

  it('keeps 1 mention in 10 runs as not mentioned, like the Improve tab', async () => {
    mockDb([row(1), ...Array.from({ length: 9 }, () => ({ ...row(null), mention_count: 0 }))]);
    const outcome = await refreshImproveOutcome(
      action({
        baseline: {
          platforms: [
            snap('chatgpt-web', {
              runs: 10,
              mentionedRuns: 0,
              mentionPosition: null,
              state: 'not_mentioned',
            }),
          ],
        },
      }),
      { now: new Date('2026-10-20T06:00:00.000Z') },
    );
    expect(outcome.platforms[0].after).toMatchObject({
      runs: 10,
      mentionedRuns: 1,
      state: 'not_mentioned',
    });
    expect(outcome.platforms[0].verdict).toBe('unchanged');
    expect(outcome.summary.improved).toBe(0);
  });

  it('records the final read in History 30 days after completion, over the 7 days ending then', async () => {
    const writes = mockDb([row(1)]);
    const outcome = await refreshImproveOutcome(
      action({ status: 'completed', completed_at: '2026-09-01T00:00:00.000Z' }),
      { now: new Date('2026-10-13T06:00:00.000Z') },
    );
    expect(outcome.final).toBe(true);
    expect(outcome.window).toEqual({
      from: '2026-09-24T00:00:00.000Z',
      to: '2026-10-01T00:00:00.000Z',
    });
    expect(writes.inserted[0]).toMatchObject({
      table: 'action_events',
      row: {
        event: 'position_outcome_recorded',
        data: { improved: 1, declined: 0, measurable: 1, total: 1 },
      },
    });
  });

  it('leaves a final outcome alone', async () => {
    const writes = mockDb([]);
    const done = { final: true, summary: {} };
    expect(await refreshImproveOutcome(action({ position_outcome: done }))).toBe(done);
    expect(writes.updated).toHaveLength(0);
  });
});

describe('sweepImproveOutcomes', () => {
  it('leaves final reads out of the query, so they never fill the limit', async () => {
    const writes = mockDb([row(1)], { actions: [action({ id: 'a1' }), action({ id: 'a2' })] });
    const result = await sweepImproveOutcomes({ now: new Date('2026-10-20T06:00:00.000Z') });
    const query = writes.filters.filter((f) => f.table === 'actions');
    expect(query).toContainEqual({
      table: 'actions',
      in: ['status', ['new', 'in_progress', 'on_hold', 'completed']],
    });
    expect(query).toContainEqual({
      table: 'actions',
      or: 'position_outcome.is.null,position_outcome->>final.neq.true',
    });
    expect(result).toEqual({ refreshed: 2 });
    expect(writes.updated).toHaveLength(2);
  });

  it("never reads a demo brand's actions (00380)", async () => {
    const writes = mockDb([], { actions: [] });
    await sweepImproveOutcomes({ now: new Date('2026-10-20T06:00:00.000Z') });
    expect(writes.filters).toContainEqual({ table: 'actions', eq: ['brands.is_demo', false] });
  });
});
