import { describe, expect, it } from 'vitest';
import { percentageChange } from './metrics';

describe('percentageChange', () => {
  it('returns null when the previous period is zero', () => {
    expect(percentageChange(354, 0)).toBeNull();
  });

  it('keeps percentage semantics when the current period drops to zero', () => {
    expect(percentageChange(0, 25)).toBe(-100);
    expect(percentageChange(30, 20)).toBe(50);
  });
});
