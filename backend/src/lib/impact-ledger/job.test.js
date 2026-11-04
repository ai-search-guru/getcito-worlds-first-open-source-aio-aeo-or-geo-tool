import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeDb } from './__fixtures__/fakeDb.js';

vi.mock('../../config/supabase.js', () => ({ default: {} }));
vi.mock('../logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('node-cron', () => ({ default: { schedule: vi.fn() } }));

const cron = (await import('node-cron')).default;
const { logger } = await import('../logger.js');
const { SCHEDULE, runImpactLedger, startImpactLedger } = await import('./job.js');
const { addDays, checkAt } = await import('./method.js');

/**
 * The nightly impact ledger job (CHAT-22 §2): what it measures, when, on
 * what, against what, and what it writes, on an in-memory database that
 * gives at most 1000 rows a read, as PostgREST does.
 */

const ORG = '11111111-1111-1111-1111-111111111111';
const OTHER_ORG = '22222222-2222-2222-2222-222222222222';
const SHIPPED = '2026-10-01T15:20:00Z';
const BASELINE = '2026-09-17';
const ids = (prefix, n) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);
const TARGETS = ids('t', 10);
const CONTROLS = ids('c', 20);

const prompt = (id, { brand = 'b1', topic = 'topic-1', active = true } = {}) => ({
  id,
  text: `prompt ${id}`,
  topic_id: topic,
  is_active: active,
  prompt_sets: { brand_id: brand },
});

/** One rollup row a day for each prompt, from `from` for `days` days, named on the first `visible(i)`. */
function track(promptIds, from, days, visible, { brand = 'b1', platform = 'chatgpt-web' } = {}) {
  const rows = [];
  promptIds.forEach((promptId, index) => {
    for (let d = 0; d < days; d++) {
      rows.push({
        brand_id: brand,
        day: addDays(from, d),
        prompt_id: promptId,
        platform,
        model_used: 'gpt-5',
        region: 'US',
        answer_count: 1,
        mentioning_answers: d < visible(index) ? 1 : 0,
        citation_answers: 0,
        has_mention: d < visible(index),
        has_citation: false,
      });
    }
  });
  return rows;
}

/** The targets' AffectedEntity[]. */
const targetsOf = (promptIds) =>
  promptIds.map((id) => ({ type: 'prompt', id, label: `prompt ${id}` }));

function ship(id, overrides = {}) {
  return {
    id,
    organization_id: ORG,
    brand_id: 'b1',
    kind: 'cms_publish',
    change_type: 'content',
    title: `Change ${id}`,
    shipped_at: SHIPPED,
    agent_run_id: null,
    action_id: null,
    content_draft_id: null,
    url: null,
    created_at: '2026-09-01T00:00:00Z',
    ...overrides,
  };
}

function measurement(id, shipId, overrides = {}) {
  return {
    id,
    ship_event_id: shipId,
    targets: targetsOf(TARGETS),
    outcome: 'pending',
    confidence: null,
    checkpoint: null,
    checkpoints_json: [],
    next_check_at: checkAt(SHIPPED, 7),
    ...overrides,
  };
}

/**
 * One brand that shipped one change (an agent run's) on Oct 1, measured on
 * ten prompts against twenty of the same topic. By default the targets go
 * from 4 to 11–12 named days of 14 after ship, the controls from 4 to 4–6.
 */
function world({
  targetAfter = (i) => 11 + (i % 2),
  controlAfter = (i) => 4 + (i % 3),
  controls = CONTROLS,
  postFrom = '2026-10-02',
  postDays = 14,
  platform = 'chatgpt-web',
  ...tables
} = {}) {
  return {
    ship_events: [ship('s1', { agent_run_id: 'run1' })],
    impact_measurements: [measurement('m1', 's1')],
    impact_control_sets: [],
    chat_agent_runs: [
      { id: 'run1', organization_id: ORG, outcome: 'pending', outcome_confidence: null },
    ],
    prompts: [...TARGETS, ...controls].map((id) => prompt(id)),
    organizations: [{ id: ORG, plan: 'growth', subscription_status: 'active', plan_overrides: {} }],
    insights_prompt_daily: [
      ...track([...TARGETS, ...controls], BASELINE, 14, () => 4, { platform }),
      ...track(TARGETS, postFrom, postDays, targetAfter, { platform }),
      ...track(controls, postFrom, postDays, controlAfter, { platform }),
    ],
    ...tables,
  };
}

const at = (iso) => new Date(iso);
const D7 = at('2026-10-09T07:53:00Z');
const D14 = at('2026-10-16T07:53:00Z');

beforeEach(() => {
  process.env.CHAT_AGENTIC = 'true';
  delete process.env.CHAT_AGENTIC_ORGS;
  delete process.env.IS_CLOUD;
  vi.clearAllMocks();
});

afterEach(() => {
  delete process.env.CHAT_AGENTIC;
  delete process.env.CHAT_AGENTIC_ORGS;
  delete process.env.IS_CLOUD;
});

describe('the flag', () => {
  it('reads and writes nothing with CHAT_AGENTIC off', async () => {
    delete process.env.CHAT_AGENTIC;
    const db = fakeDb(world());
    const stats = await runImpactLedger({ db, now: D14 });
    expect(db.calls).toEqual([]);
    expect(stats).toMatchObject({ measured: 0, seeded: 0, failed: 0 });
  });

  it('leaves a workspace CHAT_AGENTIC_ORGS doesn’t list as it is', async () => {
    process.env.CHAT_AGENTIC_ORGS = OTHER_ORG;
    const db = fakeDb(world());
    await runImpactLedger({ db, now: D14 });
    expect(db.calls.filter((c) => c.op !== 'select')).toEqual([]);
    expect(db.calls.map((c) => c.table)).not.toContain('insights_prompt_daily');
    expect(db.tables.impact_measurements[0].checkpoints_json).toEqual([]);
  });
});

