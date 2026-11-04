import { afterEach, describe, expect, it, vi } from 'vitest';
import { isSubscriptionActive } from './plans';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('isSubscriptionActive', () => {
  it('counts an active plan and a trial, nothing else', () => {
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
    expect(isSubscriptionActive('active')).toBe(true);
    expect(isSubscriptionActive('trialing')).toBe(true);
    for (const status of ['canceled', 'past_due', 'incomplete', null, undefined]) {
      expect(isSubscriptionActive(status)).toBe(false);
    }
  });
});
