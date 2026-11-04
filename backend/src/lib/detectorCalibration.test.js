import { describe, expect, it } from 'vitest';
import { ENGINE_THRESHOLDS } from '../config/actionEngine.js';
import { LIBRARY_KINDS } from './signals/library/kinds.js';
import {
  KIND_DEFINITIONS,
  actionsByKind,
  calibrate,
  parseRows,
  renderReport,
  strengthOf,
} from './detectorCalibration.js';

/** Detector thresholds against what their actions did (learning C6). */

/** A kind whose strength is its value, higher stronger: prompts, at least 3. */
const K = 'uncited_mentions';

/**
 * One export line per action n, from `from` to `to`: its baseline values,
 * from `values(n)` (the value n by default), and how it ended, from `end(n)`.
 */
function lines(kind, from, to, end, values = (n) => ({ current: n })) {
  const out = [];
  for (let n = from; n <= to; n += 1) {
    const [status, outcome = 'pending_measurement', dismissReason = null] = end(n);
    out.push(
      JSON.stringify({
        action: `${kind}-${n}`,
        kind,
        ...values(n),
        status,
        outcome,
        dismissReason,
      }),
    );
  }
  return out;
}
const rowsOf = (...groups) => parseRows(groups.flat().join('\n')).rows;
const kindOf = (report, kind) => report.kinds.find((k) => k.kind === kind);
const improved = () => ['completed', 'improved'];
const rejected = (reason = 'not_relevant') => ['dismissed', 'pending_measurement', reason];

describe('parseRows', () => {
  it('reads baseline values, numbers given as text too, and counts lines that are not rows', () => {
    const { rows, skipped, withoutBaseline } = parseRows(
      [
        '﻿{"action":"a1","kind":"topic_drop","current":"35","change":"-15","status":"completed","outcome":"improved"}',
        '{"action":"a2","kind":"k","change":null,"current":"0.4","status":"dismissed","outcome":"pending_measurement","dismissReason":"not_now"}',
        '{"action":"a3","kind":"k","change":-12,"current":3,"status":"completed","outcome":"declined"}',
        '{"action":"a4","kind":"topic_drop","status":"completed"}',
        '',
        'not json',
        '{"action":"a5"}',
        '{"kind":"topic_drop"}',
        '{"withoutBaseline":"4"}',
      ].join('\r\n'),
    );
    expect(skipped).toBe(3);
    expect(withoutBaseline).toBe(4);
    expect(rows).toEqual([
      {
        action: 'a1',
        kind: 'topic_drop',
        current: 35,
        change: -15,
        strength: 0.3,
        strengthFrom: null,
        status: 'completed',
        outcome: 'improved',
        dismissReason: null,
      },
      {
        action: 'a2',
        kind: 'k',
        current: 0.4,
        change: null,
        strength: 0.4,
        strengthFrom: 'currentValue',
        status: 'dismissed',
        outcome: 'pending_measurement',
        dismissReason: 'not_now',
      },
      {
        action: 'a3',
        kind: 'k',
        current: 3,
        change: -12,
        strength: 12,
        strengthFrom: 'changeValue',
        status: 'completed',
        outcome: 'declined',
        dismissReason: null,
      },
      {
        action: 'a4',
        kind: 'topic_drop',
        current: null,
        change: null,
        strength: null,
        strengthFrom: null,
        status: 'completed',
        outcome: null,
        dismissReason: null,
      },
    ]);
  });

  it('has no count of actions without a baseline when the export has no such line', () => {
    expect(parseRows('{"action":"a1","kind":"k","current":1}').withoutBaseline).toBeNull();
  });
});

