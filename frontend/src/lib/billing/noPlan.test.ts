import { describe, expect, it } from 'vitest';
import { isNoPlan } from './noPlan';

/** A quota's 0 read without an active plan isn't "used up". */
describe('isNoPlan', () => {
  it('is true when the server marks the quota, or the workspace is read-only', () => {
    expect(isNoPlan({ noPlan: true })).toBe(true);
    expect(isNoPlan({ noPlan: true }, false)).toBe(true);
    expect(isNoPlan(null, true)).toBe(true);
    expect(isNoPlan({}, true)).toBe(true);
  });

  it('is false on an active plan, which never sends the field', () => {
    expect(isNoPlan({})).toBe(false);
    expect(isNoPlan({ noPlan: false })).toBe(false);
    expect(isNoPlan(null)).toBe(false);
    expect(isNoPlan(undefined, false)).toBe(false);
  });
});