describe('seeding', () => {
  it('gives a ship event written elsewhere a Pending measurement on its action’s frozen targets', async () => {
    const db = fakeDb(
      world({
        ship_events: [
          ship('s2', {
            action_id: 'a1',
            url: 'https://acme.example/pricing',
            created_at: '2026-10-12T10:00:00Z',
            shipped_at: '2026-10-12T09:00:00Z',
          }),
        ],
        impact_measurements: [],
        actions: [
          {
            id: 'a1',
            brand_id: 'b1',
            payload: {
              promptIds: ['t0', 't1', 'elsewhere'],
              pages: ['https://acme.example/pricing', 'not a page'],
            },
          },
        ],
        prompts: [prompt('t0'), prompt('t1'), prompt('elsewhere', { brand: 'b2' })],
      }),
    );
    const stats = await runImpactLedger({ db, now: D14 });
    expect(stats.seeded).toBe(1);
    expect(db.tables.impact_measurements).toEqual([
      expect.objectContaining({
        ship_event_id: 's2',
        next_check_at: '2026-10-20T00:00:00.000Z',
        targets: [
          { type: 'prompt', id: 't0', label: 'prompt t0' },
          { type: 'prompt', id: 't1', label: 'prompt t1' },
          {
            type: 'url',
            id: 'https://acme.example/pricing',
            label: 'https://acme.example/pricing',
          },
        ],
      }),
    ]);
  });
});

describe('checkpoints', () => {
  it('shows day 7 as Pending with a direction only, and comes back at day 14', async () => {
    const db = fakeDb(world({ postDays: 7 }));
    const stats = await runImpactLedger({ db, now: D7 });
    expect(stats).toMatchObject({ measured: 1, checkpoints: 1, failed: 0 });
    const row = db.tables.impact_measurements[0];
    expect(row).toMatchObject({
      outcome: 'pending',
      confidence: null,
      checkpoint: 'd7',
      not_measurable_reason: null,
      next_check_at: checkAt(SHIPPED, 14),
      window_json: {
        pre_start: '2026-09-17',
        pre_end: '2026-09-30',
        post_start: '2026-10-02',
        post_end: '2026-10-08',
      },
    });
    expect(row.checkpoints_json).toEqual([
      expect.objectContaining({
        checkpoint: 'd7',
        outcome: 'pending',
        direction: 'up',
        // A direction only: nothing re-randomized or resampled for it.
        p_value: null,
        interval_low: null,
        interval_high: null,
      }),
    ]);
    for (const metric of row.metrics) {
      expect(metric).toMatchObject({ p_value: null, interval_low: null, interval_high: null });
    }
    expect(db.tables.impact_control_sets).toEqual([
      expect.objectContaining({ impact_measurement_id: 'm1', checkpoint: 'd7', cell_count: 20 }),
    ]);
    expect(db.tables.chat_agent_runs[0]).toMatchObject({
      outcome: 'pending',
      outcome_confidence: null,
    });
  });

  it('gives the first verdict at day 14, each checkpoint kept, and the agent run’s outcome', async () => {
    const db = fakeDb(world());
    const stats = await runImpactLedger({ db, now: D14 });
    expect(stats).toMatchObject({ measured: 1, checkpoints: 2, runsUpdated: 1, failed: 0 });
    const row = db.tables.impact_measurements[0];
    expect(row).toMatchObject({
      outcome: 'improved',
      confidence: 'high',
      checkpoint: 'd14',
      next_check_at: checkAt(SHIPPED, 30),
    });
    expect(row.checkpoints_json.map((e) => [e.checkpoint, e.outcome])).toEqual([
      ['d7', 'pending'],
      ['d14', 'improved'],
    ]);
    expect(row.checkpoints_json[1]).toMatchObject({
      metric: 'visibility',
      before: 28.6,
      control_before: 28.6,
      target_cells: 10,
      target_prompts: 10,
      control_cells: 20,
    });
    expect(row.metrics[0]).toMatchObject({ metric: 'visibility', unit: 'pts', before: 28.6 });
    expect(row.metrics[0].effect).toBeGreaterThan(40);
    expect(row.metrics[0].p_value).toBeLessThan(0.05);
    expect(row.metrics[1].metric).toBe('citations');
    expect(db.tables.impact_control_sets.map((c) => c.checkpoint)).toEqual(['d7', 'd14']);
    expect(db.tables.impact_control_sets[1]).toMatchObject({
      cell_count: 20,
      match_rules_json: {
        topic: 'same',
        band_pts: 10,
        strata: 1,
        engines: ['chatgpt-web'],
        min_runs: 3,
      },
    });
    expect(db.tables.impact_control_sets[1].entities[0]).toEqual({
      type: 'prompt',
      id: 'c0',
      platform: 'chatgpt-web',
      region: 'US',
    });
    expect(db.tables.chat_agent_runs[0]).toMatchObject({
      outcome: 'improved',
      outcome_confidence: 'high',
    });
  });

  it('gives No meaningful change when targets and controls rise equally', async () => {
    const db = fakeDb(world({ targetAfter: () => 10, controlAfter: () => 10 }));
    await runImpactLedger({ db, now: D14 });
    expect(db.tables.impact_measurements[0]).toMatchObject({
      outcome: 'no_meaningful_change',
      confidence: 'low',
    });
    expect(db.tables.impact_measurements[0].metrics[0]).toMatchObject({ delta: 42.9, effect: 0 });
  });

  it('keeps day 14 beside a different day 30, and the day 30 result counts', async () => {
    const d14 = { checkpoint: 'd14', outcome: 'improved', confidence: 'high' };
    const db = fakeDb(
      world({
        postFrom: '2026-10-18',
        targetAfter: () => 6,
        controlAfter: () => 6,
        impact_measurements: [
          measurement('m1', 's1', {
            outcome: 'improved',
            confidence: 'high',
            checkpoint: 'd14',
            checkpoints_json: [{ checkpoint: 'd7', outcome: 'pending' }, d14],
            next_check_at: checkAt(SHIPPED, 30),
          }),
        ],
      }),
    );
    await runImpactLedger({ db, now: at('2026-11-01T07:53:00Z') });
    const row = db.tables.impact_measurements[0];
    expect(row).toMatchObject({ outcome: 'no_meaningful_change', checkpoint: 'd30' });
    expect(row.window_json).toMatchObject({ post_start: '2026-10-18', post_end: '2026-10-31' });
    expect(row.checkpoints_json.map((e) => [e.checkpoint, e.outcome])).toEqual([
      ['d7', 'pending'],
      ['d14', 'improved'],
      ['d30', 'no_meaningful_change'],
    ]);
  });

  it('says at day 90 whether the effect held, and stops coming back', async () => {
    const db = fakeDb(
      world({
        postFrom: '2026-12-17',
        impact_measurements: [
          measurement('m1', 's1', {
            outcome: 'improved',
            confidence: 'high',
            checkpoint: 'd30',
            checkpoints_json: [
              { checkpoint: 'd7', outcome: 'pending' },
              { checkpoint: 'd14', outcome: 'improved' },
              { checkpoint: 'd30', outcome: 'improved' },
            ],
            next_check_at: checkAt(SHIPPED, 90),
          }),
        ],
      }),
    );
    await runImpactLedger({ db, now: at('2026-12-31T07:53:00Z') });
    const row = db.tables.impact_measurements[0];
    expect(row).toMatchObject({ outcome: 'improved', checkpoint: 'd90', next_check_at: null });
    expect(row.checkpoints_json.at(-1)).toMatchObject({ checkpoint: 'd90', lasting: 'held' });
  });

  it('measures each checkpoint once, however often it runs', async () => {
    const db = fakeDb(world());
    await runImpactLedger({ db, now: D14 });
    const second = await runImpactLedger({ db, now: D14 });
    expect(second).toMatchObject({ measured: 0, checkpoints: 0 });
    expect(db.tables.impact_control_sets).toHaveLength(2);
  });
});

