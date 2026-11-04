import { describe, expect, it } from 'vitest';
import { ENGINE_THRESHOLDS, resolve } from './actionEngine.js';

describe('ENGINE_THRESHOLDS', () => {
  /**
   * The point of the module. A threshold someone can reach into and change at
   * runtime is not a configuration surface — it is a shared mutable global
   * that happens to live in a config file.
   */
  it('cannot be mutated', () => {
    expect(Object.isFrozen(ENGINE_THRESHOLDS)).toBe(true);
    for (const group of Object.values(ENGINE_THRESHOLDS)) {
      expect(Object.isFrozen(group)).toBe(true);
    }
  });

  it('holds only numbers', () => {
    for (const [name, group] of Object.entries(ENGINE_THRESHOLDS)) {
      for (const [key, value] of Object.entries(group)) {
        expect(typeof value, `${name}.${key}`).toBe('number');
        expect(Number.isFinite(value), `${name}.${key}`).toBe(true);
      }
    }
  });

  /** Ratios are fractions. A ratio above 1 reads as a percentage someone
   *  forgot to divide, and would silently disable the guard it belongs to. */
  it('keeps every ratio between 0 and 1', () => {
    for (const [name, group] of Object.entries(ENGINE_THRESHOLDS)) {
      for (const [key, value] of Object.entries(group)) {
        if (!key.toLowerCase().endsWith('ratio')) continue;
        expect(value, `${name}.${key}`).toBeGreaterThan(0);
        expect(value, `${name}.${key}`).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('resolve', () => {
  it('returns the defaults when nothing overrides them', () => {
    expect(resolve()).toBe(ENGINE_THRESHOLDS);
    expect(resolve(undefined)).toBe(ENGINE_THRESHOLDS);
  });

  it('overrides one threshold and leaves its neighbours alone', () => {
    const tuned = resolve({ detection: { windowDays: 14 } });

    expect(tuned.detection.windowDays).toBe(14);
    expect(tuned.detection.visibilityDropPoints).toBe(
      ENGINE_THRESHOLDS.detection.visibilityDropPoints,
    );
  });

  it('leaves untouched groups whole', () => {
    const tuned = resolve({ detection: { windowDays: 14 } });

    expect(tuned.validation).toEqual(ENGINE_THRESHOLDS.validation);
    expect(tuned.noise).toEqual(ENGINE_THRESHOLDS.noise);
  });

  it('does not let a resolved set write back to the defaults', () => {
    const tuned = resolve({ noise: { restAfterCloseDays: 1 } });

    expect(tuned.noise.restAfterCloseDays).toBe(1);
    expect(ENGINE_THRESHOLDS.noise.restAfterCloseDays).not.toBe(1);
    expect(Object.isFrozen(tuned.noise)).toBe(true);
  });
});
