import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import {
  INTENT_WEIGHTS,
  clamp,
  levelOf,
  logScale,
  pastSuccessOf,
  round,
  weightedScore,
} from './priorityCore.js';

/**
 * What every priority score is built from (learning D4). The fixtures are the
 * cases the web twin (frontend/src/lib/priorityCore.ts) is checked against too.
 */

const fixtures = JSON.parse(readFileSync(join(__dirname, 'priority-core.fixtures.json'), 'utf8'));
const PAST = { prior: 0.5, pseudoCount: 5, swing: 20 };

describe('the shared cases', () => {
  it('logScale', () => {
    for (const c of fixtures.logScale) expect(logScale(c.value, c.fullAt)).toBe(c.result);
  });
  it('round', () => {
    for (const c of fixtures.round) expect(round(c.n, c.digits)).toBe(c.result);
  });
  it('weightedScore', () => {
    for (const c of fixtures.weightedScore) {
      expect(weightedScore(c.factors, c.weights, c.scale)).toEqual(c.result);
    }
  });
  it('pastSuccessOf', () => {
    for (const c of fixtures.pastSuccessOf) {
      expect(pastSuccessOf(c.track, c.settings)).toEqual(c.result);
    }
  });
  it('levelOf', () => {
    for (const c of fixtures.levelOf) expect(levelOf(c.score, c.cutoffs)).toBe(c.result);
  });
});

describe('logScale', () => {
  it('runs from 0 at nothing to 1 at the full count, on a log scale', () => {
    expect(logScale(0, 10000)).toBe(0);
    expect(logScale(10000, 10000)).toBe(1);
    expect(logScale(1_000_000, 10000)).toBe(1);
    expect(logScale(100, 10000)).toBeCloseTo(0.5, 2);
    // A negative count is no count; so is what isn't a number, and a count
    // past any end is full.
    expect(logScale(-3, 10000)).toBe(0);
    expect(logScale(Number.NaN, 10000)).toBe(0);
    expect(logScale(undefined, 10000)).toBe(0);
    expect(logScale(Number.POSITIVE_INFINITY, 10000)).toBe(1);
  });
});

describe('weightedScore', () => {
  it("adds each factor's points in the weights' order and says what each gave", () => {
    const { total, parts } = weightedScore({ a: 0.5, b: 1, ignored: 1 }, { b: 30, a: 20 });
    expect(total).toBe(40);
    expect(parts).toEqual([
      { key: 'b', value: 1, weight: 30, points: 30 },
      { key: 'a', value: 0.5, weight: 20, points: 10 },
    ]);
  });
  it('reads factors given out of 100 against weights out of 100', () => {
    expect(weightedScore({ a: 50, b: 100 }, { a: 60, b: 40 }, 100).total).toBe(70);
  });
});

describe('pastSuccessOf', () => {
  it('sits at the prior and moves nothing without results', () => {
    expect(pastSuccessOf(undefined, PAST)).toEqual({
      rate: 0.5,
      points: 0,
      improved: 0,
      results: 0,
    });
  });
  it('moves with the results, pulled toward the prior', () => {
    const good = pastSuccessOf({ improved: 10, results: 10 }, PAST);
    expect(good.rate).toBeCloseTo(12.5 / 15);
    expect(good.points).toBeCloseTo(6.67, 2);
    expect(pastSuccessOf({ improved: 0, results: 10 }, PAST).points).toBeCloseTo(-6.67, 2);
    // More improved than results reads as all of them improved.
    expect(pastSuccessOf({ improved: 4, results: 2 }, PAST).results).toBe(4);
  });
});

describe('levelOf and clamp', () => {
  it("reads a score at a screen's own cut-offs", () => {
    const cutoffs = { critical: 90, high: 75, medium: 50 };
    expect([95, 90, 80, 50, 10].map((s) => levelOf(s, cutoffs))).toEqual([
      'critical',
      'critical',
      'high',
      'medium',
      'low',
    ]);
  });
  it('holds a number between bounds, 0 and 1 unless said', () => {
    expect([clamp(-1), clamp(0.4), clamp(3), clamp(3, 0.1, 2)]).toEqual([0, 0.4, 1, 2]);
  });
  it('weighs comparing above learning', () => {
    expect(INTENT_WEIGHTS.comparison).toBeGreaterThan(INTENT_WEIGHTS['what-is']);
    expect(Object.isFrozen(INTENT_WEIGHTS)).toBe(true);
  });
});
