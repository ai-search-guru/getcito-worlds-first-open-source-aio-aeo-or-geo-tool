import { describe, expect, it } from 'vitest';
import {
  BAND_PTS,
  CHECKPOINTS,
  MAX_CONTROL_CELLS,
  MIN_CONTROL_CELLS,
  MIN_CONTROL_PROMPTS,
  addDays,
  aggregateCells,
  checkAt,
  checkpointEntry,
  checkpointWindow,
  confidenceOf,
  directionOf,
  dueCheckpoints,
  engineOnPlan,
  lastingOf,
  matchControls,
  measureCells,
  metricResult,
  MIN_BOOTSTRAP_SHARE,
  nextCheckAt,
  P_VERDICT,
  primaryMetric,
  runOutcome,
  seededRandom,
  verdictOf,
  withoutVerdict,
} from './method.js';

/**
 * The impact ledger's method (CHAT-22 §2 items 6–11): the windows, the
 * cells, the controls, the effect and its uncertainty, and the one outcome
 * vocabulary, without a database.
 */

const SHIPPED = '2026-10-01T15:20:00Z';
const STARTER = { allowedScrapers: ['chatgpt-web', 'copilot-web'], allowedModels: [] };
const ALL = {};

/** Rollup rows of one cell: `visible` of its `days` days from `from` named, the rest not. */
function cellRows(prompt, from, days, visible, { platform = 'chatgpt-web', region = 'US' } = {}) {
  return Array.from({ length: days }, (_, i) => ({
    day: addDays(from, i),
    prompt_id: prompt,
    platform,
    model_used: platform === 'claude' ? 'claude-sonnet-5' : 'gpt-5',
    region,
    answer_count: 1,
    mentioning_answers: i < visible ? 1 : 0,
    citation_answers: 0,
    has_mention: i < visible,
    has_citation: false,
  }));
}

/** Pre and post cells for prompts, each given [visible before, visible after] of 14 days. */
function windows(levels) {
  const pre = [];
  const post = [];
  for (const [prompt, [before, after], options] of levels) {
    pre.push(...cellRows(prompt, '2026-09-17', 14, before, options));
    post.push(...cellRows(prompt, '2026-10-02', 14, after, options));
  }
  return { pre: aggregateCells(pre, ALL), post: aggregateCells(post, ALL) };
}

const promptsOf = (ids, topic = 't1') =>
  new Map(ids.map((id) => [id, { topic_id: topic, is_active: true }]));

/**
 * A small brand of the calibration and power tests: engines with their own
 * levels and their own swing between the windows (engine weather), prompts
 * at random levels, `lift` added to the targets' chance of being named
 * after ship (0: the change did nothing). With `orphan`, one more target is
 * tracked only on an engine no control is on. Seeded.
 */
function world(
  seed,
  { kind, targets: t = 3, controls: c = 12, engines: e = 5, lift = 0, orphan = false },
) {
  const random = seededRandom(`${kind}-world:${seed}`);
  const engines = Array.from({ length: e }, (_, i) => `engine-${i}`);
  const swing = engines.map(() => (random() - 0.5) * 0.4);
  const offset = engines.map(() => (random() - 0.5) * 0.3);
  const targets = Array.from({ length: t }, (_, i) => `t${i}`);
  const controls = Array.from({ length: c }, (_, i) => `c${i}`);
  const clamp = (p) => Math.min(0.97, Math.max(0.03, p));
  const days = (p) => {
    let named = 0;
    for (let d = 0; d < 14; d++) if (random() < p) named++;
    return named;
  };
  const pre = [];
  const post = [];
  for (const id of [...targets, ...controls]) {
    const level = 0.05 + random() * 0.85;
    const own = targets.includes(id) ? lift : 0;
    engines.forEach((platform, i) => {
      const before = clamp(level + offset[i]);
      pre.push(...cellRows(id, '2026-09-17', 14, days(before), { platform }));
      post.push(
        ...cellRows(id, '2026-10-02', 14, days(clamp(before + swing[i] + own)), { platform }),
      );
    });
  }
  if (orphan) {
    const level = 0.05 + random() * 0.85;
    const platform = 'engine-targets-only';
    pre.push(...cellRows('t-orphan', '2026-09-17', 14, days(level), { platform }));
    post.push(...cellRows('t-orphan', '2026-10-02', 14, days(level), { platform }));
    targets.push('t-orphan');
  }
  return measureCells({
    seed: `${kind}-world:${seed}`,
    primary: 'visibility',
    targetIds: targets,
    pre: aggregateCells(pre, ALL),
    post: aggregateCells(post, ALL),
    excluded: new Set(targets),
    prompts: promptsOf([...targets, ...controls]),
  });
}

/** Of `count` seeded worlds: how many could be measured, and how many gave each outcome. */
function outcomes(count, options) {
  const tally = { measurable: 0, improved: 0, declined: 0 };
  for (let seed = 0; seed < count; seed++) {
    const entry = checkpointEntry({
      cp: CHECKPOINTS[1],
      window: checkpointWindow(SHIPPED, 14),
      result: world(seed, options),
      earlier: [],
      measuredAt: '2026-10-16T07:53:00Z',
    });
    if (entry.outcome === 'not_measurable') continue;
    tally.measurable++;
    if (entry.outcome === 'improved') tally.improved++;
    if (entry.outcome === 'declined') tally.declined++;
  }
  return tally;
}

