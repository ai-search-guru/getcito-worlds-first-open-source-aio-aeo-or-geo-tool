import { describe, expect, it } from 'vitest';
import { toPlanId } from './plans';

describe('toPlanId', () => {
  it('keeps a known plan', () => {
    expect(toPlanId('growth')).toBe('growth');
  });

  it("reads a new sign-up's free or empty plan as Starter's", () => {
    expect(toPlanId('free')).toBe('starter');
    expect(toPlanId(null)).toBe('starter');
    expect(toPlanId(undefined)).toBe('starter');
  });
});