describe('two instances', () => {
  it('measures a checkpoint on one instance only: the other writes no control set', async () => {
    const db = fakeDb(world());
    const [a, b] = await Promise.all([
      runImpactLedger({ db, now: D14 }),
      runImpactLedger({ db, now: D14 }),
    ]);
    expect(a.measured + b.measured).toBe(1);
    expect(a.checkpoints + b.checkpoints).toBe(2);
    expect(
      db.calls.filter((c) => c.table === 'impact_control_sets' && c.op === 'upsert'),
    ).toHaveLength(1);
    expect(db.tables.impact_measurements[0]).toMatchObject({
      checkpoint: 'd14',
      next_check_at: checkAt(SHIPPED, 30),
    });
  });

  it('leaves a measurement whose run stopped midway due the next night', async () => {
    const db = fakeDb(world());
    db.fail = (table, op) => table === 'impact_control_sets' && op === 'upsert';
    expect(await runImpactLedger({ db, now: D14 })).toMatchObject({ measured: 0, failed: 1 });
    db.fail = null;
    const next = await runImpactLedger({ db, now: at('2026-10-17T07:53:00Z') });
    expect(next.measured).toBe(1);
    expect(db.tables.impact_measurements[0].checkpoint).toBe('d14');
  });
});

describe('not measurable', () => {
  it('says too_few_controls with fewer than 10 control cells, the reason stored', async () => {
    const db = fakeDb(world({ controls: ids('c', 9) }));
    const stats = await runImpactLedger({ db, now: D14 });
    expect(stats.notMeasurable).toBe(1);
    expect(db.tables.impact_measurements[0]).toMatchObject({
      outcome: 'not_measurable',
      confidence: null,
      not_measurable_reason: 'too_few_controls',
    });
    expect(db.tables.impact_control_sets.at(-1)).toMatchObject({
      checkpoint: 'd14',
      cell_count: 9,
    });
    expect(db.tables.chat_agent_runs[0]).toMatchObject({
      outcome: 'not_measurable',
      outcome_confidence: null,
    });
  });

  it('says too_few_prompts from day 14 with fewer than 3 target prompts, day 7 still Pending', async () => {
    const db = fakeDb(
      world({
        impact_measurements: [measurement('m1', 's1', { targets: targetsOf(['t0', 't1']) })],
      }),
    );
    const stats = await runImpactLedger({ db, now: D14 });
    expect(stats.notMeasurable).toBe(1);
    const row = db.tables.impact_measurements[0];
    expect(row).toMatchObject({
      outcome: 'not_measurable',
      confidence: null,
      checkpoint: 'd14',
      not_measurable_reason: 'too_few_prompts',
    });
    expect(row.checkpoints_json[0]).toMatchObject({
      checkpoint: 'd7',
      outcome: 'pending',
      direction: 'up',
    });
    // Its numbers stay; no effect, p-value or interval is given.
    expect(row.metrics[0]).toMatchObject({
      before: 28.6,
      target_prompts: 2,
      effect: null,
      p_value: null,
      interval_low: null,
      interval_high: null,
      direction: null,
    });
    expect(db.tables.chat_agent_runs[0]).toMatchObject({ outcome: 'not_measurable' });
  });

  it('says too_few_runs without tracking data in the window', async () => {
    const db = fakeDb(world({ insights_prompt_daily: [] }));
    await runImpactLedger({ db, now: D14 });
    expect(db.tables.impact_measurements[0]).toMatchObject({
      outcome: 'not_measurable',
      not_measurable_reason: 'too_few_runs',
    });
  });

  it('says too_few_runs when tracking started too short a time before ship', async () => {
    const tables = world();
    tables.insights_prompt_daily = tables.insights_prompt_daily.filter(
      (row) => row.day >= '2026-09-29',
    );
    const db = fakeDb(tables);
    await runImpactLedger({ db, now: D14 });
    expect(db.tables.impact_measurements[0].not_measurable_reason).toBe('too_few_runs');
  });

  it('says engine_not_on_plan when the targets were tracked only on engines off the plan', async () => {
    process.env.IS_CLOUD = 'true';
    const db = fakeDb(
      world({
        platform: 'perplexity-web',
        organizations: [
          { id: ORG, plan: 'starter', subscription_status: 'active', plan_overrides: null },
        ],
      }),
    );
    await runImpactLedger({ db, now: D14 });
    expect(db.tables.impact_measurements[0]).toMatchObject({
      outcome: 'not_measurable',
      not_measurable_reason: 'engine_not_on_plan',
    });
  });

  it('says targets_removed when every target left tracking', async () => {
    const db = fakeDb(world({ prompts: CONTROLS.map((id) => prompt(id)) }));
    await runImpactLedger({ db, now: D14 });
    expect(db.tables.impact_measurements[0].not_measurable_reason).toBe('targets_removed');
  });

  it('says overlapping_change when another change shipped in the window on half the targets', async () => {
    const tables = world();
    tables.ship_events.push(ship('s2', { shipped_at: '2026-10-05T10:00:00Z', title: 'Other' }));
    tables.impact_measurements.push(
      measurement('m2', 's2', {
        targets: targetsOf(TARGETS.slice(0, 5)),
        next_check_at: checkAt('2026-10-05T10:00:00Z', 14),
      }),
    );
    const db = fakeDb(tables);
    await runImpactLedger({ db, now: D14 });
    const row = db.tables.impact_measurements.find((m) => m.id === 'm1');
    expect(row).toMatchObject({
      outcome: 'not_measurable',
      not_measurable_reason: 'overlapping_change',
    });
    expect(row.concurrent_changes).toEqual([
      expect.objectContaining({ type: 'ship_event', id: 's2', shared_targets: 5 }),
    ]);
  });

  it('says overlapping_change when other changes share every target between them', async () => {
    const tables = world();
    const others = [TARGETS.slice(0, 4), TARGETS.slice(4, 8), TARGETS.slice(8)];
    others.forEach((targets, i) => {
      tables.ship_events.push(ship(`o${i}`, { shipped_at: '2026-10-05T10:00:00Z' }));
      tables.impact_measurements.push(
        measurement(`n${i}`, `o${i}`, {
          targets: targetsOf(targets),
          next_check_at: checkAt('2026-10-05T10:00:00Z', 14),
        }),
      );
    });
    const db = fakeDb(tables);
    await runImpactLedger({ db, now: D14 });
    const row = db.tables.impact_measurements.find((m) => m.id === 'm1');
    expect(row.not_measurable_reason).toBe('overlapping_change');
    expect(row.concurrent_changes.map((c) => c.shared_targets)).toEqual([4, 4, 2]);
  });

  it('counts a change whose measurement isn’t seeded on the targets it would be seeded with', async () => {
    const db = fakeDb(
      world({
        ship_events: [
          ship('s1', { agent_run_id: 'run1' }),
          ship('s2', { shipped_at: '2026-10-03T09:00:00Z', action_id: 'a2' }),
        ],
        actions: [{ id: 'a2', brand_id: 'b1', kind: 'content', payload: { promptIds: TARGETS } }],
      }),
    );
    // Tonight's seeding fails: s2 has no measurement when s1 is measured.
    db.fail = (table, op) => table === 'impact_measurements' && op === 'upsert';
    await runImpactLedger({ db, now: D14 });
    const row = db.tables.impact_measurements.find((m) => m.id === 'm1');
    expect(row).toMatchObject({
      outcome: 'not_measurable',
      not_measurable_reason: 'overlapping_change',
    });
    expect(row.concurrent_changes).toEqual([
      expect.objectContaining({ id: 's2', shared_targets: TARGETS.length }),
    ]);
  });

  it('keeps a change’s unseeded prompts out of the controls', async () => {
    const db = fakeDb(
      world({
        ship_events: [
          ship('s1', { agent_run_id: 'run1' }),
          ship('s2', { shipped_at: '2026-10-03T09:00:00Z', action_id: 'a2' }),
        ],
        actions: [
          {
            id: 'a2',
            brand_id: 'b1',
            kind: 'content',
            payload: { promptIds: CONTROLS.slice(0, 15) },
          },
        ],
      }),
    );
    db.fail = (table, op) => table === 'impact_measurements' && op === 'upsert';
    await runImpactLedger({ db, now: D14 });
    const controls = db.tables.impact_control_sets.flatMap((c) => c.entities.map((e) => e.id));
    expect(controls.length).toBeGreaterThan(0);
    for (const id of CONTROLS.slice(0, 15)) expect(controls).not.toContain(id);
  });

  it('measures the targets another change doesn’t share, and names that change', async () => {
    const tables = world();
    tables.ship_events.push(ship('s2', { shipped_at: '2026-10-05T10:00:00Z' }));
    tables.impact_measurements.push(
      measurement('m2', 's2', {
        // Two targets and two controls: the controls leave the control set.
        targets: targetsOf(['t0', 't1', 'c0', 'c1']),
        next_check_at: checkAt('2026-10-05T10:00:00Z', 14),
      }),
    );
    const db = fakeDb(tables);
    await runImpactLedger({ db, now: D14 });
    const row = db.tables.impact_measurements.find((m) => m.id === 'm1');
    expect(row.outcome).toBe('improved');
    expect(row.checkpoints_json.at(-1)).toMatchObject({ target_cells: 8, control_cells: 18 });
    expect(row.concurrent_changes).toEqual([
      expect.objectContaining({ id: 's2', shared_targets: 2 }),
    ]);
    const controls = db.tables.impact_control_sets.find(
      (c) => c.impact_measurement_id === 'm1' && c.checkpoint === 'd14',
    );
    expect(controls.entities.map((e) => e.id)).not.toContain('c0');
  });

  it('never reads a workspace without an active plan: its measurement stays due', async () => {
    process.env.IS_CLOUD = 'true';
    const db = fakeDb(
      world({
        organizations: [
          { id: ORG, plan: 'growth', subscription_status: 'canceled', plan_overrides: null },
        ],
      }),
    );
    const stats = await runImpactLedger({ db, now: D14 });
    expect(stats).toMatchObject({ measured: 0, closed: 0 });
    expect(db.calls.map((c) => c.table)).not.toContain('insights_prompt_daily');
    expect(db.tables.impact_measurements[0].next_check_at).toBe(checkAt(SHIPPED, 7));
  });

  it('closes what stays open 30 days past day 90 for a workspace that can’t be measured', async () => {
    process.env.IS_CLOUD = 'true';
    process.env.CHAT_AGENTIC_ORGS = `${ORG},${OTHER_ORG}`;
    const LONG_AGO = '2026-06-01T10:00:00Z';
    const THIRD_ORG = '33333333-3333-3333-3333-333333333333';
    const db = fakeDb(
      world({
        organizations: [
          { id: ORG, plan: 'growth', subscription_status: 'canceled', plan_overrides: null },
          { id: OTHER_ORG, plan: 'growth', subscription_status: 'active', plan_overrides: null },
          { id: THIRD_ORG, plan: 'growth', subscription_status: 'active', plan_overrides: null },
        ],
        ship_events: [
          ship('s1', { shipped_at: LONG_AGO }),
          ship('s2', { shipped_at: LONG_AGO, organization_id: THIRD_ORG, brand_id: 'b3' }),
          ship('s3', { shipped_at: '2026-09-20T10:00:00Z' }),
        ],
        impact_measurements: [
          measurement('m1', 's1', { next_check_at: checkAt(LONG_AGO, 30) }),
          measurement('m2', 's2', { next_check_at: checkAt(LONG_AGO, 30) }),
          measurement('m3', 's3', { next_check_at: checkAt('2026-09-20T10:00:00Z', 7) }),
        ],
      }),
    );
    const stats = await runImpactLedger({ db, now: D14 });
    expect(stats.closed).toBe(1);
    const [m1, m2, m3] = db.tables.impact_measurements;
    // No active plan: closed, day 90 kept as that.
    for (const [row, reason] of [[m1, 'plan_inactive']]) {
      expect(row).toMatchObject({
        outcome: 'not_measurable',
        confidence: null,
        not_measurable_reason: reason,
        checkpoint: 'd90',
        next_check_at: null,
        metrics: [],
      });
      expect(row.checkpoints_json).toEqual([
        expect.objectContaining({
          checkpoint: 'd90',
          outcome: 'not_measurable',
          not_measurable_reason: reason,
          lasting: null,
          effect: null,
          p_value: null,
        }),
      ]);
    }
    // Chat no longer on for the workspace (CHAT_AGENTIC_ORGS): kept open.
    expect(m2).toMatchObject({ outcome: 'pending', next_check_at: checkAt(LONG_AGO, 30) });
    // Shipped lately: kept due, for when the plan comes back.
    expect(m3).toMatchObject({
      outcome: 'pending',
      next_check_at: checkAt('2026-09-20T10:00:00Z', 7),
    });
  });
});