describe('windows and checkpoints', () => {
  it('reads the 14 days before ship against the latest 14 days ending on the checkpoint', () => {
    expect(checkpointWindow(SHIPPED, 7)).toEqual({
      pre_start: '2026-09-17',
      pre_end: '2026-09-30',
      post_start: '2026-10-02',
      post_end: '2026-10-08',
    });
    expect(checkpointWindow(SHIPPED, 14)).toMatchObject({
      post_start: '2026-10-02',
      post_end: '2026-10-15',
    });
    // Day 30: days 17–30; day 90: days 77–90.
    expect(checkpointWindow(SHIPPED, 30)).toMatchObject({
      post_start: '2026-10-18',
      post_end: '2026-10-31',
    });
    expect(checkpointWindow(SHIPPED, 90)).toMatchObject({
      post_start: '2026-12-17',
      post_end: '2026-12-30',
    });
  });

  it('is due the morning after a checkpoint’s last day, one checkpoint after another', () => {
    expect(checkAt(SHIPPED, 7)).toBe('2026-10-09T00:00:00.000Z');
    expect(dueCheckpoints([], SHIPPED, new Date('2026-10-08T23:59:00Z'))).toEqual([]);
    expect(dueCheckpoints([], SHIPPED, new Date('2026-10-09T07:53:00Z'))).toEqual([CHECKPOINTS[0]]);
    // Day 14 isn't read before its own day is over.
    expect(
      dueCheckpoints([{ checkpoint: 'd7' }], SHIPPED, new Date('2026-10-15T12:00:00Z')),
    ).toEqual([]);
    expect(
      dueCheckpoints([{ checkpoint: 'd7' }], SHIPPED, new Date('2026-10-16T07:53:00Z')),
    ).toEqual([CHECKPOINTS[1]]);
  });

  it('reads every checkpoint passed when a change is measured late, and none twice', () => {
    expect(
      dueCheckpoints([], SHIPPED, new Date('2026-10-20T07:53:00Z')).map((cp) => cp.key),
    ).toEqual(['d7', 'd14']);
    expect(
      dueCheckpoints(
        [{ checkpoint: 'd7' }, { checkpoint: 'd14' }],
        SHIPPED,
        new Date('2027-02-01T00:00:00Z'),
      ).map((cp) => cp.key),
    ).toEqual(['d30', 'd90']);
  });

  it('comes back at the next checkpoint, and not after day 90', () => {
    expect(nextCheckAt(SHIPPED, 'd7')).toBe(checkAt(SHIPPED, 14));
    expect(nextCheckAt(SHIPPED, 'd14')).toBe(checkAt(SHIPPED, 30));
    expect(nextCheckAt(SHIPPED, 'd30')).toBe(checkAt(SHIPPED, 90));
    expect(nextCheckAt(SHIPPED, 'd90')).toBeNull();
  });
});

describe('cells', () => {
  it('counts each tracked day once, as the share of its answers naming or citing the brand', () => {
    const rows = [
      ...cellRows('p1', '2026-09-17', 5, 2),
      // A second row the same day (the model changed mid-day, or a run by
      // hand): still one run, its answers added — 1 of 2 named, 1 of 2 cited.
      {
        ...cellRows('p1', '2026-09-19', 1, 0)[0],
        model_used: 'gpt-5.1',
        mentioning_answers: 1,
        citation_answers: 1,
        has_citation: true,
      },
    ];
    const { cells } = aggregateCells(rows, ALL);
    expect([...cells.values()]).toEqual([
      { promptId: 'p1', platform: 'chatgpt-web', region: 'US', runs: 5, visible: 2.5, cited: 0.5 },
    ]);
  });

  it('reads a row written before its answers were counted (00130) by the day’s flags', () => {
    const [row] = cellRows('p1', '2026-09-17', 1, 0);
    const old = {
      ...row,
      answer_count: 3,
      mentioning_answers: null,
      citation_answers: null,
      has_citation: true,
    };
    const { cells } = aggregateCells([old], ALL);
    expect([...cells.values()][0]).toMatchObject({ runs: 1, visible: 1, cited: 1 });
  });

  it('keeps only the plan’s engines, and says which prompts had answers only off it', () => {
    const rows = [
      ...cellRows('p1', '2026-09-17', 3, 1, { platform: 'perplexity-web' }),
      ...cellRows('p2', '2026-09-17', 3, 1, { platform: 'claude' }),
      ...cellRows('p2', '2026-09-17', 3, 1),
    ];
    const starter = aggregateCells(rows, STARTER);
    expect([...starter.cells.keys()]).toEqual(['p2|chatgpt-web|US']);
    expect([...starter.offPlan]).toEqual(['p1']);
    expect(aggregateCells(rows, ALL).cells.size).toBe(3);
  });

  it('reads API models only when the plan lists them', () => {
    const row = { platform: 'claude', model_used: 'claude-sonnet-5' };
    expect(engineOnPlan({ allowedModels: [] }, row)).toBe(false);
    expect(engineOnPlan({ allowedModels: ['claude-sonnet-5'] }, row)).toBe(true);
    expect(engineOnPlan({}, row)).toBe(true);
    expect(engineOnPlan(STARTER, { platform: 'copilot-web' })).toBe(true);
    expect(engineOnPlan(STARTER, { platform: 'google-aio' })).toBe(false);
  });
});

