import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
const from = vi.fn();
vi.mock('../../config/supabase.js', () => ({
  default: { rpc: (...a) => rpc(...a), from: (...a) => from(...a) },
}));
vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { logger } from '../logger.js';
import {
  MAX_GAP_DAYS,
  sweepActionValidation,
  SWEEP_FILTER,
  MEANINGFUL_CHANGE_RATIO,
  VALIDATION_WAIT_DAYS,
  deriveOutcome,
  measureKpis,
  validateAction,
} from './validate.js';

const NOW = new Date('2026-09-20T04:00:00Z');
const daysAgo = (n) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

/** A stamped tracking run every night of the last 60 days: no window misses one. */
const EVERY_NIGHT = Array.from({ length: 60 }, (_, i) => ({ completed_at: daysAgo(i) }));

/** Records every write so a test can assert what was stored; `rows` answers a table's reads. */
function mockWrites(rows = {}) {
  rows = { tracking_runs: EVERY_NIGHT, ...rows };
  const writes = { updated: [], inserted: [], ors: [], lts: [] };
  from.mockImplementation((table) => {
    const builder = {
      or: (filter) => {
        writes.ors.push({ table, filter });
        return builder;
      },
      select: () => builder,
      eq: () => builder,
      is: () => builder,
      gte: () => builder,
      lte: () => builder,
      not: () => builder,
      limit: () => builder,
      order: () => builder,
      gt: () => builder,
      lt: (...args) => {
        writes.lts.push({ table, args });
        return builder;
      },
      in: () => builder,
      maybeSingle: async () => ({ data: (rows[table] ?? [])[0] ?? null, error: null }),
      update: (patch) => {
        writes.updated.push({ table, patch });
        return builder;
      },
      insert: (rows) => {
        writes.inserted.push({ table, rows });
        return builder;
      },
      then: (resolve, reject) =>
        Promise.resolve({ data: rows[table] ?? [], error: null, count: 0 }).then(resolve, reject),
    };
    return builder;
  });
  return writes;
}