describe('closing while Chat is off for a workspace', () => {
  const LONG_AGO = '2026-06-01T10:00:00Z';
  const d30 = { checkpoint: 'd30', outcome: 'improved', confidence: 'medium' };
  const stale = () =>
    world({
      ship_events: [ship('s1', { shipped_at: LONG_AGO })],
      impact_measurements: [
        measurement('m1', 's1', {
          checkpoint: 'd30',
          outcome: 'improved',
          confidence: 'medium',
          checkpoints_json: [{ checkpoint: 'd7', outcome: 'pending' }, d30],
          next_check_at: checkAt(LONG_AGO, 90),
        }),
      ],
    });

  for (const cloud of [false, true]) {
    it(`keeps it open through a night CHAT_AGENTIC_ORGS leaves it out (${cloud ? 'cloud' : 'self-hosted'}), and reads day 90 once it is back`, async () => {
      if (cloud) process.env.IS_CLOUD = 'true';
      const db = fakeDb(stale());
      // A deploy that drops the workspace for a night.
      process.env.CHAT_AGENTIC_ORGS = OTHER_ORG;
      const off = await runImpactLedger({ db, now: D14 });
      expect(off).toMatchObject({ closed: 0, measured: 0 });
      expect(db.tables.impact_measurements[0]).toMatchObject({
        outcome: 'improved',
        next_check_at: checkAt(LONG_AGO, 90),
      });
      // Back on the next night: day 90 is read, late, and the earlier checkpoints stay.
      process.env.CHAT_AGENTIC_ORGS = ORG;
      const on = await runImpactLedger({ db, now: at('2026-10-17T07:53:00Z') });
      expect(on).toMatchObject({ measured: 1, closed: 0 });
      const [row] = db.tables.impact_measurements;
      expect(row).toMatchObject({ checkpoint: 'd90', next_check_at: null });
      expect(row.checkpoints_json.map((e) => e.checkpoint)).toEqual(['d7', 'd30', 'd90']);
    });
  }
});