describe('control set', () => {
  const cell = (promptId, visible, { platform = 'chatgpt-web', region = 'US' } = {}) => ({
    promptId,
    platform,
    region,
    runs: 14,
    visible,
    cited: 0,
  });
  const candidate = (id, visible, options) => ({
    key: `${id}|${options?.platform ?? 'chatgpt-web'}|US`,
    pre: cell(id, visible, options),
    post: cell(id, visible, options),
  });
  // 7 of 14 days: 50%, the 50–59.9 band.
  const targets = [{ key: 't|chatgpt-web|US', pre: cell('t', 7) }];

  it('takes control cells in a target cell’s stratum (engine, location, band), the same topic first', () => {
    const topics = new Map();
    const candidates = [];
    for (let i = 0; i < 12; i++) {
      candidates.push(candidate(`same${i}`, 7));
      topics.set(`same${i}`, 't1');
    }
    // 6 of 14 days: 42.9%, the band below.
    candidates.push(candidate('band-below', 6));
    topics.set('band-below', 't1');
    candidates.push(candidate('other-topic', 7));
    topics.set('other-topic', 't2');
    candidates.push(candidate('other-engine', 7, { platform: 'perplexity-web' }));
    topics.set('other-engine', 't1');

    const { cells, rules } = matchControls({
      targets,
      candidates,
      targetTopics: new Set(['t1']),
      topicOf: (id) => topics.get(id),
    });
    expect(cells.map((c) => c.pre.promptId).sort()).toEqual(
      Array.from({ length: 12 }, (_, i) => `same${i}`).sort(),
    );
    expect(rules).toEqual({
      topic: 'same',
      band_pts: BAND_PTS,
      strata: 1,
      engines: ['chatgpt-web'],
      min_runs: 3,
    });
  });

  it('adds other topics when the same topic leaves a target stratum without controls', () => {
    const two = [...targets, { key: 'u|chatgpt-web|US', pre: cell('u', 3) }];
    const topics = new Map();
    const candidates = [];
    for (let i = 0; i < 12; i++) {
      candidates.push(candidate(`same${i}`, 7));
      topics.set(`same${i}`, 't1');
    }
    for (let i = 0; i < 3; i++) candidates.push(candidate(`low${i}`, 3));
    const { cells, rules } = matchControls({
      targets: two,
      candidates,
      targetTopics: new Set(['t1']),
      topicOf: (id) => topics.get(id) ?? null,
    });
    expect(cells).toHaveLength(15);
    expect(cells[0].sameTopic).toBe(true);
    expect(rules).toMatchObject({ topic: 'same_then_any', strata: 2 });
  });

  it('shares MAX_CONTROL_CELLS out between the strata, so none is crowded out', () => {
    const two = [...targets, { key: 'u|chatgpt-web|US', pre: cell('u', 3) }];
    const candidates = [
      ...Array.from({ length: MAX_CONTROL_CELLS + 5 }, (_, i) =>
        candidate(`c${String(i).padStart(4, '0')}`, 7),
      ),
      ...Array.from({ length: 5 }, (_, i) => candidate(`low${i}`, 3)),
    ];
    const { cells } = matchControls({
      targets: two,
      candidates,
      targetTopics: new Set(),
      topicOf: () => null,
    });
    expect(cells.length).toBeLessThanOrEqual(MAX_CONTROL_CELLS);
    expect(cells.filter((c) => c.pre.visible === 3)).toHaveLength(5);
  });
});

