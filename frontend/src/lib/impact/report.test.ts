import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import messages from '../../../messages/en.json';
import {
  checkpointMarks,
  impactCsv,
  impactRow,
  impactSummary,
  localDay,
  outcomeCounts,
  pageKey,
  type ImpactRow,
  type ShipRowInput,
} from './report';

/**
 * Reports › "What GetCito did for you" (CHAT-22 feature 2 item 5): a row
 * as the measuring job kept it, its checkpoints, the headline (Medium and
 * High confidence verdicts only), the CSV, and words that never claim a
 * change caused anything.
 */

const ME = 'me';
const ship = (more: Partial<ShipRowInput> = {}): ShipRowInput => ({
  key: 'r1',
  title: 'FAQ block on /pricing',
  kind: 'cms_publish',
  source: 'action_center',
  shipped_at: '2026-10-03T10:00:00.000Z',
  shipped_by: ME,
  execution_mode: 'assisted',
  url: 'https://acme.example/pricing/',
  actionNo: 1241,
  measurement: {
    targets: [
      { type: 'prompt', id: 'p1', label: 'best pricing' },
      { type: 'prompt', id: 'p2', label: 'pricing plans' },
      { type: 'url', id: 'https://acme.example/pricing/', label: 'https://acme.example/pricing/' },
    ],
    window_json: {
      pre_start: '2026-09-19',
      pre_end: '2026-10-02',
      post_start: '2026-10-04',
      post_end: '2026-10-17',
    },
    metrics: [
      {
        metric: 'visibility',
        before: 33.3,
        after: 83.3,
        control_before: 40,
        control_after: 40,
        effect: 50,
      },
    ],
    outcome: 'improved',
    confidence: 'high',
    checkpoint: 'd14',
    checkpoints_json: [
      {
        checkpoint: 'd7',
        outcome: 'pending',
        effect: 33,
        direction: 'up',
        measured_at: '2026-10-10T06:00:00Z',
      },
      {
        checkpoint: 'd14',
        outcome: 'improved',
        effect: 50,
        direction: 'up',
        measured_at: '2026-10-17T06:00:00Z',
      },
    ],
    not_measurable_reason: null,
    concurrent_changes: [
      {
        type: 'ship_event',
        id: 'x',
        title: 'Schema on /pricing',
        shipped_at: '2026-10-05T00:00:00Z',
        shared_targets: 1,
      },
    ],
    next_check_at: '2026-11-02T06:00:00Z',
    measured_at: '2026-10-17T06:00:00Z',
  },
  ...more,
});
const names = new Map([['teammate-1', 'Alex Kim']]);