beforeEach(() => {
  rpc.mockReset();
  from.mockReset();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('deriveOutcome', () => {
  const pair = (metric, before, after) => ({ metric, unit: 'count', before, after });

  it('reports nothing measurable when no metric has both halves', () => {
    expect(deriveOutcome([pair('citations', null, 40)])).toBe('not_measurable');
    expect(deriveOutcome([])).toBe('not_measurable');
  });

  it('calls a rise past the threshold an improvement', () => {
    expect(deriveOutcome([pair('citations', 100, 120)])).toBe('improved');
  });

  it('calls a fall past the threshold a decline', () => {
    expect(deriveOutcome([pair('citations', 100, 80)])).toBe('declined');
  });

  /**
   * The guard that keeps every outcome from being a verdict. These metrics
   * drift on their own; a move inside the noise band is not a result.
   */
  it('ignores movement inside the noise band', () => {
    const wobble = Math.round(100 * MEANINGFUL_CHANGE_RATIO) - 1;
    expect(deriveOutcome([pair('citations', 100, 100 + wobble)])).toBe('no_meaningful_change');
    expect(deriveOutcome([pair('citations', 100, 100 - wobble)])).toBe('no_meaningful_change');
  });

  it('reads one metric up and another down as mixed, not improved (learning A4)', () => {
    expect(deriveOutcome([pair('citations', 100, 150), pair('mentions', 100, 50)])).toBe('mixed');
  });

  it('lets the main metric decide, mixed when another moved the other way', () => {
    const up = pair('citations', 100, 150);
    const down = pair('mentions', 100, 50);
    const still = pair('ai_visibility', 40, 40);
    expect(deriveOutcome([up, still], 'citations')).toBe('improved');
    expect(deriveOutcome([up, down], 'citations')).toBe('mixed');
    expect(deriveOutcome([down, still], 'mentions')).toBe('declined');
    // Its aim didn't move: no meaningful change, whatever moved beside it.
    expect(deriveOutcome([up, still], 'ai_visibility')).toBe('no_meaningful_change');
    // A main metric not measured leaves it to the others.
    expect(deriveOutcome([up], 'mentions')).toBe('improved');
  });

  it('counts only the metrics the action aims at, given them', () => {
    const visibility = { metric: 'ai_visibility', unit: 'percent', before: 20, after: 30 };
    const lead = { metric: 'competitor_lead', unit: 'points', before: 0.4, after: 0.3 };
    // A basket reads its lead too; the action never aimed at it.
    expect(deriveOutcome([visibility, lead], 'ai_visibility', ['ai_visibility'])).toBe('improved');
    // One it names moving the other way is mixed.
    expect(
      deriveOutcome([visibility, lead], 'ai_visibility', ['ai_visibility', 'competitor_lead']),
    ).toBe('mixed');
    // None of them read: nothing it aims at could be.
    expect(deriveOutcome([lead], 'ai_visibility', ['ai_visibility'])).toBe('not_measurable');
  });

  // Nothing to scale a ratio by, so any real arrival counts.
  it('treats a first arrival from zero as movement', () => {
    expect(deriveOutcome([pair('citations', 0, 3)])).toBe('improved');
  });
});

describe('measureKpis', () => {
  it('asks only for the sources the requested metrics need', async () => {
    rpc.mockResolvedValue({ data: { total_citations: 42, total_mentions: 7 }, error: null });

    const values = await measureKpis('brand-1', ['citations'], '2026-09-01', '2026-09-07');

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('insights_aggregates_daily', {
      p_brand_id: 'brand-1',
      p_platform: null,
      p_models: null,
      p_region: null,
      p_day_from: '2026-09-01',
      p_day_to: '2026-09-07',
    });
    expect(values).toEqual({ citations: 42 });
  });

  it('ignores metrics it has no source for', async () => {
    const values = await measureKpis('brand-1', ['something_else'], '2026-09-01', '2026-09-07');
    expect(values).toEqual({});
    expect(rpc).not.toHaveBeenCalled();
  });

  it('computes share of voice the way the dashboard does', async () => {
    rpc.mockResolvedValue({
      data: { total_brand_mentions: 250, total_competitor_mentions: 750 },
      error: null,
    });

    const values = await measureKpis('brand-1', ['share_of_voice'], '2026-09-01', '2026-09-07');

    expect(values.share_of_voice).toBe(25);
  });

  it('reports a window with no answers as unmeasured, not zero', async () => {
    rpc.mockResolvedValue({ data: { answers: 0 }, error: null });

    const values = await measureKpis('brand-1', ['ai_visibility'], '2026-09-01', '2026-09-07');

    expect(values.ai_visibility).toBeNull();
  });

  describe('AI referral traffic', () => {
    // Each query's calls, and what it answers with.
    function mockTraffic({ snippetVisits, gaRows }) {
      const queries = [];
      from.mockImplementation((table) => {
        const calls = [];
        queries.push({ table, calls });
        const builder = {};
        for (const method of ['select', 'eq', 'is', 'gte', 'lte']) {
          builder[method] = (...args) => {
            calls.push([method, ...args]);
            return builder;
          };
        }
        builder.then = (resolve) =>
          resolve(
            table === 'ai_traffic_logs'
              ? { count: snippetVisits, error: null }
              : { data: gaRows, error: null },
          );
        return builder;
      });
      return queries;
    }

    it("counts the snippet's visits, not its pageviews", async () => {
      // A visit starts on a row whose visit_of is null (00172); its reloads
      // are further rows of the same visit.
      const queries = mockTraffic({ snippetVisits: 26, gaRows: [] });

      const values = await measureKpis(
        'brand-1',
        ['ai_referral_traffic'],
        '2026-09-01',
        '2026-09-07',
      );

      expect(values.ai_referral_traffic).toBe(26);
      expect(queries[0].table).toBe('ai_traffic_logs');
      expect(queries[0].calls).toContainEqual(['is', 'visit_of', null]);
    });

    it("falls back to Analytics' sessions when the snippet has no visits", async () => {
      mockTraffic({ snippetVisits: 0, gaRows: [{ sessions: 4 }, { sessions: '3' }] });

      const values = await measureKpis(
        'brand-1',
        ['ai_referral_traffic'],
        '2026-09-01',
        '2026-09-07',
      );

      expect(values.ai_referral_traffic).toBe(7);
    });
  });
});

describe('validateAction', () => {
  const action = (over = {}) => ({
    id: 'a1',
    brand_id: 'brand-1',
    kpi_keys: ['citations'],
    created_at: daysAgo(30),
    completed_at: daysAgo(10),
    ...over,
  });

  /**
   * The window has to be over. Measured early, its unhappened days read as
   * zero and file recent work as a decline.
   */
  it('refuses to measure while the after window is still running', async () => {
    const writes = mockWrites();

    const outcome = await validateAction(action({ completed_at: daysAgo(3) }), { now: NOW });

    expect(outcome).toBeNull();
    expect(writes.updated).toHaveLength(0);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('measures once the window has closed', async () => {
    mockWrites();
    rpc.mockResolvedValue({ data: { total_citations: 10 }, error: null });

    const outcome = await validateAction(action({ completed_at: daysAgo(VALIDATION_WAIT_DAYS) }), {
      now: NOW,
    });

    expect(outcome).not.toBeNull();
  });

  /** Net of the brand's prompts it didn't touch (learning B2), beside the result. */
  it("keeps a basket's change net of the brand's other prompts over the same windows", async () => {
    const writes = mockWrites({
      prompts: [
        { id: 'p1', topic_id: 't1' },
        ...Array.from({ length: 6 }, (_, i) => ({ id: `c${i + 1}`, topic_id: 't1' })),
      ],
    });
    // The action's prompts went from 20% to 30% visible; the others from 40% to 44%.
    let reads = 0;
    rpc.mockImplementation(async (name, args) => {
      if (name !== 'opportunity_basket_metrics') return { data: {}, error: null };
      const own = args.p_prompt_ids.includes('p1');
      const after = reads++ % 2 === 1;
      return {
        data: { cells: 100, visible: own ? (after ? 30 : 20) : after ? 44 : 40 },
        error: null,
      };
    });

    await validateAction(
      action({
        kind: 'mention_review',
        kpi_keys: ['ai_visibility'],
        payload: { promptIds: ['p1'] },
      }),
      { now: NOW },
    );

    const patch = writes.updated.find((w) => w.table === 'actions').patch;
    expect(patch.validation.control).toMatchObject({
      basis: 'topics',
      prompts: 6,
      net: expect.arrayContaining([
        { metric: 'ai_visibility', net: 6, unit: 'points', control: { before: 40, after: 44 } },
      ]),
    });
    // Beside the result, not in its verdict.
    expect(patch.outcome).toBe('improved');
    // Of the prompts tracked by the first day of the week before it was raised.
    expect(writes.lts).toContainEqual({
      table: 'prompts',
      args: ['created_at', `${daysAgo(37).slice(0, 10)}T00:00:00Z`],
    });
  });

  it('keeps the result as it was, no control beside, when the control fails to read', async () => {
    const run = async (prompts, controlFails) => {
      const writes = mockWrites({
        prompts: [
          { id: 'p1', topic_id: 't1' },
          ...Array.from({ length: prompts }, (_, i) => ({ id: `c${i + 1}`, topic_id: 't1' })),
        ],
      });
      rpc.mockImplementation(async (name, args) => {
        if (name !== 'opportunity_basket_metrics') return { data: {}, error: null };
        if (!args.p_prompt_ids.includes('p1') && controlFails) {
          return { data: null, error: { message: 'statement timeout' } };
        }
        const before = args.p_from < daysAgo(20).slice(0, 10);
        return { data: { cells: 100, visible: before ? 20 : 30 }, error: null };
      });
      await validateAction(
        action({
          kind: 'mention_review',
          kpi_keys: ['ai_visibility'],
          payload: { promptIds: ['p1'] },
        }),
        { now: NOW },
      );
      return writes.updated.find((w) => w.table === 'actions').patch;
    };

    const failed = await run(6, true);
    expect(failed.validation.control).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      { err: 'opportunity_basket_metrics: statement timeout', brandId: 'brand-1', actionId: 'a1' },
      '[action-validation] control basket not read',
    );
    expect(failed.outcome).toBe('improved');
    // The same as an action with no control to read.
    expect(failed).toEqual(await run(0, false));
  });

  it('measures before and after over equal windows and stores both', async () => {
    const writes = mockWrites();
    rpc
      .mockResolvedValueOnce({ data: { total_citations: 100 }, error: null })
      .mockResolvedValueOnce({ data: { total_citations: 140 }, error: null });

    const outcome = await validateAction(action(), { now: NOW });

    expect(outcome).toBe('improved');
    const patch = writes.updated.find((w) => w.table === 'actions').patch;
    expect(patch.outcome).toBe('improved');
    expect(patch.validated_at).toBe(NOW.toISOString());
    expect(patch.validation.metrics).toEqual([
      { metric: 'citations', unit: 'count', before: 100, after: 140 },
    ]);
    // Equal-length windows, one before the action was raised and one after it
    // closed — a comparison between like periods.
    expect(patch.validation.beforeWindow.to < patch.validation.afterWindow.from).toBe(true);
  });

  /** Sent with negative answers, it's judged by how the brand is spoken of (learning D1). */
  it('judges answers sent from Mentions by their positive sentiment', async () => {
    const writes = mockWrites();
    let reads = 0;
    // Named as often after as before, but 2 of 10 positive became 6 of 10.
    rpc.mockImplementation(async (name) => {
      if (name !== 'opportunity_basket_metrics') return { data: {}, error: null };
      const after = reads++ % 2 === 1;
      return {
        data: {
          cells: 10,
          visible: 10,
          mention_answers: 10,
          named_answers: 10,
          positive_answers: after ? 6 : 2,
        },
        error: null,
      };
    });

    await validateAction(
      action({
        kind: 'mention_review',
        kpi_keys: ['positive_sentiment', 'mentions', 'ai_visibility'],
        payload: { promptIds: ['p1'] },
      }),
      { now: NOW },
    );

    const patch = writes.updated.find((w) => w.table === 'actions').patch;
    expect(patch.validation.primary).toBe('positive_sentiment');
    expect(patch.validation.metrics).toContainEqual({
      metric: 'positive_sentiment',
      unit: 'percent',
      before: 20,
      after: 60,
    });
    expect(patch.outcome).toBe('improved');
  });

  it("measures answers sent from Mentions on their prompts' basket", async () => {
    const writes = mockWrites();
    rpc.mockResolvedValue({ data: {}, error: null });

    await validateAction(
      action({
        kind: 'mention_review',
        kpi_keys: ['mentions'],
        payload: { promptIds: ['p1', 'p2'] },
      }),
      { now: NOW },
    );

    expect(rpc).toHaveBeenCalledWith('opportunity_basket_metrics', expect.anything());
    const patch = writes.updated.find((w) => w.table === 'actions').patch;
    expect(patch.validation.scope).toEqual({ kind: 'basket', prompts: 2, pages: 0 });
  });

  it('judges a basket by the metrics the action names, keeping the rest to see', async () => {
    // Visibility 20 → 30 on the prompts; the lead over the top competitor 0.4 → 0.3.
    const basket = (before, after) =>
      rpc.mockImplementation(async (_name, args) => ({
        data: args.p_from < daysAgo(20).slice(0, 10) ? before : after,
        error: null,
      }));
    const sent = (kpiKeys) =>
      action({ kind: 'mention_review', kpi_keys: kpiKeys, payload: { promptIds: ['p1'] } });

    let writes = mockWrites();
    basket(
      { cells: 100, visible: 20, top_competitor_visible: 19.6 },
      { cells: 100, visible: 30, top_competitor_visible: 29.7 },
    );
    expect(await validateAction(sent(['ai_visibility']), { now: NOW })).toBe('improved');
    const { validation } = writes.updated.find((w) => w.table === 'actions').patch;
    expect(validation.metrics.find((m) => m.metric === 'competitor_lead')).toMatchObject({
      before: 0.4,
      after: 0.3,
    });

    writes = mockWrites();
    expect(await validateAction(sent(['ai_visibility', 'competitor_lead']), { now: NOW })).toBe(
      'mixed',
    );
  });

  it('measures pages sent from AI Traffic on those pages (AT-006)', async () => {
    const writes = mockWrites();
    rpc.mockResolvedValue({ data: {}, error: null });

    await validateAction(
      action({
        kind: 'traffic_pages',
        kpi_keys: ['ai_referral_traffic', 'citations'],
        payload: {
          pages: ['https://acme.example/shop/beans', 'https://acme.example/guides/espresso'],
        },
      }),
      { now: NOW },
    );

    expect(rpc).toHaveBeenCalledWith('opportunity_basket_metrics', expect.anything());
    const patch = writes.updated.find((w) => w.table === 'actions').patch;
    expect(patch.validation.scope).toEqual({ kind: 'basket', prompts: 0, pages: 2 });
  });

  it('measures a draft sent from the Content Editor on its prompts and page (CE-015)', async () => {
    const writes = mockWrites();
    rpc.mockResolvedValue({ data: {}, error: null });

    await validateAction(
      action({
        kind: 'content_draft',
        kpi_keys: ['ai_visibility', 'citations', 'mentions'],
        payload: {
          promptIds: ['p1', 'p2', 'p3'],
          pages: ['https://acme.example/pricing'],
        },
      }),
      { now: NOW },
    );

    expect(rpc).toHaveBeenCalledWith('opportunity_basket_metrics', expect.anything());
    const patch = writes.updated.find((w) => w.table === 'actions').patch;
    expect(patch.validation.scope).toEqual({ kind: 'basket', prompts: 3, pages: 1 });
  });

  it('records the verdict on the action trail', async () => {
    const writes = mockWrites();
    rpc.mockResolvedValue({ data: { total_citations: 10 }, error: null });

    await validateAction(action(), { now: NOW });

    const event = writes.inserted.find((w) => w.table === 'action_events');
    expect(event.rows.event).toBe('outcome_measured');
  });

  /**
   * An action whose rule never named a success metric cannot be judged. Saying
   * so is honest; inventing a metric it never claimed would not be.
   */
  it('reports an action with no success metrics as not measurable', async () => {
    const writes = mockWrites();

    const outcome = await validateAction(action({ kpi_keys: [] }), { now: NOW });

    expect(outcome).toBe('not_measurable');
    expect(rpc).not.toHaveBeenCalled();
    const patch = writes.updated.find((w) => w.table === 'actions').patch;
    // Nothing measured, the reading kept (learning B1).
    expect(patch.validation).toEqual({
      measuredAt: NOW.toISOString(),
      readings: [{ day: 7, outcome: 'not_measurable' }],
    });
  });

  it('keeps what became of the signals that raised it beside the metrics (learning A3)', async () => {
    const signal = (status, payload = {}) => ({ signals: { status, payload } });
    const writes = mockWrites({
      action_signals: [
        signal('resolved'),
        signal('resolved'),
        signal('resolved', { supersededBy: 'topic_dropped' }),
        signal('dismissed'),
        signal('acknowledged'),
        signal('new'),
      ],
    });
    rpc.mockResolvedValue({ data: { total_citations: 10 }, error: null });

    await validateAction(action(), { now: NOW });

    const patch = writes.updated.find((w) => w.table === 'actions').patch;
    expect(patch.validation.signals).toEqual({
      total: 6,
      ended: 2,
      replaced: 1,
      dismissed: 1,
      open: 2,
    });
    expect(patch.validation.metrics).toHaveLength(1);
  });

  it('keeps the signals of an action with nothing else to measure', async () => {
    const writes = mockWrites({ action_signals: [{ signals: { status: 'resolved' } }] });

    expect(await validateAction(action({ kpi_keys: [] }), { now: NOW })).toBe('not_measurable');

    const patch = writes.updated.find((w) => w.table === 'actions').patch;
    expect(patch.validation).toEqual({
      measuredAt: NOW.toISOString(),
      signals: { total: 1, ended: 1, replaced: 0, dismissed: 0, open: 0 },
      readings: [{ day: 7, outcome: 'not_measurable' }],
    });
  });

  describe('on its targets (learning A1)', () => {
    const P1 = '11111111-1111-4111-8111-111111111111';
    const P2 = '22222222-2222-4222-8222-222222222222';
    /** The basket answers `before` for the window before, `after` for the one after; the brand 100 citations. */
    const answers = (before, after) =>
      rpc.mockImplementation(async (name, args) =>
        name === 'opportunity_basket_metrics'
          ? { data: args.p_from < daysAgo(20).slice(0, 10) ? before : after, error: null }
          : { data: { total_citations: 100 }, error: null },
      );

    it('measures a night-engine action on the prompts it names, the brand-wide figures beside', async () => {
      const writes = mockWrites();
      answers({ cells: 10, visible: 2 }, { cells: 10, visible: 6 });

      const outcome = await validateAction(
        action({
          kind: 'recover_lost_visibility',
          kpi_keys: ['ai_visibility', 'citations'],
          payload: {
            targetEntity: 'prompts',
            targetCount: 2,
            targets: [{ id: P1, label: 'best beans' }],
            targetIds: [P1, P2, 'not-a-prompt-id'],
          },
        }),
        { now: NOW },
      );

      expect(outcome).toBe('improved');
      const basketCall = rpc.mock.calls.find(([name]) => name === 'opportunity_basket_metrics');
      expect(basketCall[1].p_prompt_ids).toEqual([P1, P2]);
      const { validation } = writes.updated.find((w) => w.table === 'actions').patch;
      expect(validation.scope).toEqual({
        kind: 'targets',
        entity: 'prompts',
        prompts: 2,
        pages: 0,
      });
      expect(validation.metrics).toEqual([
        { metric: 'ai_visibility', unit: 'percent', before: 20, after: 60 },
        // A prompt basket has no pages to count citations on.
        { metric: 'citations', unit: 'count', before: null, after: null },
      ]);
      expect(validation.brandWide.map((m) => m.metric)).toEqual(['ai_visibility', 'citations']);
    });

    it("keeps the prompts it names net of the brand's others beside (learning B2)", async () => {
      const writes = mockWrites({
        prompts: [
          { id: P1, topic_id: 't1' },
          ...Array.from({ length: 6 }, (_, i) => ({ id: `c${i + 1}`, topic_id: 't1' })),
        ],
      });
      // Its prompt 20% → 60% visible; the others 40% → 44%.
      rpc.mockImplementation(async (name, args) => {
        if (name !== 'opportunity_basket_metrics') return { data: {}, error: null };
        const before = args.p_from < daysAgo(20).slice(0, 10);
        const visible = args.p_prompt_ids.includes(P1) ? (before ? 2 : 6) : before ? 40 : 44;
        return { data: { cells: args.p_prompt_ids.includes(P1) ? 10 : 100, visible }, error: null };
      });

      await validateAction(
        action({
          kind: 'recover_lost_visibility',
          kpi_keys: ['ai_visibility'],
          payload: { targetEntity: 'prompts', targets: [{ id: P1 }] },
        }),
        { now: NOW },
      );

      const { validation } = writes.updated.find((w) => w.table === 'actions').patch;
      expect(validation.scope.kind).toBe('targets');
      expect(validation.control).toEqual({
        basis: 'topics',
        prompts: 6,
        net: [
          { metric: 'ai_visibility', net: 36, unit: 'points', control: { before: 40, after: 44 } },
        ],
      });
    });

    it('measures brand-wide when the basket can’t read its main metric', async () => {
      // Citations first, on prompts: a prompt basket has no pages to count them on.
      const writes = mockWrites();
      rpc.mockImplementation(async (name, args) => {
        if (name === 'opportunity_basket_metrics') {
          const before = args.p_from < daysAgo(20).slice(0, 10);
          return { data: { cells: 10, visible: 4, mention_answers: before ? 2 : 6 }, error: null };
        }
        const before = args.p_day_from < daysAgo(20).slice(0, 10);
        return {
          data: { total_citations: before ? 100 : 80, total_mentions: 50 },
          error: null,
        };
      });

      const outcome = await validateAction(
        action({
          kind: 'recover_lost_visibility',
          kpi_keys: ['citations', 'mentions'],
          payload: { targetEntity: 'prompts', targetCount: 1, targets: [{ id: P1 }] },
        }),
        { now: NOW },
      );

      // The prompts' mentions tripled; the citations it aims at fell brand-wide.
      expect(outcome).toBe('declined');
      const { validation } = writes.updated.find((w) => w.table === 'actions').patch;
      expect(validation.primary).toBe('citations');
      expect(validation.metrics).toEqual([
        { metric: 'citations', unit: 'count', before: 100, after: 80 },
        { metric: 'mentions', unit: 'count', before: 50, after: 50 },
      ]);
      expect(validation.scope).toEqual({
        kind: 'brand',
        reason: 'primary_not_in_basket',
        entity: 'prompts',
        prompts: 1,
        pages: 0,
      });
      expect(validation.brandWide).toBeUndefined();
      // The brand-wide figures were read once, not again.
      const brandCalls = rpc.mock.calls.filter(([name]) => name === 'insights_aggregates_daily');
      expect(brandCalls).toHaveLength(2);
    });

    it('reads a page written as a path on the brand’s primary domain', async () => {
      mockWrites({ brand_domains: [{ domain: 'https://www.acme.example/' }] });
      answers({}, {});

      await validateAction(
        action({
          kind: 'fix_underperforming_pages',
          kpi_keys: ['citations'],
          payload: { targetEntity: 'pages', targetCount: 1, targets: [{ id: '/pricing' }] },
        }),
        { now: NOW },
      );

      const basketCall = rpc.mock.calls.find(([name]) => name === 'opportunity_basket_metrics');
      expect(basketCall[1].p_page_keys).toEqual(['acme.example/pricing']);
    });

    it('measures brand-wide when the targets measured nothing, or are of another kind', async () => {
      let writes = mockWrites();
      answers({}, {});
      await validateAction(
        action({ payload: { targetEntity: 'prompts', targets: [{ id: P1 }] } }),
        { now: NOW },
      );
      let { validation } = writes.updated.find((w) => w.table === 'actions').patch;
      expect(validation.scope).toBeUndefined();
      expect(validation.metrics.map((m) => m.metric)).toEqual(['citations']);

      rpc.mockReset();
      writes = mockWrites();
      rpc.mockResolvedValue({ data: { total_citations: 10 }, error: null });
      await validateAction(
        action({ payload: { targetEntity: 'competitors', targets: [{ id: 'Rival' }] } }),
        { now: NOW },
      );
      expect(rpc.mock.calls.some(([name]) => name === 'opportunity_basket_metrics')).toBe(false);
      ({ validation } = writes.updated.find((w) => w.table === 'actions').patch);
      expect(validation.scope).toBeUndefined();
    });
  });

  it('judges a Site Audit fix by its pages audited again since it closed (learning A2)', async () => {
    const writes = mockWrites({
      site_audits: [{ id: 'au1', url: 'https://acme.example/pricing', total_score: 0.7 }],
      audit_signal_results: [{ audit_id: 'au1', signal_key: 'json-ld-validity', status: 'pass' }],
    });
    // The page's citations didn't move over the week.
    rpc.mockResolvedValue({ data: { page_citations: 3 }, error: null });

    const outcome = await validateAction(
      action({
        kind: 'fix_structured_data',
        kpi_keys: [],
        payload: {
          targetEntity: 'pages',
          targets: [{ id: 'https://acme.example/pricing', checks: ['json-ld-validity'] }],
        },
      }),
      { now: NOW },
    );

    expect(outcome).toBe('improved');
    const patch = writes.updated.find((w) => w.table === 'actions').patch;
    expect(patch.outcome).toBe('improved');
    expect(patch.validation.audit).toEqual({ pages: 1, audited: 1, passed: 1 });
    expect(patch.validation.metrics.find((m) => m.metric === 'citations')).toMatchObject({
      before: 3,
      after: 3,
    });
  });

  describe('with nights tracking missed (learning A6)', () => {
    const missing = (nights) => EVERY_NIGHT.filter((_, i) => !nights.includes(i));
    // The after window is the 7 days from 9 days ago; the before, from 37 days ago.

    it('flags a window with a missed night or two, and still reads it', async () => {
      const writes = mockWrites({ tracking_runs: missing([5, 6]) });
      rpc
        .mockResolvedValueOnce({ data: { total_citations: 100 }, error: null })
        .mockResolvedValueOnce({ data: { total_citations: 140 }, error: null });

      expect(await validateAction(action(), { now: NOW })).toBe('improved');
      const { validation } = writes.updated.find((w) => w.table === 'actions').patch;
      expect(validation.gaps).toEqual({ before: 0, after: 2 });
    });

    /** Each source answers `before` over the week before, `after` over the week after. */
    const weeks = (byName) =>
      rpc.mockImplementation(async (name, args) => {
        const from = args.p_day_from ?? args.p_from;
        const [before, after] = byName[name] ?? [{}, {}];
        return { data: from < daysAgo(20).slice(0, 10) ? before : after, error: null };
      });

    it('reads a count at a full week’s worth from the nights that ran: 7 nights of 100 vs 6', async () => {
      const writes = mockWrites({ tracking_runs: missing([5]) });
      weeks({ insights_aggregates_daily: [{ total_citations: 700 }, { total_citations: 600 }] });

      // Read as it came, the missed night is a 14% decline nobody caused.
      expect(await validateAction(action(), { now: NOW })).toBe('no_meaningful_change');
      const { validation } = writes.updated.find((w) => w.table === 'actions').patch;
      expect(validation.metrics).toEqual([
        {
          metric: 'citations',
          unit: 'count',
          before: 700,
          after: 700,
          raw: { before: 700, after: 600 },
        },
      ]);
      expect(validation.gaps).toEqual({ before: 0, after: 1 });
    });

    it('reads the counts of the prompts it names, and the brand-wide ones, the same way', async () => {
      const P1 = '11111111-1111-4111-8111-111111111111';
      const writes = mockWrites({ tracking_runs: missing([5]) });
      weeks({
        opportunity_basket_metrics: [
          { cells: 70, visible: 14, mention_answers: 70 },
          { cells: 60, visible: 12, mention_answers: 60 },
        ],
        insights_aggregates_daily: [{ total_mentions: 700 }, { total_mentions: 600 }],
      });

      const outcome = await validateAction(
        action({
          kind: 'recover_lost_visibility',
          kpi_keys: ['mentions'],
          payload: { targetEntity: 'prompts', targets: [{ id: P1 }] },
        }),
        { now: NOW },
      );

      expect(outcome).toBe('no_meaningful_change');
      const { validation } = writes.updated.find((w) => w.table === 'actions').patch;
      expect(validation.metrics[0]).toMatchObject({ metric: 'mentions', before: 70, after: 70 });
      expect(validation.brandWide[0]).toMatchObject({
        metric: 'mentions',
        before: 700,
        after: 700,
        raw: { before: 700, after: 600 },
      });
    });

    it('past MAX_GAP_DAYS leaves the counts out, and a rate still judges', async () => {
      // Share of voice 20% → 30%; citations read over 3 nights of the week after.
      const sources = {
        share_of_voice_aggregates_daily: [
          { total_brand_mentions: 20, total_competitor_mentions: 80 },
          { total_brand_mentions: 30, total_competitor_mentions: 70 },
        ],
        insights_aggregates_daily: [{ total_citations: 700 }, { total_citations: 300 }],
      };
      let writes = mockWrites({ tracking_runs: missing([3, 4, 5, 6]) });
      weeks(sources);

      expect(
        await validateAction(action({ kpi_keys: ['share_of_voice', 'citations'] }), { now: NOW }),
      ).toBe('improved');
      const { validation } = writes.updated.find((w) => w.table === 'actions').patch;
      expect(validation.gaps).toEqual({ before: 0, after: 4, tooMany: true });
      // Too few nights to scale from: the counts stay as read.
      expect(validation.metrics[1]).toEqual({
        metric: 'citations',
        unit: 'count',
        before: 700,
        after: 300,
      });

      // Its main metric a count: the weeks can't be compared.
      writes = mockWrites({ tracking_runs: missing([3, 4, 5, 6]) });
      expect(
        await validateAction(action({ kpi_keys: ['citations', 'share_of_voice'] }), { now: NOW }),
      ).toBe('not_measurable');
    });

    it('reads it not measurable past MAX_GAP_DAYS when its main metric is a count', async () => {
      const writes = mockWrites({ tracking_runs: missing([3, 4, 5, 6]) });
      rpc
        .mockResolvedValueOnce({ data: { total_citations: 100 }, error: null })
        .mockResolvedValueOnce({ data: { total_citations: 60 }, error: null });

      expect(await validateAction(action(), { now: NOW })).toBe('not_measurable');
      const patch = writes.updated.find((w) => w.table === 'actions').patch;
      expect(patch.validation.gaps).toEqual({ before: 0, after: 4, tooMany: true });
      // The figures stay, to see.
      expect(patch.validation.metrics[0]).toMatchObject({ before: 100, after: 60 });
      expect(MAX_GAP_DAYS).toBe(2);
    });

    /** Net of the brand's other prompts (learning B2), on the same scale as the result. */
    describe("an action's change net of its control", () => {
      /** The control's prompts: six others in its topic. */
      const prompts = [
        { id: 'p1', topic_id: 't1' },
        ...Array.from({ length: 6 }, (_, i) => ({ id: `c${i + 1}`, topic_id: 't1' })),
      ];
      /** The basket's prompts answer `own`, the control's `others`, each [before, after]. */
      const baskets = (own, others) =>
        rpc.mockImplementation(async (name, args) => {
          if (name !== 'opportunity_basket_metrics') return { data: {}, error: null };
          const [before, after] = args.p_prompt_ids.includes('p1') ? own : others;
          return { data: args.p_from < daysAgo(20).slice(0, 10) ? before : after, error: null };
        });
      const sent = (kpiKeys) =>
        action({ kind: 'mention_review', kpi_keys: kpiKeys, payload: { promptIds: ['p1'] } });

      it('reads its counts at a full week’s worth too, from the same nights', async () => {
        // Two nights missed in the week after. Per night its mentions doubled
        // (1 → 2) and the others' held (20 → 20): read as they came, 7 → 10
        // and 140 → 100 net to +71.4%; a week's worth, 7 → 14 and 140 → 140.
        const writes = mockWrites({ prompts, tracking_runs: missing([5, 6]) });
        baskets(
          [
            { cells: 70, visible: 14, mention_answers: 7 },
            { cells: 50, visible: 10, mention_answers: 10 },
          ],
          [
            { cells: 420, visible: 140, mention_answers: 140 },
            { cells: 300, visible: 100, mention_answers: 100 },
          ],
        );

        await validateAction(sent(['mentions']), { now: NOW });

        const { validation } = writes.updated.find((w) => w.table === 'actions').patch;
        expect(validation.gaps).toEqual({ before: 0, after: 2 });
        expect(validation.metrics.find((m) => m.metric === 'mentions')).toMatchObject({
          before: 7,
          after: 14,
        });
        expect(validation.control.net).toContainEqual({
          metric: 'mentions',
          net: 100,
          unit: 'percent',
          control: { before: 140, after: 140 },
        });
      });

      it('past MAX_GAP_DAYS nets the rates alone, the counts left out with the result’s', async () => {
        const writes = mockWrites({ prompts, tracking_runs: missing([3, 4, 5, 6]) });
        baskets(
          [
            { cells: 100, visible: 20, mention_answers: 10 },
            { cells: 100, visible: 30, mention_answers: 20 },
          ],
          [
            { cells: 100, visible: 40, mention_answers: 200 },
            { cells: 100, visible: 44, mention_answers: 120 },
          ],
        );

        expect(await validateAction(sent(['ai_visibility']), { now: NOW })).toBe('improved');

        const { validation } = writes.updated.find((w) => w.table === 'actions').patch;
        expect(validation.gaps).toEqual({ before: 0, after: 4, tooMany: true });
        const netted = validation.control.net.map((m) => m.metric);
        expect(netted).toContain('ai_visibility');
        expect(netted).not.toContain('mentions');
        expect(validation.control.net.find((m) => m.metric === 'ai_visibility').net).toBe(6);
      });
    });

    it('doesn’t count nights for metrics tracking doesn’t read (AI sessions)', async () => {
      const writes = mockWrites({ tracking_runs: [] });
      rpc.mockResolvedValue({ data: {}, error: null });
      await validateAction(action({ kpi_keys: ['ai_referral_traffic'] }), { now: NOW });
      const { validation } = writes.updated.find((w) => w.table === 'actions').patch;
      expect(validation?.gaps).toBeUndefined();
    });

    it('doesn’t count nights for a rate alone: it doesn’t drift from a missed one', async () => {
      const writes = mockWrites({ tracking_runs: [] });
      weeks({
        share_of_voice_aggregates_daily: [
          { total_brand_mentions: 20, total_competitor_mentions: 80 },
          { total_brand_mentions: 30, total_competitor_mentions: 70 },
        ],
      });

      expect(await validateAction(action({ kpi_keys: ['share_of_voice'] }), { now: NOW })).toBe(
        'improved',
      );
      const { validation } = writes.updated.find((w) => w.table === 'actions').patch;
      expect(validation.gaps).toBeUndefined();
    });
  });

  describe('read a week, two weeks and a month on (learning B1)', () => {
    /** The brand's citations by the window's last day: 100 before, then by `after`. */
    const byDay = (after) =>
      rpc.mockImplementation(async (_name, args) => {
        const end = args.p_day_to;
        const value = Object.entries(after).find(([since]) => end >= since)?.[1] ?? 100;
        return { data: { total_citations: value }, error: null };
      });

    it('takes the week-on reading first, final later, the event naming the day', async () => {
      const writes = mockWrites();
      byDay({ [daysAgo(7).slice(0, 10)]: 140 });

      expect(await validateAction(action(), { now: NOW })).toBe('improved');
      const { validation } = writes.updated.find((w) => w.table === 'actions').patch;
      expect(validation.readings.map((r) => [r.day, r.outcome])).toEqual([[7, 'improved']]);
      expect(validation.final).toBeUndefined();
      const event = writes.inserted.find((w) => w.table === 'action_events');
      expect(event.rows.data).toEqual({ outcome: 'improved', day: 7 });
    });

    it('takes every reading due at once, the last one final and the verdict', async () => {
      const writes = mockWrites();
      // Closed 40 days ago: up by week one and two, back down by the month.
      byDay({ [daysAgo(12).slice(0, 10)]: 96, [daysAgo(34).slice(0, 10)]: 150 });

      const outcome = await validateAction(
        action({ created_at: daysAgo(50), completed_at: daysAgo(40) }),
        { now: NOW },
      );
      expect(outcome).toBe('no_meaningful_change');
      const { validation, outcome: stored } = writes.updated.find(
        (w) => w.table === 'actions',
      ).patch;
      expect(stored).toBe('no_meaningful_change');
      expect(validation.readings.map((r) => [r.day, r.outcome])).toEqual([
        [7, 'improved'],
        [14, 'improved'],
        [30, 'no_meaningful_change'],
      ]);
      expect(validation.final).toBe(true);
      // The weeks ending 7, 14 and 30 days after the close.
      expect(validation.readings.map((r) => r.afterWindow.to)).toEqual([
        daysAgo(33).slice(0, 10),
        daysAgo(26).slice(0, 10),
        daysAgo(10).slice(0, 10),
      ]);
      expect(writes.inserted.find((w) => w.table === 'action_events').rows.data).toEqual({
        outcome: 'no_meaningful_change',
        day: 30,
        final: true,
      });
    });

    it("reads the control's prompts and week before once for every reading due (learning B2)", async () => {
      const writes = mockWrites({
        prompts: [
          { id: 'p1', topic_id: 't1' },
          ...Array.from({ length: 6 }, (_, i) => ({ id: `c${i + 1}`, topic_id: 't1' })),
        ],
      });
      rpc.mockResolvedValue({ data: { cells: 100, visible: 40 }, error: null });

      await validateAction(
        action({
          kind: 'mention_review',
          kpi_keys: ['ai_visibility'],
          payload: { promptIds: ['p1'] },
          created_at: daysAgo(50),
          completed_at: daysAgo(40),
        }),
        { now: NOW },
      );

      const { validation } = writes.updated.find((w) => w.table === 'actions').patch;
      expect(validation.readings.map((r) => r.day)).toEqual([7, 14, 30]);
      expect(validation.control).toMatchObject({ basis: 'topics', prompts: 6 });
      // Its topics, then the control's prompts: once, not for each reading.
      expect(from.mock.calls.filter(([table]) => table === 'prompts')).toHaveLength(2);
      // The control's week before once, and each reading's week after.
      const controlReads = rpc.mock.calls
        .filter(([name]) => name === 'opportunity_basket_metrics')
        .filter(([, args]) => !args.p_prompt_ids.includes('p1'))
        .map(([, args]) => args.p_from);
      expect(controlReads).toHaveLength(4);
      expect(controlReads.filter((day) => day === daysAgo(57).slice(0, 10))).toHaveLength(1);
    });

    it('adds the readings due to those it has, and reads nothing once final', async () => {
      let writes = mockWrites();
      byDay({ [daysAgo(20).slice(0, 10)]: 140 });
      const earlier = { readings: [{ day: 7, outcome: 'improved' }] };
      await validateAction(action({ completed_at: daysAgo(20), validation: earlier }), {
        now: NOW,
      });
      const { validation } = writes.updated.find((w) => w.table === 'actions').patch;
      expect(validation.readings.map((r) => r.day)).toEqual([7, 14]);

      writes = mockWrites();
      const final = {
        final: true,
        readings: [7, 14, 30].map((day) => ({ day, outcome: 'improved' })),
      };
      expect(
        await validateAction(action({ completed_at: daysAgo(40), validation: final }), {
          now: NOW,
        }),
      ).toBeNull();
      expect(writes.updated).toHaveLength(0);
    });
  });

  it('sweeps the closed actions not read for the last time yet (learning B1)', async () => {
    const writes = mockWrites({
      actions: [
        {
          id: 'a1',
          brand_id: 'brand-1',
          kpi_keys: ['citations'],
          created_at: daysAgo(30),
          completed_at: daysAgo(10),
          validation: null,
        },
      ],
    });
    rpc.mockResolvedValue({ data: { total_citations: 10 }, error: null });

    expect(await sweepActionValidation({ now: NOW })).toEqual({ measured: 1, failed: 0 });
    expect(writes.ors).toEqual([{ table: 'actions', filter: SWEEP_FILTER }]);
  });

  it('reads the list in pages, so actions waiting for a later reading crowd out none due', async () => {
    // A full page of actions read a week on, their next reading not due yet.
    const waiting = Array.from({ length: 500 }, (_, i) => ({
      id: `w${String(i).padStart(3, '0')}`,
      brand_id: 'brand-1',
      kpi_keys: ['citations'],
      created_at: daysAgo(30),
      completed_at: daysAgo(10),
      validation: { readings: [{ day: 7, outcome: 'improved' }] },
    }));
    const pages = [waiting, []];
    const after = [];
    from.mockImplementation(() => {
      const page = pages.shift();
      const builder = {
        select: () => builder,
        eq: () => builder,
        or: () => builder,
        not: () => builder,
        lte: () => builder,
        order: () => builder,
        limit: () => builder,
        gt: (_column, id) => {
          after.push(id);
          return builder;
        },
        then: (resolve, reject) =>
          Promise.resolve({ data: page, error: null }).then(resolve, reject),
      };
      return builder;
    });

    expect(await sweepActionValidation({ now: NOW })).toEqual({ measured: 0, failed: 0 });
    expect(after).toEqual(['w499']);
    expect(pages).toEqual([]);
  });

  it('does nothing for an action that never closed', async () => {
    const writes = mockWrites();

    const outcome = await validateAction(action({ completed_at: null }), { now: NOW });

    expect(outcome).toBeNull();
    expect(writes.updated).toHaveLength(0);
  });
});

describe('sweepActionValidation', () => {
  it("never reads a demo brand's actions (00380): their outcomes are written with them", async () => {
    const asked = [];
    from.mockImplementation((table) => {
      const builder = {
        select: (columns) => (asked.push(['select', table, columns]), builder),
        eq: (column, value) => (asked.push(['eq', column, value]), builder),
        or: () => builder,
        not: () => builder,
        lte: () => builder,
        order: () => builder,
        limit: () => builder,
        then: (resolve, reject) => Promise.resolve({ data: [], error: null }).then(resolve, reject),
      };
      return builder;
    });

    expect(await sweepActionValidation({ now: NOW })).toEqual({ measured: 0, failed: 0 });
    expect(asked[0][2]).toContain('brands!inner(is_demo)');
    expect(asked).toContainEqual(['eq', 'brands.is_demo', false]);
  });
});