describe('effect, p-value and outcome', () => {
  const targetIds = Array.from({ length: 10 }, (_, i) => `t${i}`);
  const controlIds = Array.from({ length: 20 }, (_, i) => `c${i}`);
  const measure = (levels, ids = targetIds, controls = controlIds) =>
    measureCells({
      seed: 'm1:d14',
      primary: 'visibility',
      targetIds: ids,
      ...windows(levels),
      excluded: new Set(ids),
      prompts: promptsOf([...ids, ...controls]),
    });

  it('gives No meaningful change when targets and controls rise equally', () => {
    const result = measure([
      ...targetIds.map((id) => [id, [4, 10]]),
      ...controlIds.map((id) => [id, [4, 10]]),
    ]);
    expect(result.reason).toBeNull();
    const [visibility] = result.metrics;
    expect(visibility).toMatchObject({
      metric: 'visibility',
      delta: 42.9,
      control_before: 28.6,
      control_after: 71.4,
      effect: 0,
      p_value: 1,
    });
    expect(verdictOf(result.judged)).toBe('no_meaningful_change');
    expect(confidenceOf(result.judged)).toBe('low');
  });

  it('gives Improved, High, when only the targets rise, with an interval around the effect', () => {
    const result = measure([
      ...targetIds.map((id, i) => [id, [4, 11 + (i % 2)]]),
      ...controlIds.map((id, i) => [id, [4, 4 + (i % 3)]]),
    ]);
    const [visibility, citations] = result.metrics;
    expect(visibility.effect).toBeGreaterThan(40);
    expect(visibility.p_value).toBeLessThan(0.05);
    expect(visibility.interval_low).toBeLessThanOrEqual(visibility.effect);
    expect(visibility.interval_high).toBeGreaterThanOrEqual(visibility.effect);
    // The row adds up: effect = change − the controls' change.
    expect(visibility.effect).toBeCloseTo(
      visibility.delta - (visibility.control_after - visibility.control_before),
      0,
    );
    expect(result.judged).toMatchObject({ targetCells: 10, targetPrompts: 10 });
    expect(verdictOf(result.judged)).toBe('improved');
    expect(confidenceOf(result.judged)).toBe('high');
    // The second metric is read beside it, never judged on.
    expect(citations).toMatchObject({ metric: 'citations', effect: 0 });
  });

  it('gives Declined when the targets fall beyond the controls', () => {
    const result = measure([
      ...targetIds.map((id, i) => [id, [10, 2 + (i % 2)]]),
      ...controlIds.map((id, i) => [id, [10, 9 + (i % 3)]]),
    ]);
    expect(verdictOf(result.judged)).toBe('declined');
  });

  it('reads no effect from an engine-wide drop where only the targets are tracked on another engine too', () => {
    // Targets on two engines at 50%, controls on the first only. The first
    // engine drops ~29 points for everyone; the second holds. Unstratified,
    // the targets' half-drop read +14 pts against the controls' full one.
    const other = { platform: 'perplexity-web' };
    const result = measure([
      ...targetIds.map((id, i) => [id, [7, 3 + (i % 2)]]),
      ...targetIds.map((id) => [id, [7, 7], other]),
      ...controlIds.map((id, i) => [id, [7, 3 + (i % 2)]]),
    ]);
    expect(result.judged.targetCells).toBe(10);
    expect(Math.abs(result.judged.effect)).toBeLessThan(1);
    expect(verdictOf(result.judged)).toBe('no_meaningful_change');
  });

  it('reads no effect from levels moving their own way when targets and controls sit at different ones', () => {
    // Half the targets at 0%, half at 93%; 38 of 40 controls at 0%. The 93%
    // band falls 14 points for everyone: unstratified, a −6 pts "decline".
    const controls = Array.from({ length: 40 }, (_, i) => `c${i}`);
    const result = measure(
      [
        ...targetIds.map((id, i) => [id, i < 5 ? [0, 0] : [13, 11]]),
        ...controls.map((id, i) => [id, i < 38 ? [0, 0] : [13, 11]]),
      ],
      targetIds,
      controls,
    );
    expect(result.judged.effect).toBeCloseTo(0, 6);
    expect(verdictOf(result.judged)).toBe('no_meaningful_change');
  });

  it('keeps a real effect when the engine mix differs', () => {
    // Everyone on the first engine drops 29 points, but the targets hold;
    // on the second, the controls hold and the targets gain 29.
    const other = { platform: 'perplexity-web' };
    const result = measure([
      ...targetIds.map((id, i) => [id, [7, 7 + (i % 2)]]),
      ...targetIds.map((id, i) => [id, [7, 11 + (i % 2)], other]),
      ...controlIds.map((id, i) => [id, [7, 3 + (i % 2)]]),
      ...controlIds.map((id, i) => [id, [7, 7 + (i % 2)], other]),
    ]);
    expect(result.judged.effect).toBeGreaterThan(25);
    expect(verdictOf(result.judged)).toBe('improved');
  });

  it('says too_few_prompts from day 14 with one prompt, however many engines it is on', () => {
    const engines = Array.from({ length: 10 }, (_, i) => ({ platform: `engine-${i}` }));
    const controls = Array.from({ length: 40 }, (_, i) => `c${i}`);
    const result = measure(
      [
        ...engines.map((engine) => ['solo', [4, 12], engine]),
        ...controls.flatMap((id, i) => engines.map((engine) => [id, [4, 4 + (i % 3)], engine])),
      ],
      ['solo'],
      controls,
    );
    expect(result.judged).toMatchObject({ targetCells: 10, targetPrompts: 1 });
    // Nothing is re-randomized for a checkpoint that can't have a verdict.
    expect(result.judged.p).toBeNull();
    expect(result.metrics[0]).toMatchObject({
      p_value: null,
      interval_low: null,
      interval_high: null,
    });
    const window = checkpointWindow(SHIPPED, 14);
    const entry = (cp) =>
      checkpointEntry({ cp, window, result, earlier: [], measuredAt: '2026-10-16T07:53:00Z' });
    // Day 7 still shows its direction; from day 14 there is no verdict to give.
    expect(entry(CHECKPOINTS[0])).toMatchObject({
      outcome: 'pending',
      direction: 'up',
      not_measurable_reason: null,
    });
    expect(entry(CHECKPOINTS[1])).toMatchObject({
      outcome: 'not_measurable',
      confidence: null,
      not_measurable_reason: 'too_few_prompts',
      target_cells: 10,
      target_prompts: 1,
    });
  });

  it('gives a verdict from three target prompts on', () => {
    const three = targetIds.slice(0, 3);
    const result = measure(
      [
        ...three.map((id, i) => [id, [4, 11 + (i % 2)]]),
        ...controlIds.map((id, i) => [id, [4, 4 + (i % 3)]]),
      ],
      three,
    );
    expect(result.judged.targetPrompts).toBe(3);
    const entry = checkpointEntry({
      cp: CHECKPOINTS[1],
      window: checkpointWindow(SHIPPED, 14),
      result,
      earlier: [],
      measuredAt: '2026-10-16T07:53:00Z',
    });
    expect(entry).toMatchObject({ outcome: 'improved', confidence: 'low' });
  });

  it('is the same result every time for the same rows (seeded)', () => {
    const levels = [
      ...targetIds.map((id, i) => [id, [4, 6 + (i % 3)]]),
      ...controlIds.map((id, i) => [id, [4, 4 + (i % 4)]]),
    ];
    expect(measure(levels).metrics).toEqual(measure(levels).metrics);
  });

  it('reads no effect from runs by hand that only add answers to the targets’ days', () => {
    // Each target day gets a second answer (Run on the prompt). The day's
    // share of answers naming the brand is unchanged: 4 of 14 days with one
    // of one, or 8 of 14 days with one of two. Read as "any answer named
    // it", the targets went from 29% to 57%.
    const pre = [];
    const post = [];
    for (const id of [...targetIds, ...controlIds]) {
      pre.push(...cellRows(id, '2026-09-17', 14, 4));
      post.push(
        ...cellRows(id, '2026-10-02', 14, 4).map((row, d) =>
          targetIds.includes(id)
            ? {
                ...row,
                answer_count: 2,
                mentioning_answers: d < 8 ? 1 : 0,
                has_mention: d < 8,
              }
            : row,
        ),
      );
    }
    const result = measureCells({
      seed: 'm1:d14',
      primary: 'visibility',
      targetIds,
      pre: aggregateCells(pre, ALL),
      post: aggregateCells(post, ALL),
      excluded: new Set(targetIds),
      prompts: promptsOf([...targetIds, ...controlIds]),
    });
    expect(result.metrics[0]).toMatchObject({ before: 28.6, after: 28.6, effect: 0 });
    expect(verdictOf(result.judged)).toBe('no_meaningful_change');
  });

  it('leaves out target cells with no control in their stratum before anything is re-randomized', () => {
    const other = { platform: 'perplexity-web' };
    const result = measure(
      [
        ...targetIds.map((id, i) => [id, [4, 11 + (i % 2)]]),
        // Two more targets, tracked only on an engine no control is on.
        ['x0', [4, 4], other],
        ['x1', [4, 4], other],
        ...controlIds.map((id, i) => [id, [4, 4 + (i % 3)]]),
      ],
      [...targetIds, 'x0', 'x1'],
    );
    expect(result.judged).toMatchObject({ targetCells: 10, targetPrompts: 10 });
    expect(result.metrics[0]).toMatchObject({ target_prompts: 10, control_prompts: 20 });
    expect(result.judged.p).toBeLessThan(0.05);
  });

  it('skips and counts the bootstrap resamples that leave a target stratum without control', () => {
    const cellOf = (promptId, platform, before, after) => ({
      key: `${promptId}|${platform}|US`,
      pre: { promptId, platform, region: 'US', runs: 14, visible: before, cited: 0 },
      post: { promptId, platform, region: 'US', runs: 14, visible: after, cited: 0 },
    });
    const targets = ['t0', 't1', 't2'].flatMap((id, i) =>
      ['a', 'b', 'c'].map((engine) => cellOf(id, engine, 7, 9 + (i % 2))),
    );
    const many = Array.from({ length: 20 }, (_, i) => cellOf(`c${i}`, 'a', 7, 7 + (i % 3)));
    // One control on engine b: about two resamples in three draw it.
    const oneSparse = metricResult({
      metric: 'visibility',
      targets,
      controls: [...many, cellOf('cb', 'b', 7, 8)],
      seed: 's',
    }).stored;
    expect(oneSparse.interval_low).not.toBeNull();
    expect(oneSparse.interval_resamples).toBeGreaterThan(1000 * MIN_BOOTSTRAP_SHARE);
    expect(oneSparse.interval_resamples).toBeLessThan(1000);
    // One each on b and c: fewer than half draw both, so no interval.
    const twoSparse = metricResult({
      metric: 'visibility',
      targets,
      controls: [...many, cellOf('cb', 'b', 7, 8), cellOf('cc', 'c', 7, 8)],
      seed: 's',
    }).stored;
    expect(twoSparse).toMatchObject({
      interval_low: null,
      interval_high: null,
      interval_resamples: null,
    });
    expect(twoSparse.p_value).not.toBeNull();
  });

  it('reads the p-value of identical changes as 1', () => {
    const result = measure([
      ...targetIds.map((id) => [id, [4, 9]]),
      ...controlIds.map((id) => [id, [4, 9]]),
    ]);
    expect(result.judged.p).toBe(1);
  });

  // Calibration: in worlds where the change did nothing, Improved and
  // Declined together come from p < P_VERDICT (and 3 points), so they may
  // come in about P_VERDICT of the measurable worlds. Measured: 0.179 (35 of
  // 196; 5 engines, 3 targets, 12 controls: most target strata hold one or
  // two controls) and 0.179 (34 of 190) with a fourth target tracked only
  // where no control is. Bounds: P_VERDICT + 0.07 above (2.5 standard
  // errors of a rate near 0.2 over ~190 worlds: room for chance, not for a
  // test that reads noise as an effect) and 0.10 below (the unstudentized
  // difference read 0.087 and 0.079 here, power lost with it).
  const nominal = (tally) => (tally.improved + tally.declined) / tally.measurable;

  it(
    'keeps Improved and Declined at their nominal rate in worlds with no effect',
    () => {
      const tally = outcomes(200, { kind: 'null' });
      expect(tally.measurable).toBeGreaterThanOrEqual(150);
      expect(nominal(tally)).toBeLessThanOrEqual(P_VERDICT + 0.07);
      expect(nominal(tally)).toBeGreaterThanOrEqual(0.1);
    },
    { timeout: 30_000 },
  );

  it(
    'keeps them there with a target tracked only where no control is',
    () => {
      const tally = outcomes(200, { kind: 'orphan', orphan: true });
      expect(tally.measurable).toBeGreaterThanOrEqual(150);
      expect(nominal(tally)).toBeLessThanOrEqual(P_VERDICT + 0.07);
      expect(nominal(tally)).toBeGreaterThanOrEqual(0.1);
    },
    { timeout: 30_000 },
  );

  it(
    'finds a real +15 pts effect in most noisy worlds (power)',
    () => {
      // 5 targets, 15 controls, 5 engines with their own swing: measured
      // Improved in 0.86 of 100 worlds (3 targets: 0.62; 8 targets: 0.95).
      // 0.70 is over 4 standard errors below 0.86 at 100 worlds: a method
      // that lost a fair part of its power fails here.
      const tally = outcomes(100, { kind: 'power5', targets: 5, controls: 15, lift: 0.15 });
      expect(tally.measurable).toBeGreaterThanOrEqual(90);
      expect(tally.improved / tally.measurable).toBeGreaterThanOrEqual(0.7);
      expect(tally.declined).toBe(0);
    },
    { timeout: 30_000 },
  );

  it('judges the unrounded effect, with enough prompts, and sets confidence by cells and prompts', () => {
    // 2.96 is stored as 3.0, but isn't the minimum meaningful change.
    expect(verdictOf({ effect: 2.96, p: 0.01 })).toBe('no_meaningful_change');
    expect(verdictOf({ effect: 3, p: 0.01 })).toBe('improved');
    expect(verdictOf({ effect: 8, p: 0.2 })).toBe('no_meaningful_change');
    expect(verdictOf({ effect: -3, p: 0.1 })).toBe('declined');
    expect(confidenceOf({ p: 0.01, targetCells: 10, targetPrompts: 10 })).toBe('high');
    expect(confidenceOf({ p: 0.01, targetCells: 9, targetPrompts: 10 })).toBe('medium');
    expect(confidenceOf({ p: 0.01, targetCells: 30, targetPrompts: 9 })).toBe('medium');
    expect(confidenceOf({ p: 0.01, targetCells: 10, targetPrompts: 10, stormy: true })).toBe(
      'medium',
    );
    expect(confidenceOf({ p: 0.1, targetCells: 20, targetPrompts: 4 })).toBe('low');
    expect(confidenceOf({ p: 0.1, targetCells: 4, targetPrompts: 5 })).toBe('low');
    expect(directionOf(3)).toBe('up');
    expect(directionOf(-2.9)).toBe('flat');
    expect(directionOf(-3)).toBe('down');
  });

  it('judges outreach on citations, every other change on visibility', () => {
    expect(primaryMetric({ kind: 'third_party_observed', change_type: null })).toBe('citations');
    expect(primaryMetric({ kind: 'manual', change_type: 'outreach' })).toBe('citations');
    expect(primaryMetric({ kind: 'cms_publish', change_type: 'content' })).toBe('visibility');
  });
});