describe('sends confirmed without a ship event', () => {
  const send = (id, overrides = {}) => ({
    id,
    organization_id: ORG,
    brand_id: 'b1',
    draft_id: null,
    sent_by: 'u1',
    title: `Send ${id}`,
    status: 'published',
    published_url: `https://acme.example/${id}`,
    published_at: '2026-10-14T10:00:00.000Z',
    created_at: '2026-10-14T09:00:00.000Z',
    ...overrides,
  });

  it('writes the ship event a confirmed send is missing, once, through the same upsert', async () => {
    const db = fakeDb(
      world({
        content_draft_deliveries: [
          send('x1'),
          // Its ship event was written when it was confirmed.
          send('x2'),
          // Still waiting on its CMS, or confirmed too long ago.
          send('x3', { status: 'sent', published_at: null }),
          send('x4', { published_at: '2026-08-01T10:00:00.000Z' }),
        ],
        ship_events: [
          ship('s1', { agent_run_id: 'run1' }),
          ship('s2', { content_draft_delivery_id: 'x2', shipped_at: '2026-10-14T10:00:00.000Z' }),
        ],
      }),
    );
    const stats = await runImpactLedger({ db, now: D14 });
    expect(stats.filled).toBe(1);
    const written = db.tables.ship_events.filter((e) => e.content_draft_delivery_id === 'x1');
    expect(written).toEqual([
      expect.objectContaining({
        kind: 'cms_publish',
        url: 'https://acme.example/x1',
        shipped_at: '2026-10-14T10:00:00.000Z',
      }),
    ]);
    expect(db.tables.impact_measurements.some((m) => m.ship_event_id === written[0].id)).toBe(true);

    // The next night finds it written.
    const next = await runImpactLedger({ db, now: at('2026-10-17T07:53:00Z') });
    expect(next.filled).toBe(0);
    expect(db.tables.ship_events.filter((e) => e.content_draft_delivery_id === 'x1')).toHaveLength(
      1,
    );
  });
});

