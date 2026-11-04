import { describe, expect, it } from 'vitest';
import {
  DEMO_SETUP_STEPS,
  DONE_PAUSE_MS,
  FINISH_STEP_MS,
  finishDelay,
  setupPosition,
  stepCount,
  stepState,
  type DemoSetupStep,
} from './setupSteps';

/**
 * The demo's setup screen: on plan while POST /api/demo writes the demo,
 * holding on the last step until it answers, then through the rest quickly.
 */

const STEPS: DemoSetupStep[] = [
  { key: 'brand', ms: 1000 },
  { key: 'answers', ms: 2000, count: 720 },
  { key: 'reports', ms: 1000, count: 2 },
];

describe('DEMO_SETUP_STEPS', () => {
  it('tells what the generator writes, in its order, in about the time a first build takes', () => {
    expect(DEMO_SETUP_STEPS.map((s) => s.key)).toEqual([
      'brand',
      'answers',
      'citations',
      'mentions',
      'audit',
      'actions',
      'content',
      'reports',
    ]);
    expect(Object.fromEntries(DEMO_SETUP_STEPS.map((s) => [s.key, s.count ?? null]))).toEqual({
      brand: null,
      answers: 720,
      citations: 2694,
      mentions: null,
      audit: 18,
      actions: 9,
      content: 10,
      reports: 2,
    });
    const total = DEMO_SETUP_STEPS.reduce((ms, s) => ms + s.ms, 0);
    expect(total).toBeGreaterThan(10_000);
    expect(total).toBeLessThan(16_000);
  });
});

describe('setupPosition', () => {
  it('moves through the steps on plan while the answer is awaited', () => {
    expect(setupPosition(0, null, STEPS)).toBe(0);
    expect(setupPosition(500, null, STEPS)).toBe(0.5);
    expect(setupPosition(1000, null, STEPS)).toBe(1);
    expect(setupPosition(2000, null, STEPS)).toBe(1.5);
    expect(setupPosition(3500, null, STEPS)).toBe(2.5);
  });

  it('holds on the last step, never done, however long the answer takes', () => {
    expect(setupPosition(3900, null, STEPS)).toBeCloseTo(2.9);
    expect(setupPosition(60_000, null, STEPS)).toBeCloseTo(2.9);
    expect(stepState(2, setupPosition(60_000, null, STEPS)).state).toBe('now');
  });

  it('runs through what is left once the answer came early', () => {
    // Answered half way through the answers.
    expect(setupPosition(2000, 2000, STEPS)).toBe(1.5);
    expect(setupPosition(2000 + FINISH_STEP_MS, 2000, STEPS)).toBeCloseTo(2.5);
    expect(setupPosition(2000 + 10 * FINISH_STEP_MS, 2000, STEPS)).toBe(STEPS.length);
  });

  it('ends at once from the last step when the answer came late', () => {
    expect(setupPosition(60_000 + 0.1 * FINISH_STEP_MS, 60_000, STEPS)).toBeCloseTo(3);
  });

  it('starts where a setup asked ahead already is', () => {
    // Asked on the first onboarding step, opened 2.5 s later.
    expect(stepState(1, setupPosition(2500, null, STEPS))).toEqual({
      state: 'now',
      progress: 0.75,
    });
    expect(stepState(0, setupPosition(2500, null, STEPS)).state).toBe('done');
  });
});

describe('finishDelay', () => {
  it('is the steps left at FINISH_STEP_MS each, then a pause on everything done', () => {
    const near = (ms: number, expected: number) => expect(Math.abs(ms - expected)).toBeLessThan(2);
    near(finishDelay(2000, STEPS), 1.5 * FINISH_STEP_MS + DONE_PAUSE_MS);
    near(finishDelay(60_000, STEPS), 0.1 * FINISH_STEP_MS + DONE_PAUSE_MS);
    // It agrees with the screen: done right then.
    expect(setupPosition(2000 + finishDelay(2000, STEPS) - DONE_PAUSE_MS, 2000, STEPS)).toBe(3);
  });
});

describe('stepCount', () => {
  const answers = STEPS[1];

  it('counts up while the step is under way, whole once it is done, nothing before', () => {
    expect(stepCount(STEPS[0], 0, 0.5)).toBeNull();
    expect(stepCount(answers, 1, 0.5)).toBeNull();
    expect(stepCount(answers, 1, 1)).toBe(0);
    const half = stepCount(answers, 1, 1.5)!;
    expect(half).toBeGreaterThan(360);
    expect(half).toBeLessThan(720);
    expect(stepCount(answers, 1, 1.99)).toBeLessThanOrEqual(720);
    expect(stepCount(answers, 1, 2)).toBe(720);
    expect(stepCount(answers, 1, 3)).toBe(720);
  });

  it('shows the whole count at once with reduced motion', () => {
    expect(stepCount(answers, 1, 1.1, true)).toBe(720);
    expect(stepCount(answers, 1, 0.5, true)).toBeNull();
  });
});