describe('not measurable', () => {
  const targetIds = ['t1', 't2'];

  it('says too_few_controls with fewer than 10 control cells, keeping those it matched', () => {
    const controls = Array.from({ length: MIN_CONTROL_CELLS - 1 }, (_, i) => `c${i}`);
    const result = measureCells({
      seed: 's',
      primary: 'visibility',
      targetIds,
      ...windows([...targetIds, ...controls].map((id) => [id, [4, 8]])),
      excluded: new Set(targetIds),
      prompts: promptsOf([...targetIds, ...controls]),
    });
    expect(result).toMatchObject({ reason: 'too_few_controls', targetCells: 2 });
    expect(result.control.cells).toHaveLength(MIN_CONTROL_CELLS - 1);
  });

  it('says too_few_controls with one control prompt, however many cells it brings', () => {
    const engines = Array.from({ length: MIN_CONTROL_CELLS }, (_, i) => `engine-${i}`);
    const ids = ['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8', 't9', 't10', 'c1'];
    const levels = ids.flatMap((id) =>
      engines.map((platform) => [id, id === 'c1' ? [4, 4] : [4, 10], { platform }]),
    );
    const result = measureCells({
      seed: 's',
      primary: 'visibility',
      targetIds: ids.slice(0, 10),
      ...windows(levels),
      excluded: new Set(ids.slice(0, 10)),
      prompts: promptsOf(ids),
    });
    // Ten control cells, all of one prompt: one control.
    expect(result.control.cells).toHaveLength(MIN_CONTROL_CELLS);
    expect(result).toMatchObject({ reason: 'too_few_controls' });
    expect(MIN_CONTROL_PROMPTS).toBeGreaterThan(1);
  });

  it('says too_few_runs with fewer than 3 tracked days in a window (tracking started late)', () => {
    const pre = aggregateCells(
      targetIds.flatMap((id) => cellRows(id, '2026-09-28', 2, 1)),
      ALL,
    );
    const post = aggregateCells(
      targetIds.flatMap((id) => cellRows(id, '2026-10-02', 14, 5)),
      ALL,
    );
    expect(
      measureCells({
        seed: 's',
        primary: 'visibility',
        targetIds,
        pre,
        post,
        excluded: new Set(),
        prompts: promptsOf(targetIds),
      }).reason,
    ).toBe('too_few_runs');
  });

  it('says too_few_runs with no data at all, and engine_not_on_plan when the data is off the plan', () => {
    const empty = aggregateCells([], STARTER);
    const base = { seed: 's', primary: 'visibility', targetIds, excluded: new Set() };
    expect(
      measureCells({ ...base, pre: empty, post: empty, prompts: promptsOf(targetIds) }).reason,
    ).toBe('too_few_runs');
    const perplexity = (from) =>
      aggregateCells(
        targetIds.flatMap((id) => cellRows(id, from, 14, 5, { platform: 'perplexity-web' })),
        STARTER,
      );
    expect(
      measureCells({
        ...base,
        pre: perplexity('2026-09-17'),
        post: perplexity('2026-10-02'),
        prompts: promptsOf(targetIds),
      }).reason,
    ).toBe('engine_not_on_plan');
  });

  it('says overlapping_change when other changes left no target of its own', () => {
    const empty = aggregateCells([], ALL);
    expect(
      measureCells({
        seed: 's',
        primary: 'visibility',
        targetIds: [],
        pre: empty,
        post: empty,
        excluded: new Set(),
        prompts: new Map(),
      }).reason,
    ).toBe('overlapping_change');
  });

  it('never takes a paused prompt, or one another change targets, as a control', () => {
    const controls = Array.from({ length: 12 }, (_, i) => `c${i}`);
    const prompts = promptsOf([...targetIds, ...controls]);
    prompts.set('c0', { topic_id: 't1', is_active: false });
    const result = measureCells({
      seed: 's',
      primary: 'visibility',
      targetIds,
      ...windows([...targetIds, ...controls].map((id) => [id, [4, 8]])),
      excluded: new Set([...targetIds, 'c1', 'c2']),
      prompts,
    });
    expect(result.reason).toBe('too_few_controls');
    expect(result.control.cells.map((c) => c.pre.promptId)).not.toContain('c0');
    expect(result.control.cells.map((c) => c.pre.promptId)).not.toContain('c1');
  });
});