describe('strengthOf', () => {
  it.each([
    ['topic_uncovered', 15, null, 0.15],
    ['topic_drop', 35, -15, 0.3],
    ['sharp_drop', 14, -6, 0.3],
    ['platform_gap', 8, -22.5, 22.5],
    ['country_gap', 12, -18, 0.18],
    ['competitor_leads', 30, 10, 1.5],
    ['competitor_leads', 30, 30, null],
    ['competitor_momentum', 15, 5, 0.5],
    ['competitor_winning_source', 40, 24, 0.6],
    ['competitor_surge', 40, 16, 16],
    ['uncited_mentions', 7, null, 7],
    ['topic_drop', null, -15, null],
  ])('reads %s (current %s, change %s) as %s in its unit', (kind, current, change, strength) => {
    const read = strengthOf(kind, current, change).strength;
    if (strength === null) expect(read).toBeNull();
    else expect(read).toBeCloseTo(strength);
  });

  it('reads a kind with no definition by the size of its change, else its value', () => {
    expect(strengthOf('audit_low_score', 9, -3)).toEqual({ strength: 3, from: 'changeValue' });
    expect(strengthOf('audit_low_score', 9, null)).toEqual({ strength: 9, from: 'currentValue' });
    expect(strengthOf('audit_low_score', null, null)).toEqual({ strength: null, from: null });
  });
});

describe('KIND_DEFINITIONS', () => {
  it("names each config threshold by its path and today's value", () => {
    for (const [kind, d] of Object.entries(KIND_DEFINITIONS)) {
      if (d.threshold.file !== 'config/actionEngine.js') continue;
      const [group, key] = d.threshold.name.split('.');
      expect(ENGINE_THRESHOLDS[group][key], kind).toBe(d.threshold.value);
    }
  });

  it("defines library kinds and the original detectors' kinds that keep their measure", () => {
    expect(
      Object.keys(KIND_DEFINITIONS)
        .filter((kind) => !(kind in LIBRARY_KINDS))
        .sort(),
    ).toEqual([
      'competitor_citation_gap',
      'competitor_surge',
      'page_opportunity',
      'platform_gap',
      'prompt_gain',
      'sharp_drop',
      'uncited_mentions',
      'visibility_slipping',
    ]);
  });
});

describe('actionsByKind', () => {
  it("keeps one row per action and kind, its strongest signal's", () => {
    const rows = rowsOf([
      '{"action":"a1","kind":"k","change":2,"status":"completed"}',
      '{"action":"a1","kind":"k","change":-9,"status":"completed"}',
      '{"action":"a1","kind":"other","change":1,"status":"completed"}',
      '{"action":"a2","kind":"k","change":1,"status":"dismissed"}',
      // Lower coverage is the stronger signal.
      '{"action":"a3","kind":"topic_uncovered","current":15,"status":"completed"}',
      '{"action":"a3","kind":"topic_uncovered","current":5,"status":"completed"}',
    ]);
    const byKind = actionsByKind(rows);
    expect(byKind.get('k').map((r) => [r.action, r.strength])).toEqual([
      ['a1', 9],
      ['a2', 1],
    ]);
    expect(byKind.get('other')).toHaveLength(1);
    expect(byKind.get('topic_uncovered').map((r) => r.strength)).toEqual([0.05]);
  });
});