describe('sends confirmed without a ship event, in order', () => {
  const draftSend = (id, publishedAt) => ({
    id,
    organization_id: ORG,
    brand_id: 'b1',
    draft_id: 'dr1',
    sent_by: 'u1',
    title: 'Guide',
    status: 'published',
    published_url: 'https://acme.example/guide',
    published_at: publishedAt,
    created_at: publishedAt,
  });
  const T1 = '2026-10-10T10:00:00.000Z';
  const T2 = '2026-10-13T10:00:00.000Z';

  it('takes a draft’s sends oldest first: its ship event is its first publish', async () => {
    // The later send's id sorts first.
    const db = fakeDb(
      world({
        content_draft_deliveries: [draftSend('a-later', T2), draftSend('b-earlier', T1)],
        content_drafts: [
          { id: 'dr1', brand_id: 'b1', title: 'Guide', action_id: null, prompt_ids: [] },
        ],
      }),
    );
    const stats = await runImpactLedger({ db, now: D14 });
    expect(stats.filled).toBe(1);
    const shipped = db.tables.ship_events.filter((e) => e.content_draft_id === 'dr1');
    expect(shipped).toEqual([
      expect.objectContaining({
        content_draft_delivery_id: 'b-earlier',
        shipped_at: T1,
        republished_at: T2,
      }),
    ]);

    // The later send, noted on the first, is read again each night but writes nothing.
    const next = await runImpactLedger({ db, now: at('2026-10-17T07:53:00Z') });
    expect(next).toMatchObject({ filled: 0, failed: 0 });
    expect(db.tables.ship_events.filter((e) => e.content_draft_id === 'dr1')).toHaveLength(1);
  });

  it('leaves a send noted on its draft’s first ship event alone the next nights', async () => {
    const db = fakeDb(
      world({
        content_draft_deliveries: [draftSend('b-earlier', T1), draftSend('a-later', T2)],
        content_drafts: [
          { id: 'dr1', brand_id: 'b1', title: 'Guide', action_id: null, prompt_ids: [] },
        ],
      }),
    );
    await runImpactLedger({ db, now: D14 });
    expect(db.tables.ship_events.find((e) => e.content_draft_id === 'dr1')).toMatchObject({
      content_draft_delivery_id: 'b-earlier',
      republished_delivery_ids: ['a-later'],
    });
    db.calls.length = 0;
    const next = await runImpactLedger({ db, now: at('2026-10-17T07:53:00Z') });
    expect(next).toMatchObject({ filled: 0, failed: 0 });
    expect(db.calls.filter((c) => c.op === 'rpc' || c.table === 'content_drafts')).toEqual([]);
  });

  it('leaves a send past the 50 noted by id alone once its date is noted', async () => {
    const noted = Array.from({ length: 50 }, (_, i) => `n${i}`);
    const db = fakeDb(
      world({
        content_draft_deliveries: [draftSend('late', T2)],
        content_drafts: [
          { id: 'dr1', brand_id: 'b1', title: 'Guide', action_id: null, prompt_ids: [] },
        ],
        ship_events: [
          ship('s1', { agent_run_id: 'run1' }),
          ship('s9', {
            content_draft_id: 'dr1',
            content_draft_delivery_id: 'first',
            shipped_at: T1,
            republished_at: T2,
            republished_delivery_ids: noted,
          }),
        ],
      }),
    );
    const stats = await runImpactLedger({ db, now: D14 });
    expect(stats).toMatchObject({ filled: 0, failed: 0 });
    expect(
      db.calls.filter((c) => c.op === 'rpc' || c.table === 'content_draft_deliveries'),
    ).toEqual([expect.objectContaining({ table: 'content_draft_deliveries', op: 'select' })]);
  });

  it('still notes a send past the 50 whose date isn’t noted yet', async () => {
    const noted = Array.from({ length: 50 }, (_, i) => `n${i}`);
    const db = fakeDb(
      world({
        content_draft_deliveries: [draftSend('late', T2)],
        content_drafts: [
          { id: 'dr1', brand_id: 'b1', title: 'Guide', action_id: null, prompt_ids: [] },
        ],
        ship_events: [
          ship('s1', { agent_run_id: 'run1' }),
          ship('s9', {
            content_draft_id: 'dr1',
            content_draft_delivery_id: 'first',
            shipped_at: T1,
            republished_at: null,
            republished_delivery_ids: noted,
          }),
        ],
      }),
    );
    await runImpactLedger({ db, now: D14 });
    expect(db.tables.ship_events.find((e) => e.id === 's9').republished_at).toBe(T2);
  });

  it('takes an older send filled in late into its draft’s later ship event, not a second one', async () => {
    // The later send's write went through; the earlier one's failed.
    const db = fakeDb(
      world({
        content_draft_deliveries: [draftSend('b-earlier', T1)],
        content_drafts: [
          { id: 'dr1', brand_id: 'b1', title: 'Guide', action_id: null, prompt_ids: [] },
        ],
        ship_events: [
          ship('s1', { agent_run_id: 'run1' }),
          ship('s9', {
            content_draft_id: 'dr1',
            content_draft_delivery_id: 'a-later',
            shipped_at: T2,
          }),
          // A cms_publish of the draft more than 90 days after it: another episode.
          ship('s10', {
            content_draft_id: 'dr1',
            content_draft_delivery_id: 'much-later',
            shipped_at: '2027-01-20T10:00:00.000Z',
          }),
        ],
      }),
    );
    await runImpactLedger({ db, now: D14 });
    const ofDraft = db.tables.ship_events.filter((e) => e.content_draft_id === 'dr1');
    expect(ofDraft).toHaveLength(2);
    expect(ofDraft.find((e) => e.id === 's9')).toMatchObject({
      shipped_at: T2,
      republished_delivery_ids: ['b-earlier'],
    });
  });

  it('leaves a send noted on a ship event alone once its draft is deleted', async () => {
    // The draft is gone: its sends' and its ship event's draft ids are null.
    const db = fakeDb(
      world({
        content_draft_deliveries: [
          { ...draftSend('b-earlier', T1), draft_id: null },
          { ...draftSend('a-later', T2), draft_id: null },
        ],
        ship_events: [
          ship('s1', { agent_run_id: 'run1' }),
          ship('s9', {
            content_draft_id: null,
            content_draft_delivery_id: 'b-earlier',
            shipped_at: T1,
            republished_at: T2,
            republished_delivery_ids: ['a-later'],
          }),
        ],
      }),
    );
    const stats = await runImpactLedger({ db, now: D14 });
    expect(stats).toMatchObject({ filled: 0, failed: 0 });
    expect(db.calls.filter((c) => c.op === 'rpc')).toEqual([]);
    expect(db.tables.ship_events.filter((e) => e.kind === 'cms_publish' && e.id !== 's1')).toEqual([
      expect.objectContaining({ id: 's9' }),
    ]);
  });

  it('counts a send whose ship event can’t be written as failed', async () => {
    const db = fakeDb(world({ content_draft_deliveries: [draftSend('x1', T1)] }));
    db.fail = (table, op) => table === 'ship_events' && op === 'rpc';
    const stats = await runImpactLedger({ db, now: D14 });
    expect(stats).toMatchObject({ filled: 0, failed: 1 });
  });
});