describe('checkpoint entries', () => {
  const window = checkpointWindow(SHIPPED, 7);
  const measured = (effect, p) => ({
    reason: null,
    targetCells: 12,
    control: { cells: new Array(20) },
    metrics: [
      {
        metric: 'visibility',
        before: 30,
        after: 30 + effect,
        control_before: 31,
        control_after: 31,
        effect,
        p_value: p,
        direction: directionOf(effect),
        control_cells: 20,
      },
    ],
    judged: { effect, p, targetCells: 12, targetPrompts: 12 },
  });
  const at = '2026-10-09T07:53:00.000Z';

  it('keeps day 7 Pending with a direction only, no verdict and no confidence', () => {
    const entry = checkpointEntry({
      cp: CHECKPOINTS[0],
      window,
      result: measured(12, 0.001),
      earlier: [],
      measuredAt: at,
    });
    expect(entry).toMatchObject({
      checkpoint: 'd7',
      outcome: 'pending',
      confidence: null,
      direction: 'up',
      not_measurable_reason: null,
    });
  });

  it('gives a verdict with its confidence from day 14, and Not measurable with the reason', () => {
    expect(
      checkpointEntry({
        cp: CHECKPOINTS[1],
        window,
        result: measured(12, 0.001),
        earlier: [],
        measuredAt: at,
      }),
    ).toMatchObject({
      outcome: 'improved',
      confidence: 'high',
      // The checkpoint's own numbers, to show it beside a later one.
      metric: 'visibility',
      before: 30,
      after: 42,
      control_before: 31,
      control_after: 31,
      target_prompts: 12,
      control_cells: 20,
    });
    expect(
      checkpointEntry({
        cp: CHECKPOINTS[1],
        window,
        result: { reason: 'too_few_controls', targetCells: 3 },
        earlier: [],
        measuredAt: at,
      }),
    ).toMatchObject({
      outcome: 'not_measurable',
      confidence: null,
      not_measurable_reason: 'too_few_controls',
    });
  });

  it('gives a Not measurable checkpoint its numbers but no effect, p, interval or direction', () => {
    const result = {
      ...measured(12, 0.001),
      judged: { effect: 12, p: 0.001, targetCells: 2, targetPrompts: 2 },
    };
    const entry = checkpointEntry({
      cp: CHECKPOINTS[1],
      window,
      result,
      earlier: [],
      measuredAt: at,
    });
    expect(entry).toMatchObject({
      outcome: 'not_measurable',
      not_measurable_reason: 'too_few_prompts',
      before: 30,
      after: 42,
      control_before: 31,
      effect: null,
      p_value: null,
      interval_low: null,
      direction: null,
    });
    expect(
      withoutVerdict({
        before: 1,
        effect: 2,
        p_value: 0.1,
        interval_low: 0,
        interval_high: 3,
        direction: 'flat',
      }),
    ).toEqual({
      before: 1,
      effect: null,
      p_value: null,
      interval_low: null,
      interval_high: null,
      interval_resamples: null,
      direction: null,
    });
  });

  it('says nothing of whether the effect held when day 90 can’t be measured', () => {
    const entry = checkpointEntry({
      cp: CHECKPOINTS[3],
      window,
      result: { reason: 'too_few_runs', targetCells: 0 },
      earlier: [
        { checkpoint: 'd14', outcome: 'improved' },
        { checkpoint: 'd30', outcome: 'improved' },
      ],
      measuredAt: at,
    });
    expect(entry).toMatchObject({ outcome: 'not_measurable', lasting: null });
  });

  it('says at day 90 whether the effect held or faded', () => {
    const earlier = [
      { checkpoint: 'd14', outcome: 'improved' },
      { checkpoint: 'd30', outcome: 'improved' },
    ];
    expect(
      checkpointEntry({
        cp: CHECKPOINTS[3],
        window,
        result: measured(9, 0.01),
        earlier,
        measuredAt: at,
      }).lasting,
    ).toBe('held');
    expect(
      checkpointEntry({
        cp: CHECKPOINTS[3],
        window,
        result: measured(1, 0.6),
        earlier,
        measuredAt: at,
      }).lasting,
    ).toBe('faded');
    expect(lastingOf([{ checkpoint: 'd30', outcome: 'no_meaningful_change' }], 'improved')).toBe(
      null,
    );
  });

  it('reads day 14’s verdict for day 90 when day 30 has none', () => {
    const earlier = [
      { checkpoint: 'd14', outcome: 'improved' },
      { checkpoint: 'd30', outcome: 'not_measurable' },
    ];
    expect(lastingOf(earlier, 'improved')).toBe('held');
    expect(lastingOf(earlier, 'no_meaningful_change')).toBe('faded');
    // Day 30's own verdict, No meaningful change, is the one before day 90.
    expect(
      lastingOf(
        [
          { checkpoint: 'd14', outcome: 'improved' },
          { checkpoint: 'd30', outcome: 'no_meaningful_change' },
        ],
        'improved',
      ),
    ).toBeNull();
  });

  it('reads no p-value or interval for a checkpoint without a verdict (day 7)', () => {
    const targetIds = Array.from({ length: 10 }, (_, i) => `t${i}`);
    const controls = Array.from({ length: 20 }, (_, i) => `c${i}`);
    const input = {
      seed: 'm1:d7',
      primary: 'visibility',
      targetIds,
      ...windows([
        ...targetIds.map((id, i) => [id, [4, 11 + (i % 2)]]),
        ...controls.map((id, i) => [id, [4, 4 + (i % 3)]]),
      ]),
      excluded: new Set(targetIds),
      prompts: promptsOf([...targetIds, ...controls]),
    };
    const day7 = measureCells({ ...input, verdict: false });
    const day14 = measureCells(input);
    expect(day7.metrics[0]).toMatchObject({
      effect: day14.metrics[0].effect,
      direction: 'up',
      p_value: null,
      interval_low: null,
      interval_high: null,
    });
    expect(day14.metrics[0].p_value).toEqual(expect.any(Number));
  });
});

describe('an agent run’s outcome', () => {
  it('follows its one change, and Pending until it has a verdict', () => {
    expect(runOutcome([])).toBeNull();
    expect(runOutcome([{ outcome: 'pending', confidence: null }])).toEqual({
      outcome: 'pending',
      confidence: null,
    });
    expect(runOutcome([{ outcome: 'improved', confidence: 'high' }])).toEqual({
      outcome: 'improved',
      confidence: 'high',
    });
    expect(runOutcome([{ outcome: 'not_measurable', confidence: null }])).toEqual({
      outcome: 'not_measurable',
      confidence: null,
    });
  });

  it('reads several changes together, with the lowest confidence', () => {
    expect(
      runOutcome([
        { outcome: 'improved', confidence: 'high' },
        { outcome: 'no_meaningful_change', confidence: 'medium' },
        { outcome: 'pending', confidence: null },
      ]),
    ).toEqual({ outcome: 'improved', confidence: 'medium' });
    expect(
      runOutcome([
        { outcome: 'improved', confidence: 'high' },
        { outcome: 'declined', confidence: 'high' },
      ]).outcome,
    ).toBe('no_meaningful_change');
  });
});
