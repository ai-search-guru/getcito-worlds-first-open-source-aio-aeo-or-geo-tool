import { describe, expect, it, vi } from 'vitest';

vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const { minutesSince } = await import('./useRecentAudit');

describe('minutesSince', () => {
  const now = Date.parse('2026-10-31T10:10:00.000Z');

  it('says whole minutes since an audit finished, at least one', () => {
    expect(minutesSince('2026-10-31T10:06:20.000Z', now)).toBe(4);
    expect(minutesSince('2026-10-31T10:09:50.000Z', now)).toBe(1);
  });

  it('says one for a time it cannot read', () => {
    expect(minutesSince('not a date', now)).toBe(1);
  });
});