describe('impactRow', () => {
  it('reads a measured change as the job kept it', () => {
    const row = impactRow(ship(), ME, names);
    expect(row).toMatchObject({
      title: 'FAQ block on /pricing',
      kind: 'cms_publish',
      source: 'action_center',
      actionNo: 1241,
      by: { who: 'you', name: null },
      targetPrompts: 2,
      pages: ['https://acme.example/pricing/'],
      outcome: 'improved',
      confidence: 'high',
      checkpoint: 'd14',
      metric: 'visibility',
      before: 33.3,
      after: 83.3,
      controlBefore: 40,
      controlAfter: 40,
      effect: 50,
      window: {
        preStart: '2026-09-19',
        preEnd: '2026-10-02',
        postStart: '2026-10-04',
        postEnd: '2026-10-17',
      },
      notMeasurableReason: null,
      concurrent: [
        { title: 'Schema on /pricing', shippedAt: '2026-10-05T00:00:00Z', sharedTargets: 1 },
      ],
    });
    expect(row.checkpoints.map((m) => m.state)).toEqual(['measured', 'measured', 'due', 'due']);
    expect(row.checkpoints[2]).toEqual({ checkpoint: 'd30', state: 'due', dueOn: '2026-11-02' });
  });

  it('names who shipped it: the reader, a teammate, or no one for an integration or an agent', () => {
    expect(impactRow(ship({ shipped_by: 'teammate-1' }), ME, names).by).toEqual({
      who: 'teammate',
      name: 'Alex Kim',
    });
    expect(impactRow(ship({ shipped_by: 'teammate-2' }), ME, names).by).toEqual({
      who: 'teammate',
      name: null,
    });
    expect(impactRow(ship({ shipped_by: null }), ME, names).by).toEqual({
      who: 'automation',
      name: null,
    });
  });

  it('reads a change not measured yet, or of another shape, as Pending with its days to come', () => {
    const row = impactRow(ship({ measurement: null }), ME, names);
    expect(row).toMatchObject({
      outcome: 'pending',
      confidence: null,
      metric: null,
      before: null,
      effect: null,
      window: null,
      targetPrompts: 0,
      // The live page still counts as its page.
      pages: ['https://acme.example/pricing/'],
    });
    expect(row.checkpoints.every((m) => m.state === 'due')).toBe(true);
    expect(
      impactRow(
        ship({ measurement: { outcome: 'great', metrics: 'none', targets: {} } }),
        ME,
        names,
      ),
    ).toMatchObject({ outcome: 'pending', metric: null, targetPrompts: 0 });
  });

  it('keeps why a change can’t be measured, and no days to come once it won’t be measured again', () => {
    const row = impactRow(
      ship({
        measurement: {
          outcome: 'not_measurable',
          not_measurable_reason: 'too_few_controls',
          checkpoint: 'd14',
          checkpoints_json: [{ checkpoint: 'd14', outcome: 'not_measurable' }],
          next_check_at: null,
        },
      }),
      ME,
      names,
    );
    expect(row.notMeasurableReason).toBe('too_few_controls');
    expect(row.checkpoints.map((m) => m.state)).toEqual(['none', 'measured', 'none', 'none']);
  });
  it('reads day 7 as a direction only, never points (an early signal, no verdict)', () => {
    const row = impactRow(
      ship({
        measurement: {
          ...ship().measurement,
          outcome: 'pending',
          confidence: null,
          checkpoint: 'd7',
          metrics: [{ metric: 'visibility', before: 30, after: 40, effect: 8.5, direction: 'up' }],
          checkpoints_json: [
            { checkpoint: 'd7', outcome: 'pending', effect: 8.5, direction: 'up' },
          ],
        },
      }),
      ME,
      names,
    );
    expect(row).toMatchObject({ checkpoint: 'd7', effect: null, direction: 'up', before: 30 });
    expect(row.checkpoints[0]).toMatchObject({ state: 'measured', effect: null, direction: 'up' });
    // From day 14 the effect is the job's, and there is no early direction.
    expect(impactRow(ship(), ME, names)).toMatchObject({ effect: 50, direction: null });
  });

  it('rounds every percentage and effect to one decimal, as the job stores them', () => {
    const row = impactRow(
      ship({
        measurement: {
          ...ship().measurement,
          metrics: [
            {
              metric: 'visibility',
              before: 33.333,
              after: 50.04,
              control_before: 40.06,
              control_after: 39.96,
              effect: 16.666,
            },
          ],
          checkpoints_json: [{ checkpoint: 'd14', outcome: 'improved', effect: -0.04 }],
        },
      }),
      ME,
      names,
    );
    expect(row).toMatchObject({
      before: 33.3,
      after: 50,
      controlBefore: 40.1,
      controlAfter: 40,
      effect: 16.7,
    });
    // Never a "-0".
    const d14 = row.checkpoints[1];
    expect(d14.state === 'measured' && Object.is(d14.effect, 0)).toBe(true);
  });
});

describe('checkpointMarks', () => {
  it('takes a checkpoint’s latest entry, and dates the ones to come from the ship', () => {
    const marks = checkpointMarks(
      '2026-10-03T10:00:00.000Z',
      [
        { checkpoint: 'd14', outcome: 'improved', effect: 20 },
        { checkpoint: 'd14', outcome: 'no_meaningful_change', effect: 1 },
      ],
      false,
    );
    expect(marks[0]).toEqual({ checkpoint: 'd7', state: 'due', dueOn: '2026-10-10' });
    expect(marks[1]).toMatchObject({
      state: 'measured',
      outcome: 'no_meaningful_change',
      effect: 1,
    });
    expect(marks[3]).toEqual({ checkpoint: 'd90', state: 'due', dueOn: '2027-01-01' });
  });

  it('keeps day 90’s lasting effect as the job stored it, held or faded, and no other day’s', () => {
    const marks = checkpointMarks(
      '2026-07-03T10:00:00.000Z',
      [
        { checkpoint: 'd14', outcome: 'improved', effect: 12, lasting: 'held' },
        { checkpoint: 'd30', outcome: 'improved', effect: 11 },
        { checkpoint: 'd90', outcome: 'no_meaningful_change', effect: 1, lasting: 'faded' },
      ],
      false,
    );
    expect(marks.map((m) => m.state === 'measured' && m.lasting)).toEqual([
      false,
      null,
      null,
      'faded',
    ]);
    const held = (lasting: unknown) =>
      checkpointMarks(
        '2026-07-03T10:00:00.000Z',
        [{ checkpoint: 'd90', outcome: 'improved', effect: 9, lasting }],
        false,
      )[3];
    expect(held('held')).toMatchObject({ state: 'measured', lasting: 'held' });
    // None to hold (no verdict before it), or of another shape: none shown.
    expect(held(null)).toMatchObject({ state: 'measured', lasting: null });
    expect(held('kept')).toMatchObject({ state: 'measured', lasting: null });
  });
});

