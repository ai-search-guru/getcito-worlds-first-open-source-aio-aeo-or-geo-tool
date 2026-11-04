import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The module reaches the supabase admin client at import time, whose config
// hard-exits when SUPABASE_* env is absent (as in CI).
const from = vi.fn();
vi.mock('../../config/supabase.js', () => ({ default: { from: (...a) => from(...a) } }));
vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { generateActionsForBrand } from './generate.js';
import { ENGINE_THRESHOLDS } from '../../config/actionEngine.js';

const { maxNewActionsPerDay } = ENGINE_THRESHOLDS.noise;

const BRAND = 'brand-1';
/** A brand with everything connected, so eligibility is not what a test is
 *  measuring unless it says so. */
const ALL_SOURCES = new Set(['tracking', 'competitors', 'site_audits', 'analytics']);
const NOW = new Date('2026-09-16T04:00:00Z');

/**
 * Enough of the PostgREST builder to drive the generator.
 *
 * Each table answers from `tables`, and every write is recorded so a test can
 * assert what the night actually did. The builder is thenable, which is what
 * lets `await supabase.from(x).select(y).eq(...)` resolve without a terminal
 * call.
 */
function mockDb({
  signals = [],
  activeActions = [],
  closedActions = [],
  candidates = [],
  promptVolumes = [],
  failActionUpdates = false,
} = {}) {
  // `log` keeps the order of the writes across tables.
  const writes = { inserted: [], updated: [], upserted: [], log: [] };

  from.mockImplementation((table) => {
    const state = { op: 'select', payload: null, negated: false };

    const builder = {
      select: () => builder,
      eq: () => builder,
      // The generator asks for actions twice: `.not('status', 'in', ...)` for
      // the active ones, `.in('status', [...])` for the closed ones. The mock
      // has to tell them apart or every test sees one list.
      not: () => {
        state.negated = true;
        return builder;
      },
      in: () => builder,
      gte: () => builder,
      order: () => builder,
      limit: () => builder,
      range: () => builder,
      single: () => Promise.resolve(result()),
      // The brand's Analytics sign-in (resolveBrandSources, 00470): none.
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
      insert: (payload) => {
        state.op = 'insert';
        state.payload = payload;
        writes.inserted.push({ table, rows: Array.isArray(payload) ? payload : [payload] });
        return builder;
      },
      update: (payload) => {
        state.op = 'update';
        state.payload = payload;
        writes.updated.push({ table, patch: payload });
        writes.log.push(`update ${table}`);
        return builder;
      },
      upsert: (payload) => {
        state.op = 'upsert';
        writes.upserted.push({ table, rows: Array.isArray(payload) ? payload : [payload] });
        writes.log.push(`upsert ${table}`);
        return builder;
      },
      then: (resolve, reject) => Promise.resolve(result()).then(resolve, reject),
    };

    function result() {
      if (state.op === 'insert') return { data: { id: `new-${table}` }, error: null };
      if (state.op === 'upsert') return { data: null, error: null };
      if (state.op === 'update') {
        const failed =
          failActionUpdates && table === 'actions' && 'priority_score' in state.payload;
        return { data: null, error: failed ? { message: 'column does not exist' } : null };
      }
      if (table === 'signals') return { data: signals, error: null };
      if (table === 'actions') {
        return { data: state.negated ? activeActions : closedActions, error: null };
      }
      if (table === 'action_candidates') return { data: candidates, error: null };
      if (table === 'prompt_volumes') return { data: promptVolumes, error: null };
      return { data: [], error: null };
    }

    return builder;
  });

  return writes;
}

const signal = (over = {}) => ({
  id: 's1',
  kind: 'sharp_drop',
  impact: 'high',
  kpi_keys: ['ai_visibility'],
  payload: {},
  previous_value: 40,
  current_value: 20,
  change_value: -20,
  action_id: null,
  ...over,
});

const daysAgo = (n) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