describe('calibrate', () => {
  it('says nothing of a kind with fewer than 20 actions', () => {
    const report = calibrate(rowsOf(lines(K, 1, 19, improved)));
    expect(report.kinds).toEqual([]);
    expect(report.insufficient).toEqual([{ kind: K, actions: 19 }]);
  });

  it('suggests a threshold, in its unit, where the weakest quarter was dismissed as not relevant', () => {
    const report = calibrate(rowsOf(lines(K, 1, 20, (n) => (n <= 5 ? rejected() : improved()))));
    const k = kindOf(report, K);
    expect(k).toMatchObject({
      actions: 20,
      measured: 15,
      improved: 15,
      dismissed: 5,
      rejected: 5,
      verdict: 'raise',
      reasons: ['rejected'],
      suggestion: 5,
      quiet: false,
    });
    expect(k.definition).toMatchObject({
      unit: 'prompts',
      stronger: 'higher',
      threshold: { name: 'detection.uncitedMinPrompts', value: 3 },
    });
    expect(k.dismissReasons).toEqual({
      not_relevant: 5,
      already_done: 0,
      wrong_data: 0,
      not_now: 0,
    });
    expect(k.buckets.map((b) => [b.edge, b.actions])).toEqual([
      [5, 5],
      [10, 5],
      [15, 5],
      [20, 5],
    ]);
    expect(k.rest).toMatchObject({ actions: 15, rejected: 0 });
  });

  it("doesn't take already done or not now as the detector being wrong", () => {
    for (const reason of ['already_done', 'not_now']) {
      const report = calibrate(
        rowsOf(lines(K, 1, 20, (n) => (n <= 5 ? rejected(reason) : improved()))),
      );
      expect(kindOf(report, K)).toMatchObject({ dismissed: 5, rejected: 0, verdict: 'keep' });
    }
  });

  it('raises at exactly half the weakest quarter rejected, not below', () => {
    // 24 actions: the weakest quarter is 1–6.
    const half = calibrate(
      rowsOf(lines(K, 1, 24, (n) => (n <= 3 ? rejected('wrong_data') : improved()))),
    );
    expect(kindOf(half, K)).toMatchObject({ verdict: 'raise', reasons: ['rejected'] });
    expect(kindOf(half, K).buckets[0]).toMatchObject({ actions: 6, rejectRate: 0.5 });

    const under = calibrate(
      rowsOf(lines(K, 1, 24, (n) => (n <= 2 ? rejected('wrong_data') : improved()))),
    );
    expect(kindOf(under, K)).toMatchObject({ verdict: 'keep', suggestion: null });
  });

  it('raises where the weakest quarter improves exactly half as often, not more', () => {
    const half = calibrate(
      rowsOf(lines(K, 1, 24, (n) => ['completed', n <= 3 || n > 6 ? 'improved' : 'declined'])),
    );
    expect(kindOf(half, K)).toMatchObject({
      verdict: 'raise',
      reasons: ['improves_less'],
      suggestion: 6,
    });
    expect(kindOf(half, K).buckets[0].improvedRate).toBe(0.5);
    expect(kindOf(half, K).rest.improvedRate).toBe(1);

    const over = calibrate(
      rowsOf(lines(K, 1, 24, (n) => ['completed', n <= 4 || n > 6 ? 'improved' : 'declined'])),
    );
    expect(kindOf(over, K)).toMatchObject({ verdict: 'keep' });
  });

  it("doesn't compare improvement with fewer than 5 measured on a side", () => {
    // The weakest quarter: one measured, and it declined; the rest all improved.
    const weak = calibrate(
      rowsOf(
        lines(K, 1, 20, (n) =>
          n === 1 ? ['completed', 'declined'] : n <= 5 ? rejected('not_now') : improved(),
        ),
      ),
    );
    expect(kindOf(weak, K)).toMatchObject({ verdict: 'keep', reasons: [] });
    expect(kindOf(weak, K).buckets[0].measured).toBe(1);

    // The rest: four measured, all improved; the weakest quarter's five declined.
    const rest = calibrate(
      rowsOf(
        lines(K, 1, 20, (n) =>
          n <= 5 ? ['completed', 'declined'] : n <= 9 ? improved() : rejected('already_done'),
        ),
      ),
    );
    expect(kindOf(rest, K)).toMatchObject({ verdict: 'keep', reasons: [] });
    expect(kindOf(rest, K).rest.measured).toBe(4);
  });

  it('compares the weakest quarter with every stronger action when ties empty the strongest', () => {
    // 16–20 tie with 15 at the top: the strongest quarter is empty.
    const report = calibrate(
      rowsOf(
        lines(
          K,
          1,
          20,
          (n) => (n <= 5 ? rejected() : improved()),
          (n) => ({ current: Math.min(n, 15) }),
        ),
      ),
    );
    const k = kindOf(report, K);
    expect(k.buckets.map((b) => b.actions)).toEqual([5, 5, 10, 0]);
    expect(k.rest.actions).toBe(15);
    expect(k).toMatchObject({ verdict: 'raise', suggestion: 5 });
  });

  it("is unclear when strength doesn't spread enough to compare", () => {
    const even = calibrate(
      rowsOf(
        lines(
          K,
          1,
          20,
          (n) => (n <= 15 ? rejected() : improved()),
          () => ({ current: 3 }),
        ),
      ),
    );
    expect(kindOf(even, K)).toMatchObject({ verdict: 'unclear', suggestion: null });
    expect(kindOf(even, K).rest.actions).toBe(0);

    // Three actions above a tie of seventeen.
    const tied = calibrate(
      rowsOf(
        lines(
          K,
          1,
          20,
          (n) => (n <= 10 ? rejected() : improved()),
          (n) => ({ current: n <= 17 ? 3 : n }),
        ),
      ),
    );
    expect(kindOf(tied, K)).toMatchObject({ verdict: 'unclear', suggestion: null });
    expect(renderReport(tied)).toContain("strength doesn't spread enough to compare");
  });

  it('leaves actions with no strength out of the quarters, not out of the totals', () => {
    const report = calibrate(
      rowsOf(
        lines(
          K,
          1,
          24,
          (n) => (n <= 4 || n > 20 ? rejected() : improved()),
          (n) => ({ current: n <= 20 ? n : null }),
        ),
      ),
    );
    const k = kindOf(report, K);
    expect(k).toMatchObject({ actions: 24, dismissed: 8, unrated: 4 });
    expect(k.buckets.reduce((sum, b) => sum + b.actions, 0)).toBe(20);
    expect(k.buckets[0]).toMatchObject({ edge: 5, actions: 5, rejected: 4 });
    expect(k.rest).toMatchObject({ actions: 15, rejected: 0 });
    expect(renderReport(report)).toContain('4 action(s) had no strength');
  });

  it('suggests a lower coverage where lower is stronger', () => {
    // Coverage 0–19%: the weakest quarter is the highest, 15–19%.
    const report = calibrate(
      rowsOf(
        lines(
          'topic_uncovered',
          1,
          20,
          (n) => (n > 15 ? rejected() : improved()),
          (n) => ({ current: n - 1, change: 0 }),
        ),
      ),
    );
    const k = kindOf(report, 'topic_uncovered');
    expect(k.buckets.map((b) => b.edge)).toEqual([0.15, 0.1, 0.05, 0]);
    expect(k).toMatchObject({ verdict: 'raise', suggestion: 0.15 });
    const text = renderReport(report);
    expect(text).toContain('consider coverage below 0.15 (now 0.2)');
    expect(text).toContain('| Strength down to |');
    expect(text).toContain('library.topicUncoveredCoverage in config/actionEngine.js, now 0.2');
  });

  it('gives a kind with no definition its distribution only, and the column it read', () => {
    const report = calibrate(rowsOf(lines('k', 1, 20, (n) => (n <= 5 ? rejected() : improved()))));
    const k = kindOf(report, 'k');
    expect(k).toMatchObject({
      definition: null,
      verdict: 'no_definition',
      reasons: [],
      suggestion: null,
      strengthFrom: { changeValue: 0, currentValue: 20 },
    });
    expect(k.buckets).toHaveLength(4);
    const text = renderReport(report);
    expect(text).toContain('No threshold definition for this kind');
    expect(text).toContain('currentValue for 20');
    expect(text).not.toContain('Suggestion');
  });

  it('notes a quiet kind beside a suggestion', () => {
    // 40 actions: the weakest quarter (1–10) dismissed as not relevant; of
    // the 30 measured, one improved.
    const report = calibrate(
      rowsOf(
        lines(K, 1, 40, (n) =>
          n <= 10 ? rejected() : ['completed', n === 40 ? 'improved' : 'declined'],
        ),
      ),
    );
    expect(kindOf(report, K)).toMatchObject({ verdict: 'raise', suggestion: 10, quiet: true });
    const text = renderReport(report);
    expect(text).toContain('Suggestion: consider');
    expect(text).toContain('Note: under 10% of its measured actions improved');
  });

  it('calls a kind quiet when under 10% of its results improved, evenly', () => {
    const report = calibrate(
      rowsOf(lines(K, 1, 20, (n) => ['completed', n === 3 ? 'improved' : 'declined'])),
    );
    expect(kindOf(report, K)).toMatchObject({ verdict: 'keep', quiet: true, suggestion: null });
    expect(kindOf(report, K).outcomes).toMatchObject({ improved: 1, declined: 19 });
  });

  it('keeps a threshold when the weakest quarter does as well as the rest', () => {
    const report = calibrate(
      rowsOf(lines(K, 1, 20, (n) => ['completed', n % 2 ? 'improved' : 'declined'])),
    );
    expect(kindOf(report, K)).toMatchObject({
      verdict: 'keep',
      improvedRate: 0.5,
      quiet: false,
    });
    expect(renderReport(report)).toContain('Keep: its weakest quarter does about as well');
  });

  it('counts a result only for a completed action, as the Scorecard does', () => {
    const report = calibrate(
      rowsOf(
        lines(K, 1, 20, (n) => (n <= 10 ? ['dismissed', 'improved'] : ['completed', 'declined'])),
      ),
    );
    expect(kindOf(report, K)).toMatchObject({ measured: 10, improved: 0, dismissed: 10 });
  });

  it('takes a lower minimum', () => {
    const report = calibrate(rowsOf(lines(K, 1, 8, improved)), { min: 5 });
    expect(report.kinds.map((k) => k.kind)).toEqual([K]);
  });
});