describe('impactSummary and outcomeCounts', () => {
  const row = (outcome: ImpactRow['outcome'], confidence: ImpactRow['confidence']) =>
    ({ ...impactRow(ship(), ME, names), outcome, confidence }) as ImpactRow;
  const rows = [
    row('improved', 'high'),
    row('improved', 'medium'),
    // Low confidence is listed, not summed.
    row('improved', 'low'),
    row('no_meaningful_change', 'low'),
    row('declined', 'medium'),
    row('pending', null),
    row('pending', null),
    row('not_measurable', null),
  ];

  it('counts only Medium and High confidence verdicts in Improved X of Y', () => {
    expect(impactSummary(rows, 10)).toEqual({
      shipped: 8,
      previous: 10,
      improved: 2,
      judged: 3,
      pending: 2,
    });
    expect(impactSummary([], null)).toEqual({
      shipped: 0,
      previous: null,
      improved: 0,
      judged: 0,
      pending: 0,
    });
  });

  it('counts every row under its outcome, and All', () => {
    expect(outcomeCounts(rows)).toEqual({
      all: 8,
      improved: 3,
      pending: 2,
      no_meaningful_change: 1,
      declined: 1,
      not_measurable: 1,
    });
  });
});

describe('pageKey', () => {
  it('is a page’s path as Analytics keeps it', () => {
    expect(pageKey('https://acme.example/Pricing/')).toBe('/pricing');
    expect(pageKey('https://acme.example')).toBe('/');
    expect(pageKey('/blog/aeo/')).toBe('/blog/aeo');
    expect(pageKey('not a url')).toBeNull();
  });
});

/** Runs `fn` with the browser in another time zone. */
function inZone<T>(zone: string, fn: () => T): T {
  const tz = process.env.TZ;
  process.env.TZ = zone;
  try {
    return fn();
  } finally {
    if (tz === undefined) delete process.env.TZ;
    else process.env.TZ = tz;
  }
}

describe('localDay', () => {
  it('is the day in the browser’s time, for an instant or a date', () => {
    inZone('Europe/Istanbul', () => {
      expect(localDay('2026-10-31T22:30:00.000Z')).toBe('2026-11-01');
      expect(localDay(new Date(2026, 9, 1))).toBe('2026-10-01');
    });
    inZone('America/Los_Angeles', () => {
      expect(localDay('2026-11-01T05:30:00.000Z')).toBe('2026-10-31');
    });
  });
});

describe('impactCsv', () => {
  it('writes a line a change, numbers as numbers, a formula never run', () => {
    const csv = impactCsv(
      [
        impactRow(ship({ title: '=HYPERLINK("x")' }), ME, names),
        impactRow(ship({ measurement: null, actionNo: null }), ME, names),
      ],
      {
        headers: [
          'Change',
          'Shipped',
          'Source',
          'Action',
          'Prompts',
          'Metric',
          'Before',
          'After',
          'CB',
          'CA',
          'Lift',
          'Checkpoint',
          'Outcome',
          'Confidence',
        ],
        outcome: (o) => o.toUpperCase(),
        confidence: (c) => c.toUpperCase(),
        source: (s) => s,
      },
    );
    expect(csv.split('\n')).toEqual([
      'Change,Shipped,Source,Action,Prompts,Metric,Before,After,CB,CA,Lift,Checkpoint,Outcome,Confidence',
      `"'=HYPERLINK(""x"")",2026-10-03,action_center,AC-1241,2,visibility,33.3,83.3,40,40,50,d14,IMPROVED,HIGH`,
      'FAQ block on /pricing,2026-10-03,action_center,,0,,,,,,,,PENDING,',
    ]);
  });

  it('dates a change shipped near midnight on the day the page shows: the browser’s', () => {
    const words = {
      headers: [],
      outcome: (o: string) => o,
      confidence: (c: string) => c,
      source: (s: string) => s,
    };
    // Late on Oct 31 in UTC is Nov 1 in Istanbul, and still Oct 31 in Los Angeles.
    const late = [impactRow(ship({ shipped_at: '2026-10-31T22:30:00.000Z' }), ME, names)];
    expect(inZone('Europe/Istanbul', () => impactCsv(late, words)).split('\n')[1]).toContain(
      ',2026-11-01,',
    );
    expect(inZone('America/Los_Angeles', () => impactCsv(late, words)).split('\n')[1]).toContain(
      ',2026-10-31,',
    );
  });
});

describe('the words (CHAT-22 §2 acceptance)', () => {
  /** Every string under a node of the messages. */
  const stringsOf = (node: unknown): string[] =>
    typeof node === 'string'
      ? [node]
      : node && typeof node === 'object'
        ? Object.values(node).flatMap(stringsOf)
        : [];

  it('never say a change caused anything, on the page or in its Help', () => {
    const page = stringsOf((messages as { reports: { impact: unknown } }).reports.impact);
    expect(page.length).toBeGreaterThan(50);
    const help = readFileSync(
      path.join(__dirname, '../../../../help/reports/what-getcito-did.md'),
      'utf8',
    );
    for (const text of [...page, help]) {
      expect(text).not.toMatch(/\bcaus(e|ed|es|ing)\b|because of/i);
    }
  });
});