beforeEach(() => {
  from.mockReset();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('generateActionsForBrand', () => {
  it('opens an action when the kind has no active one', async () => {
    const writes = mockDb({ signals: [signal()] });

    const summary = await generateActionsForBrand(BRAND, { now: NOW });

    expect(summary.created).toBe(1);
    const action = writes.inserted.find((w) => w.table === 'actions');
    expect(action.rows[0]).toMatchObject({
      brand_id: BRAND,
      kind: 'recover_visibility',
      dedup_key: 'recover_visibility',
    });
    // Its own baseline — the "before" half of a future measurement.
    expect(action.rows[0].baseline.signals).toHaveLength(1);
    // Written with its priority (AC-006), from the drop it rests on.
    expect(action.rows[0]).toMatchObject({
      priority_score: expect.any(Number),
      priority_level: expect.stringMatching(/^(critical|high|medium|low)$/),
      priority_reason: expect.objectContaining({ change: 'dropped' }),
      priority_updated_at: NOW.toISOString(),
    });
    // The plan comes from the specification's library, and ends in validation.
    const keys = writes.inserted
      .find((w) => w.table === 'action_tasks')
      .rows.map((r) => r.task_key);
    expect(keys).toContain('validate_ai_visibility');
    expect(keys.at(-1)).toBe('measure_action_outcome');
    // Each with its template's check (AC-010); the analysis none.
    const rows = writes.inserted.find((w) => w.table === 'action_tasks').rows;
    expect(rows.find((r) => r.task_key === 'validate_ai_visibility').details).toEqual({
      check: 'rerun',
      source: 'template',
    });
    const analysis = rows.find((r) => r.task_key.startsWith('analyze_'));
    expect(analysis).toBeDefined();
    expect(analysis.details).toBeNull();
  });

  /**
   * The bug this phase exists for. The nightly pass used to rewrite an active
   * action's payload, so a recovery someone had already started silently
   * became a recovery for a different set of prompts.
   */
  it('never rewrites an active action’s scope', async () => {
    const writes = mockDb({
      signals: [signal({ id: 's2' })],
      activeActions: [{ id: 'a1', dedup_key: 'recover_visibility', status: 'in_progress' }],
    });

    const summary = await generateActionsForBrand(BRAND, { now: NOW });

    expect(summary.created).toBe(0);
    expect(summary.refreshed).toBe(1);
    expect(writes.inserted.find((w) => w.table === 'actions')).toBeUndefined();

    const actionPatches = writes.updated.filter((w) => w.table === 'actions');
    for (const patch of actionPatches) {
      expect(patch.patch).not.toHaveProperty('payload');
      expect(patch.patch).not.toHaveProperty('impact');
      expect(patch.patch).not.toHaveProperty('kpi_keys');
    }
  });

  it('links new signals to the active action as evidence', async () => {
    const writes = mockDb({
      signals: [signal({ id: 's3' })],
      activeActions: [{ id: 'a1', dedup_key: 'recover_visibility', status: 'new' }],
    });

    await generateActionsForBrand(BRAND, { now: NOW });

    expect(writes.updated.some((w) => w.table === 'signals')).toBe(true);
    expect(
      writes.inserted.some(
        (w) => w.table === 'action_events' && w.rows[0].event === 'signals_linked',
      ),
    ).toBe(true);
  });

  it('keeps every link in action_signals, the signals and the action both ways', async () => {
    const writes = mockDb({ signals: [signal({ id: 's1' }), signal({ id: 's2' })] });

    await generateActionsForBrand(BRAND, { now: NOW });

    const links = writes.upserted.filter((w) => w.table === 'action_signals');
    expect(links.flatMap((w) => w.rows)).toEqual([
      { action_id: 'new-actions', signal_id: 's1', linked_at: NOW.toISOString() },
      { action_id: 'new-actions', signal_id: 's2', linked_at: NOW.toISOString() },
    ]);
  });

  it('writes the link before pointing the signal at the action', async () => {
    const writes = mockDb({ signals: [signal()] });

    await generateActionsForBrand(BRAND, { now: NOW });

    // If the second write fails, the signal is not taken and is linked again
    // the next night, rather than taken with no link to show it by.
    const link = writes.log.indexOf('upsert action_signals');
    const point = writes.log.indexOf('update signals');
    expect(link).toBeGreaterThanOrEqual(0);
    expect(link).toBeLessThan(point);
  });

  /**
   * AC-007: signals stay granular, actions don't multiply. Two prompts that
   * say much the same thing are two signals of one kind, and one kind is one
   * response — so they are one action covering both.
   */
  it('makes one action of two similar prompts with the same root cause', async () => {
    const writes = mockDb({
      signals: [
        signal({ id: 'best', payload: { promptText: 'What is the best AI rank tracker?' } }),
        signal({
          id: 'accurate',
          payload: { promptText: 'What are the most accurate AI rank tracker tools?' },
        }),
      ],
    });

    const summary = await generateActionsForBrand(BRAND, { now: NOW });

    expect(summary.created).toBe(1);
    expect(writes.inserted.filter((w) => w.table === 'actions')).toHaveLength(1);
    const linked = writes.updated.find((w) => w.table === 'signals');
    expect(linked.patch).toEqual({ action_id: 'new-actions' });
    expect(writes.upserted.flatMap((w) => w.rows).map((row) => row.signal_id)).toEqual([
      'best',
      'accurate',
    ]);
  });

  /**
   * A signal still open after its action closed is a condition still firing.
   * It used to keep pointing at the closed action and never start another.
   */
  it('lets a signal whose action closed start the next cycle', async () => {
    const writes = mockDb({
      signals: [signal({ action_id: 'closed-1' })],
      closedActions: [
        { dedup_key: 'recover_visibility', completed_at: daysAgo(40), updated_at: daysAgo(40) },
      ],
    });

    const summary = await generateActionsForBrand(BRAND, { now: NOW });

    expect(summary.created).toBe(1);
    expect(writes.updated.find((w) => w.table === 'signals').patch).toEqual({
      action_id: 'new-actions',
    });
    // The closed action keeps its link: it still lists the signal.
    expect(writes.upserted.flatMap((w) => w.rows)).toEqual([
      { action_id: 'new-actions', signal_id: 's1', linked_at: NOW.toISOString() },
    ]);
  });

  /**
   * A closed action is the record of one execution cycle. The old code set a
   * completed row's status back to 'new' and cleared completed_at, which
   * destroyed that record instead of adding to it.
   */
  it('never resurrects a closed action', async () => {
    const writes = mockDb({
      signals: [signal()],
      closedActions: [
        { dedup_key: 'recover_visibility', completed_at: daysAgo(40), updated_at: daysAgo(40) },
      ],
    });

    await generateActionsForBrand(BRAND, { now: NOW });

    const patches = writes.updated.filter((w) => w.table === 'actions');
    for (const patch of patches) {
      expect(patch.patch).not.toHaveProperty('status');
      expect(patch.patch).not.toHaveProperty('completed_at');
    }
    expect(
      writes.inserted.some((w) => w.table === 'action_events' && w.rows[0].event === 'reopened'),
    ).toBe(false);
  });

  it('opens a new cycle once the rest window has passed', async () => {
    const writes = mockDb({
      signals: [signal()],
      // No active action; the last cycle closed well outside the rest window.
      closedActions: [
        { dedup_key: 'recover_visibility', completed_at: daysAgo(40), updated_at: daysAgo(40) },
      ],
    });

    const summary = await generateActionsForBrand(BRAND, { now: NOW });

    expect(summary.created).toBe(1);
    expect(summary.resting).toBe(0);
    // A second row beside the old one, not a rewrite of it.
    expect(writes.inserted.find((w) => w.table === 'actions')).toBeDefined();
    expect(writes.updated.filter((w) => w.table === 'actions')).toHaveLength(0);
  });

  it('rests instead of reopening the night after a cycle closed', async () => {
    const writes = mockDb({
      signals: [signal()],
      closedActions: [
        { dedup_key: 'recover_visibility', completed_at: daysAgo(1), updated_at: daysAgo(1) },
      ],
    });

    const summary = await generateActionsForBrand(BRAND, { now: NOW });

    expect(summary.created).toBe(0);
    expect(summary.resting).toBe(1);
    expect(writes.inserted.find((w) => w.table === 'actions')).toBeUndefined();
  });

  it('does nothing for a kind with no matching open signals', async () => {
    const writes = mockDb({ signals: [] });

    const summary = await generateActionsForBrand(BRAND, { now: NOW });

    expect(summary).toEqual({
      created: 0,
      rescored: 0,
      refreshed: 0,
      resting: 0,
      ineligible: 0,
      capped: 0,
      queued: 0,
      waiting: 0,
      stale: 0,
    });
    expect(writes.inserted).toHaveLength(0);
  });
});

/**
 * Phase 4 (#818): the engine stopped knowing any definition by name. What is
 * tested here is the part it still owns — whether a brand may have this
 * definition at all, and how many it may have in one day.
 */
describe('eligibility', () => {
  it('does not raise a definition the brand has no data for', async () => {
    const writes = mockDb({ signals: [signal({ kind: 'page_opportunity', impact: 'medium' })] });

    // Page opportunities are landing pages read from an analytics connection.
    const summary = await generateActionsForBrand(BRAND, {
      now: NOW,
      sources: new Set(['tracking']),
    });

    expect(summary.created).toBe(0);
    expect(summary.ineligible).toBe(1);
    expect(writes.inserted.find((w) => w.table === 'actions')).toBeUndefined();
  });

  it('raises it once the source is connected', async () => {
    const writes = mockDb({ signals: [signal({ kind: 'page_opportunity', impact: 'medium' })] });

    const summary = await generateActionsForBrand(BRAND, { now: NOW, sources: ALL_SOURCES });

    expect(summary.created).toBe(1);
    expect(summary.ineligible).toBe(0);
    expect(writes.inserted.find((w) => w.table === 'actions').rows[0]).toMatchObject({
      kind: 'capture_ai_traffic',
      category: 'growth',
    });
  });

  /**
   * Losing a source mid-cycle must not orphan work already handed out: the
   * action stays, and evidence keeps attaching to it.
   */
  it('keeps maintaining an active action whose source went away', async () => {
    const writes = mockDb({
      signals: [signal({ id: 's9', kind: 'page_opportunity', impact: 'medium' })],
      activeActions: [{ id: 'a9', dedup_key: 'capture_ai_traffic', status: 'in_progress' }],
    });

    const summary = await generateActionsForBrand(BRAND, {
      now: NOW,
      sources: new Set(['tracking']),
    });

    expect(summary.refreshed).toBe(1);
    expect(summary.ineligible).toBe(0);
    expect(writes.updated.some((w) => w.table === 'signals')).toBe(true);
  });
});

describe('the daily cap', () => {
  /** One open signal for every definition that exists. */
  const oneOfEachKind = () =>
    [
      'sharp_drop',
      'visibility_slipping',
      'platform_gap',
      'uncited_mentions',
      'page_opportunity',
      'audit_low_score',
      'competitor_citation_gap',
      'competitor_surge',
    ].map((kind, index) => signal({ id: `s${index}`, kind, impact: 'medium' }));

  it('stops at the configured number of new actions a day', async () => {
    const writes = mockDb({ signals: oneOfEachKind() });

    const summary = await generateActionsForBrand(BRAND, { now: NOW, sources: ALL_SOURCES });

    expect(summary.created).toBe(maxNewActionsPerDay);
    expect(summary.capped).toBe(8 - maxNewActionsPerDay);
    expect(writes.inserted.filter((w) => w.table === 'actions')).toHaveLength(maxNewActionsPerDay);
  });

  /**
   * The budget is the day's, not the run's. An action raised this morning
   * and dismissed by lunch still spent its slot — the brand was told.
   */
  it('counts what the brand was already given today', async () => {
    const spent = Array.from({ length: maxNewActionsPerDay - 1 }, (_, i) => ({
      id: `spent-${i}`,
      dedup_key: `unrelated-${i}`,
      status: 'new',
      created_at: NOW.toISOString(),
    }));
    const writes = mockDb({ signals: oneOfEachKind(), activeActions: spent });

    const summary = await generateActionsForBrand(BRAND, { now: NOW, sources: ALL_SOURCES });

    expect(summary.created).toBe(1);
    expect(writes.inserted.filter((w) => w.table === 'actions')).toHaveLength(1);
  });

  /** A finding sent from Chat is a person's send, as Improve's or Content's: it counts. */
  it('counts actions sent from Chat today, as any a person sent', async () => {
    const fromChat = Array.from({ length: maxNewActionsPerDay - 1 }, (_, i) => ({
      id: `chat-${i}`,
      dedup_key: `chat_finding:fix:${i}`,
      kind: 'chat_finding',
      status: 'new',
      created_at: NOW.toISOString(),
    }));
    mockDb({ signals: oneOfEachKind(), activeActions: fromChat });

    const summary = await generateActionsForBrand(BRAND, { now: NOW, sources: ALL_SOURCES });

    expect(summary.created).toBe(1);
  });

  it('ignores actions raised on earlier days', async () => {
    const yesterday = Array.from({ length: maxNewActionsPerDay }, (_, i) => ({
      id: `old-${i}`,
      dedup_key: `unrelated-${i}`,
      status: 'new',
      created_at: daysAgo(1),
    }));
    mockDb({ signals: oneOfEachKind(), activeActions: yesterday });

    const summary = await generateActionsForBrand(BRAND, { now: NOW, sources: ALL_SOURCES });

    expect(summary.created).toBe(maxNewActionsPerDay);
  });

  /** When there is room for one, it goes to the one that matters most. */
  it('spends the last slot on the highest impact candidate', async () => {
    const spent = Array.from({ length: maxNewActionsPerDay - 1 }, (_, i) => ({
      id: `spent-${i}`,
      dedup_key: `unrelated-${i}`,
      status: 'new',
      created_at: NOW.toISOString(),
    }));
    const writes = mockDb({
      signals: [
        signal({ id: 'low', kind: 'platform_gap', impact: 'low' }),
        signal({ id: 'high', kind: 'sharp_drop', impact: 'high' }),
      ],
      activeActions: spent,
    });

    const summary = await generateActionsForBrand(BRAND, { now: NOW, sources: ALL_SOURCES });

    expect(summary.created).toBe(1);
    expect(summary.capped).toBe(1);
    expect(writes.inserted.find((w) => w.table === 'actions').rows[0].kind).toBe(
      'recover_visibility',
    );
  });
});

describe('the definition version', () => {
  it('is stamped on the action that the definition raised', async () => {
    const writes = mockDb({ signals: [signal()] });

    await generateActionsForBrand(BRAND, { now: NOW, sources: ALL_SOURCES });

    const row = writes.inserted.find((w) => w.table === 'actions').rows[0];
    expect(row.definition_version).toBeGreaterThanOrEqual(1);
    expect(Number.isInteger(row.definition_version)).toBe(true);
  });
});

/**
 * Phase 5's exit condition (#818), through the writer rather than the
 * planner: two brands with the same problem, one with an integration
 * connected and one without, are given different work.
 */
describe('the task plan the action is created with', () => {
  const taskRows = (writes) =>
    (writes.inserted.find((w) => w.table === 'action_tasks')?.rows ?? []).map(
      (row) => row.task_key,
    );

  /** Task Library acceptance tests 1 and 2: G17 without Search Console gets
   *  no Search Console task; with it, the planner may include one. */
  const underperforming = () =>
    signal({ kind: 'content_underperforming', impact: 'medium', payload: { targets: [] } });

  it('plans a Search Console task for a brand that has Search Console', async () => {
    const writes = mockDb({ signals: [underperforming()] });

    await generateActionsForBrand(BRAND, {
      now: NOW,
      sources: new Set(['tracking', 'search_console']),
    });

    expect(taskRows(writes)).toContain('analyze_gsc_demand');
  });

  it('plans none for a brand that does not', async () => {
    const writes = mockDb({ signals: [underperforming()] });

    await generateActionsForBrand(BRAND, { now: NOW, sources: new Set(['tracking']) });

    expect(taskRows(writes)).not.toContain('analyze_gsc_demand');
    expect(taskRows(writes)).toContain('optimize_content');
  });

  /** Task Library acceptance tests 3 and 4: an existing page is optimised; a
   *  missing one is briefed and drafted — never both. */
  const promptTargets = (mapped) =>
    signal({
      kind: 'prompt_visibility_gap',
      impact: 'medium',
      payload: { targets: [{ id: 'p1', label: 'a prompt', mapped }] },
    });

  it('optimises the page that exists', async () => {
    const writes = mockDb({ signals: [promptTargets(true)] });

    await generateActionsForBrand(BRAND, { now: NOW, sources: ALL_SOURCES });

    expect(taskRows(writes)).toContain('optimize_content');
    expect(taskRows(writes)).not.toContain('create_content_draft');
  });

  it('briefs and drafts the page that does not', async () => {
    const writes = mockDb({ signals: [promptTargets(false)] });

    await generateActionsForBrand(BRAND, { now: NOW, sources: ALL_SOURCES });

    expect(taskRows(writes)).toEqual(
      expect.arrayContaining(['create_content_brief', 'create_content_draft']),
    );
    expect(taskRows(writes)).not.toContain('optimize_content');
  });

  /** Task Library acceptance test 5: no publishing integration does not block
   *  the action — a person publishes. */
  it('gives publishing to a person when no publishing tool exists', async () => {
    const writes = mockDb({ signals: [promptTargets(false)] });

    await generateActionsForBrand(BRAND, { now: NOW, sources: ALL_SOURCES });

    const publish = writes.inserted
      .find((w) => w.table === 'action_tasks')
      .rows.find((row) => row.task_key === 'publish_content');
    expect(publish).toMatchObject({ mode: 'human', permission: 'execute' });
  });

  it('records how each task may be carried out, and what it waits on', async () => {
    const writes = mockDb({ signals: [signal()] });

    await generateActionsForBrand(BRAND, { now: NOW, sources: ALL_SOURCES });

    const rows = writes.inserted.find((w) => w.table === 'action_tasks').rows;
    for (const row of rows) {
      expect(['system', 'agent', 'human', 'human_or_agent']).toContain(row.mode);
      expect(['read', 'write', 'execute']).toContain(row.permission);
      expect(Array.isArray(row.depends_on)).toBe(true);
      expect(row.task_version).toBeGreaterThanOrEqual(1);
    }
    // Positions are contiguous whatever the plan dropped.
    expect(rows.map((row) => row.position)).toEqual(rows.map((_, i) => i + 1));
  });

  it('names the target on a task whose payload resolves one', async () => {
    const writes = mockDb({
      signals: [
        signal({
          kind: 'platform_gap',
          impact: 'medium',
          payload: { platform: 'gemini-web', bestPlatform: 'chatgpt-web' },
        }),
      ],
    });

    await generateActionsForBrand(BRAND, { now: NOW, sources: ALL_SOURCES });

    // "Compare how gemini-web answers…" — the task names what it acts on as a
    // count and an entity, rendered by the web in the reader's language.
    const compare = writes.inserted
      .find((w) => w.table === 'action_tasks')
      .rows.find((row) => row.task_key === 'analyze_platform_gap');
    expect(compare.title_params).toEqual({ count: 1, entity: 'platforms' });
  });
});

/**
 * Phase 6's exit condition (#818): a finding the engine cannot act on yet is
 * not lost. One active action per definition is the right rule, but until now
 * it left a second finding nowhere to go — linked as evidence and then
 * forgotten, because the next cycle was built from whatever happened to be
 * open on the night the slot freed up.
 */
describe('the candidate queue', () => {
  const queueWrites = (writes) => [
    ...writes.inserted.filter((w) => w.table === 'action_candidates'),
    ...writes.updated.filter((w) => w.table === 'action_candidates'),
  ];

  it('queues a finding it cannot act on, instead of only logging it as evidence', async () => {
    const writes = mockDb({
      signals: [signal({ id: 'newcomer' })],
      activeActions: [{ id: 'a1', dedup_key: 'recover_visibility', status: 'in_progress' }],
    });

    const summary = await generateActionsForBrand(BRAND, { now: NOW, sources: ALL_SOURCES });

    expect(summary.created).toBe(0);
    expect(summary.refreshed).toBe(1);
    expect(summary.queued).toBe(1);

    const queued = writes.inserted.find((w) => w.table === 'action_candidates');
    expect(queued.rows[0]).toMatchObject({
      brand_id: BRAND,
      definition_id: 'recover_visibility',
      status: 'waiting',
      signal_ids: ['newcomer'],
    });
  });

  it('promotes what it queued once the slot is free', async () => {
    const writes = mockDb({ signals: [signal()] });

    const summary = await generateActionsForBrand(BRAND, { now: NOW, sources: ALL_SOURCES });

    expect(summary.created).toBe(1);
    expect(writes.inserted.find((w) => w.table === 'actions')).toBeDefined();
    const promoted = writes.updated.filter(
      (w) => w.table === 'action_candidates' && w.patch.status === 'promoted',
    );
    expect(promoted).toHaveLength(1);
    expect(promoted[0].patch.promoted_action_id).toBe('new-actions');
  });

  /**
   * The clock that decides priority. A candidate that has been waiting since
   * last week must not look like one found tonight, or the age term — the
   * only thing stopping a quiet finding starving — never fires.
   */
  it('keeps the date a waiting candidate was first found', async () => {
    const writes = mockDb({
      signals: [signal()],
      candidates: [
        {
          id: 'c1',
          definition_id: 'recover_visibility',
          first_seen_at: daysAgo(9),
          signal_ids: [],
        },
      ],
    });

    await generateActionsForBrand(BRAND, { now: NOW, sources: ALL_SOURCES });

    const refresh = writes.updated.find(
      (w) => w.table === 'action_candidates' && w.patch.status === 'waiting',
    );
    expect(refresh.patch.first_seen_at).toBe(daysAgo(9));
    expect(refresh.patch.last_seen_at).toBe(NOW.toISOString());
  });

  it('does not queue a signal an active action was created from', async () => {
    const writes = mockDb({
      signals: [signal({ action_id: 'a1' })],
      activeActions: [
        {
          id: 'a1',
          dedup_key: 'recover_visibility',
          status: 'new',
          baseline: { signals: [{ id: 's1' }] },
        },
      ],
    });

    const summary = await generateActionsForBrand(BRAND, { now: NOW, sources: ALL_SOURCES });

    expect(summary.queued).toBe(0);
    expect(queueWrites(writes).filter((w) => w.rows || w.patch.status === 'waiting')).toHaveLength(
      0,
    );
  });

  /**
   * A signal linked to an active action after it was created is its evidence,
   * not its scope. It used to leave the queue the night after it was linked
   * and the candidate went stale, so the next cycle never covered it.
   */
  it('keeps a newcomer queued on the nights after it was linked', async () => {
    const writes = mockDb({
      signals: [signal({ id: 'newcomer', action_id: 'a1' })],
      activeActions: [
        {
          id: 'a1',
          dedup_key: 'recover_visibility',
          status: 'in_progress',
          baseline: { signals: [{ id: 'original' }] },
        },
      ],
    });

    const summary = await generateActionsForBrand(BRAND, { now: NOW, sources: ALL_SOURCES });

    expect(summary.queued).toBe(1);
    expect(summary.stale).toBe(0);
    const queued = writes.inserted.find((w) => w.table === 'action_candidates');
    expect(queued.rows[0].signal_ids).toEqual(['newcomer']);
    // Already its evidence: not linked again.
    expect(writes.updated.some((w) => w.table === 'signals')).toBe(false);
  });

  /**
   * Stale rather than deleted: the queue is a record of what the engine found,
   * and a condition that returns should come back with a fresh clock rather
   * than inherit the patience of a finding that ended.
   */
  it('stales a candidate whose signals are gone', async () => {
    const writes = mockDb({
      signals: [],
      candidates: [
        {
          id: 'c1',
          definition_id: 'recover_visibility',
          first_seen_at: daysAgo(3),
          signal_ids: [],
        },
      ],
    });

    const summary = await generateActionsForBrand(BRAND, { now: NOW, sources: ALL_SOURCES });

    expect(summary.stale).toBe(1);
    expect(
      writes.updated.some((w) => w.table === 'action_candidates' && w.patch.status === 'stale'),
    ).toBe(true);
  });

  /** A finding that cannot be acted on for any reason is still recorded as
   *  found — the queue is written before promotion is even considered. */
  it('queues a resting definition rather than dropping the night', async () => {
    const writes = mockDb({
      signals: [signal()],
      closedActions: [
        { dedup_key: 'recover_visibility', completed_at: daysAgo(1), updated_at: daysAgo(1) },
      ],
    });

    const summary = await generateActionsForBrand(BRAND, { now: NOW, sources: ALL_SOURCES });

    expect(summary.created).toBe(0);
    expect(summary.resting).toBe(1);
    expect(summary.queued).toBe(1);
    expect(writes.inserted.find((w) => w.table === 'action_candidates')).toBeDefined();
  });

  it('queues an ineligible definition too', async () => {
    const writes = mockDb({ signals: [signal({ kind: 'page_opportunity', impact: 'medium' })] });

    const summary = await generateActionsForBrand(BRAND, {
      now: NOW,
      sources: new Set(['tracking']),
    });

    expect(summary.created).toBe(0);
    expect(summary.ineligible).toBe(1);
    expect(writes.inserted.find((w) => w.table === 'action_candidates').rows[0]).toMatchObject({
      definition_id: 'capture_ai_traffic',
      status: 'waiting',
    });
  });

  it('scores every candidate it writes', async () => {
    const writes = mockDb({ signals: [signal()] });

    await generateActionsForBrand(BRAND, { now: NOW, sources: ALL_SOURCES });

    const row = writes.inserted.find((w) => w.table === 'action_candidates').rows[0];
    expect(Number.isFinite(row.priority)).toBe(true);
    expect(row.priority).toBeGreaterThan(0);
  });
});

/**
 * AC-006: every action carries a priority score, and the queue is ordered by
 * it. Quantity is not priority — the spec's own example is forty-seven
 * repetitive low-demand signals against one high-demand commercial loss.
 */
describe('the priority score', () => {
  const VOLUMES = [
    ...Array.from({ length: 47 }, (_, i) => ({
      prompt_id: `tail-${i}`,
      est_ai_volume: 5,
      intent: 'what-is',
      fetched_at: NOW.toISOString(),
    })),
    { prompt_id: 'hot', est_ai_volume: 2000, intent: 'comparison', fetched_at: NOW.toISOString() },
  ];

  it('promotes one high-demand commercial loss before forty-seven low-demand gaps', async () => {
    const spent = Array.from({ length: maxNewActionsPerDay - 1 }, (_, i) => ({
      id: `spent-${i}`,
      dedup_key: `unrelated-${i}`,
      status: 'new',
      created_at: NOW.toISOString(),
    }));
    const writes = mockDb({
      signals: [
        // Same impact as the loss, and far more of them.
        ...Array.from({ length: 47 }, (_, i) =>
          signal({
            id: `gap-${i}`,
            kind: 'uncovered_demand',
            impact: 'high',
            payload: { entity: 'prompts', targets: [{ id: `tail-${i}`, volume: 5 }] },
          }),
        ),
        signal({
          id: 'loss',
          kind: 'lost_citations',
          impact: 'high',
          payload: { promptId: 'hot', promptText: 'Best AI rank tracker?' },
        }),
      ],
      activeActions: spent,
      promptVolumes: VOLUMES,
    });

    const summary = await generateActionsForBrand(BRAND, {
      now: NOW,
      sources: new Set([...ALL_SOURCES, 'volumes']),
    });

    expect(summary.created).toBe(1);
    const opened = writes.inserted.find((w) => w.table === 'actions').rows[0];
    expect(opened.kind).toBe('recover_lost_citations');
    expect(opened.priority_reason).toMatchObject({
      change: 'lost',
      demand: 'high',
      commercial: true,
      heldBefore: true,
    });
    // The queue holds the gaps, scored below it.
    const queued = writes.inserted
      .filter((w) => w.table === 'action_candidates')
      .flatMap((w) => w.rows);
    const byDefinition = Object.fromEntries(queued.map((r) => [r.definition_id, r.priority]));
    expect(byDefinition.recover_lost_citations).toBeGreaterThan(
      byDefinition.create_content_for_demand,
    );
  });

  it('works out every active action again from its evidence', async () => {
    const writes = mockDb({
      signals: [
        signal({
          id: 's9',
          action_id: 'a1',
          kind: 'lost_citations',
          source: ['ai_results'],
          detected_at: daysAgo(2),
          payload: { promptId: 'hot' },
        }),
      ],
      activeActions: [
        {
          id: 'a1',
          dedup_key: 'recover_lost_citations',
          status: 'in_progress',
          created_at: daysAgo(5),
          kind: 'recover_lost_citations',
          category: 'recover',
          impact: 'high',
          payload: {},
        },
      ],
      promptVolumes: VOLUMES,
    });

    const summary = await generateActionsForBrand(BRAND, { now: NOW, sources: ALL_SOURCES });

    expect(summary.rescored).toBe(1);
    const patch = writes.updated.find((w) => w.table === 'actions' && 'priority_score' in w.patch);
    expect(patch.patch).toMatchObject({
      priority_level: expect.any(String),
      priority_reason: expect.objectContaining({ change: 'lost', days: 2 }),
    });
    // A priority refresh is not an edit: the action's updated_at stays put.
    expect(patch.patch).not.toHaveProperty('updated_at');
  });

  it('keeps the night going when a priority cannot be saved', async () => {
    mockDb({
      signals: [],
      activeActions: [
        {
          id: 'a1',
          dedup_key: 'recover_lost_citations',
          status: 'new',
          created_at: daysAgo(1),
          kind: 'recover_lost_citations',
          category: 'recover',
          impact: 'high',
          payload: {},
        },
      ],
      failActionUpdates: true,
    });

    const summary = await generateActionsForBrand(BRAND, { now: NOW, sources: ALL_SOURCES });
    expect(summary.rescored).toBe(0);
  });
});
