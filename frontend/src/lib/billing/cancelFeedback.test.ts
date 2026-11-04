import { describe, expect, it } from 'vitest';
import { canWait, waitUntil } from './cancelFeedback';

describe('waiting three days before cancelling', () => {
  const now = new Date('2026-10-21T12:00:00Z');

  it('is answered three days on', () => {
    expect(waitUntil(now).toISOString()).toBe('2026-10-24T12:00:00.000Z');
  });

  it('is offered only when the plan renews a day or more after the team has answered', () => {
    expect(canWait('2026-10-30T00:00:00Z', now)).toBe(true);
    expect(canWait('2026-10-25T12:00:01Z', now)).toBe(true);
    // A minute after the three days: no time left to cancel after hearing back.
    expect(canWait('2026-10-24T12:01:00Z', now)).toBe(false);
    expect(canWait('2026-10-25T12:00:00Z', now)).toBe(false);
    expect(canWait('2026-10-23T00:00:00Z', now)).toBe(false);
  });

  it('isn’t offered without a known period end', () => {
    expect(canWait(null, now)).toBe(false);
    expect(canWait('not a date', now)).toBe(false);
  });
});
