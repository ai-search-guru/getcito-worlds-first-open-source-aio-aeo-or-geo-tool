/**
 * promptOptions.test.ts
 *
 * A custom date range covers whole days on the viewer's clock.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { resolvePromptRange } from './promptOptions';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-14T12:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('resolvePromptRange (custom)', () => {
  test('runs from the start of the first day to the end of the last, in the given zone', () => {
    expect(
      resolvePromptRange('custom', { from: '2026-10-01', to: '2026-10-03' }, 'Europe/Istanbul'),
    ).toEqual({
      from: '2026-09-30T21:00:00.000Z',
      to: '2026-10-03T20:59:59.999Z',
      days: 3,
    });
    expect(resolvePromptRange('custom', { from: '2026-10-01', to: '2026-10-03' }, 'UTC')).toEqual({
      from: '2026-10-01T00:00:00.000Z',
      to: '2026-10-03T23:59:59.999Z',
      days: 3,
    });
  });

  test('never reaches past now', () => {
    expect(
      resolvePromptRange('custom', { from: '2026-10-13', to: '2026-10-20' }, 'Europe/Istanbul').to,
    ).toBe('2026-10-14T12:00:00.000Z');
  });

  test('falls back to the furthest window when the start is missing or not a date', () => {
    const range = resolvePromptRange('custom', { from: 'nonsense', to: '2026-10-03' }, 'UTC');
    expect(range.days).toBe(90);
  });
});