describe('renderReport', () => {
  it("prints aggregates, the suggestion and what was left out, never an action's id", () => {
    const rows = rowsOf(
      lines(K, 1, 20, (n) => (n <= 5 ? rejected() : improved())),
      lines('topic_gap', 1, 4, improved),
    );
    const text = renderReport(calibrate(rows), { skipped: 2, withoutBaseline: 3 });
    expect(text).toContain(`## ${K}`);
    expect(text).toContain(
      'Suggestion: consider prompts mentioned but never cited above 5 (now 3): its weakest quarter was mostly dismissed as not relevant or wrong data.',
    );
    expect(text).toContain('Threshold: detection.uncitedMinPrompts in config/actionEngine.js');
    expect(text).toContain('Dismissed because: not_relevant 5');
    expect(text).toContain('Too few closed actions to say (under 20): topic_gap (4)');
    expect(text).toContain('3 closed action(s) with linked signals had no baseline');
    expect(text).toContain("2 line(s) of the export weren't rows");
    expect(text).not.toMatch(new RegExp(`${K}-\\d`));
    expect(JSON.stringify(calibrate(rows))).not.toMatch(new RegExp(`${K}-\\d`));
  });

  it('softens the improvement reason and names the kinds sharing a threshold', () => {
    const rows = rowsOf(
      lines(
        'topic_slipping',
        1,
        20,
        (n) => ['completed', n <= 5 ? 'declined' : 'improved'],
        // From 50% coverage, down n points: a fall of n / 50.
        (n) => ({ current: 50 - n, change: -n }),
      ),
    );
    const text = renderReport(calibrate(rows));
    expect(text).toContain(
      'consider relative fall of coverage above 0.1 (now 0.1): its weakest quarter improves less often than the rest.',
    );
    expect(text).toContain('Also used by platform_slipping.');
  });
});