describe('agent runs', () => {
  it('writes a run’s outcome only within its own workspace', async () => {
    const db = fakeDb(
      world({
        chat_agent_runs: [
          { id: 'run1', organization_id: OTHER_ORG, outcome: 'pending', outcome_confidence: null },
        ],
      }),
    );
    const stats = await runImpactLedger({ db, now: D14 });
    expect(stats.runsUpdated).toBe(0);
    expect(db.tables.chat_agent_runs[0].outcome).toBe('pending');
  });

  it('makes a run’s write that failed again the next night', async () => {
    const db = fakeDb(world());
    db.fail = (table, op) => table === 'chat_agent_runs' && op === 'update';
    const first = await runImpactLedger({ db, now: D14 });
    expect(first).toMatchObject({ measured: 1, runsUpdated: 0, failed: 1 });
    expect(db.tables.chat_agent_runs[0].outcome).toBe('pending');

    db.fail = null;
    const next = await runImpactLedger({ db, now: at('2026-10-17T07:53:00Z') });
    expect(next).toMatchObject({ measured: 0, runsUpdated: 1, failed: 0 });
    expect(db.tables.chat_agent_runs[0]).toMatchObject({
      outcome: 'improved',
      outcome_confidence: 'high',
    });
  });
});

describe('scale and isolation', () => {
  it('reads past 1000 rows a page at a time, never more in one read', async () => {
    const targets = ids('t', 40);
    const controls = ids('c', 60);
    const db = fakeDb(
      world({
        controls,
        prompts: [...targets, ...controls].map((id) => prompt(id)),
        impact_measurements: [measurement('m1', 's1', { targets: targetsOf(targets) })],
        insights_prompt_daily: [
          ...track([...targets, ...controls], BASELINE, 14, () => 4),
          ...track(targets, '2026-10-02', 14, (i) => 11 + (i % 2)),
          ...track(controls, '2026-10-02', 14, (i) => 4 + (i % 3)),
        ],
      }),
    );
    // 100 prompts × 14 days: 1,400 rows in each window.
    await runImpactLedger({ db, now: D14 });
    expect(db.maxRead).toBe(1000);
    const row = db.tables.impact_measurements[0];
    expect(row.outcome).toBe('improved');
    expect(row.checkpoints_json.at(-1)).toMatchObject({ target_cells: 40, control_cells: 60 });
  });

  it('reads a window again for the next measurement after a read of it failed', async () => {
    const U = ids('u', 10);
    const base = world();
    const db = fakeDb({
      ...base,
      ship_events: [ship('s1', { agent_run_id: 'run1' }), ship('s2')],
      impact_measurements: [
        measurement('m1', 's1'),
        measurement('m2', 's2', { targets: targetsOf(U) }),
      ],
      prompts: [...base.prompts, ...U.map((id) => prompt(id))],
      insights_prompt_daily: [
        ...base.insights_prompt_daily,
        ...track(U, BASELINE, 14, () => 4),
        ...track(U, '2026-10-02', 14, (i) => 11 + (i % 2)),
      ],
    });
    let reads = 0;
    db.fail = (table, op) => table === 'insights_prompt_daily' && op === 'select' && reads++ === 0;
    const stats = await runImpactLedger({ db, now: D7 });
    // The first measurement's read failed; the second reads the same window again.
    expect(stats).toMatchObject({ failed: 1, measured: 1 });
  });

  it('counts a brand that fails and goes on with the next', async () => {
    const tables = world();
    tables.ship_events.push(ship('s9', { brand_id: 'b2' }));
    tables.impact_measurements.push(measurement('m9', 's9'));
    tables.prompts.push(...[...TARGETS, ...CONTROLS].map((id) => prompt(`${id}`, { brand: 'b2' })));
    tables.insights_prompt_daily.push(
      ...tables.insights_prompt_daily.map((row) => ({ ...row, brand_id: 'b2' })),
    );
    const db = fakeDb(tables);
    let promptReads = 0;
    db.fail = (table) => table === 'prompts' && promptReads++ === 0;
    const stats = await runImpactLedger({ db, now: D14 });
    expect(stats).toMatchObject({ failed: 1, brands: 1, measured: 1 });
    expect(db.tables.impact_measurements.find((m) => m.id === 'm1').checkpoints_json).toEqual([]);
    expect(db.tables.impact_measurements.find((m) => m.id === 'm9').outcome).toBe('improved');
    // The log names what failed by code, never a customer's data.
    expect(logger.error).toHaveBeenCalledWith(
      { err: { name: 'ImpactDbError', code: '57014' } },
      '[impact-ledger] brand failed',
    );
  });

  it('never writes a usage_ledger row or asks a model: tracking data only', async () => {
    const db = fakeDb(world());
    await runImpactLedger({ db, now: D14 });
    const tables = new Set(db.calls.map((c) => c.table));
    expect(tables.has('usage_ledger')).toBe(false);
    expect([...tables].sort()).toEqual([
      'chat_agent_runs',
      'content_draft_deliveries',
      'impact_control_sets',
      'impact_measurements',
      'insights_prompt_daily',
      'prompts',
      'ship_events',
    ]);
  });

  it('logs counts only', async () => {
    const db = fakeDb(world());
    await runImpactLedger({ db, now: D14 });
    const [fields, message] = logger.info.mock.calls.at(-1);
    expect(message).toBe('[impact-ledger] run done');
    expect(Object.values(fields).every((v) => typeof v === 'number' || /^\d{4}-/.test(v))).toBe(
      true,
    );
  });
});

describe('startImpactLedger', () => {
  it('schedules the nightly run, and skips a tick while one is still going', async () => {
    let finish;
    const run = vi
      .fn()
      .mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)))
      .mockResolvedValue(undefined);
    startImpactLedger({ run });
    expect(cron.schedule).toHaveBeenCalledWith(SCHEDULE, expect.any(Function));
    const tick = cron.schedule.mock.calls[0][1];
    const first = tick();
    await tick();
    expect(run).toHaveBeenCalledTimes(1);
    finish();
    await first;
    await tick();
    expect(run).toHaveBeenCalledTimes(2);
  });
});
