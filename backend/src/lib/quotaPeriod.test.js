import { describe, it, expect } from 'vitest';
import { anchoredPeriodStart, shiftMonthClamped } from './quotaPeriod.js';

const iso = (s) => new Date(s);

describe('shiftMonthClamped', () => {
  it('shifts by whole months on plain days', () => {
    expect(shiftMonthClamped(iso('2026-08-21T10:00:00Z'), -1).toISOString()).toBe(
      '2026-07-21T10:00:00.000Z',
    );
    expect(shiftMonthClamped(iso('2026-07-21T10:00:00Z'), 1).toISOString()).toBe(
      '2026-08-21T10:00:00.000Z',
    );
  });

  it('clamps to the shorter month instead of overflowing', () => {
    // Mar 31 − 1 month → Feb 28 (2026 is not a leap year), NOT Mar 3.
    expect(shiftMonthClamped(iso('2026-03-31T00:00:00Z'), -1).toISOString()).toBe(
      '2026-02-28T00:00:00.000Z',
    );
    expect(shiftMonthClamped(iso('2024-03-31T00:00:00Z'), -1).toISOString()).toBe(
      '2024-02-29T00:00:00.000Z',
    );
    expect(shiftMonthClamped(iso('2026-01-31T00:00:00Z'), 1).toISOString()).toBe(
      '2026-02-28T00:00:00.000Z',
    );
  });

  it('crosses year boundaries', () => {
    expect(shiftMonthClamped(iso('2026-01-15T00:00:00Z'), -1).toISOString()).toBe(
      '2025-12-15T00:00:00.000Z',
    );
  });
});

describe('anchoredPeriodStart', () => {
  it('returns the current billing period start for a monthly subscription', () => {
    // Renewed today: period ends Aug 21, so the window started Jul 21.
    const start = anchoredPeriodStart(iso('2026-08-21T09:00:00Z'), iso('2026-07-21T12:00:00Z'));
    expect(start.toISOString()).toBe('2026-07-21T09:00:00.000Z');
  });

  it('mid-period: now well inside the window', () => {
    const start = anchoredPeriodStart(iso('2026-08-21T09:00:00Z'), iso('2026-08-10T00:00:00Z'));
    expect(start.toISOString()).toBe('2026-07-21T09:00:00.000Z');
  });

  it('webhook lag: ends_at still in the past right after renewal', () => {
    // Renewal fired but the webhook has not updated ends_at yet — the
    // current window must start today, not last month.
    const start = anchoredPeriodStart(iso('2026-07-21T09:00:00Z'), iso('2026-07-21T12:00:00Z'));
    expect(start.toISOString()).toBe('2026-07-21T09:00:00.000Z');
  });

  it('annual billing: ends_at far in the future still yields a monthly window', () => {
    const start = anchoredPeriodStart(iso('2027-07-21T09:00:00Z'), iso('2026-11-05T00:00:00Z'));
    expect(start.toISOString()).toBe('2026-10-21T09:00:00.000Z');
  });

  it('a trial bought now: the window starts at the purchase, leaving the trial behind', () => {
    // In the trial, ends_at is the trial's end and the window covers the
    // whole trial. Bought on Oct 20 at 15:30, Stripe ends the trial and the
    // first period runs to Nov 20: the window starts at the purchase, so the
    // AI usage (and every monthly quota) of the trial no longer counts.
    const trial = anchoredPeriodStart(iso('2026-10-29T08:00:00Z'), iso('2026-10-20T15:30:00Z'));
    expect(trial.toISOString()).toBe('2026-09-29T08:00:00.000Z');
    const bought = anchoredPeriodStart(iso('2026-11-20T15:30:00Z'), iso('2026-10-20T15:30:05Z'));
    expect(bought.toISOString()).toBe('2026-10-20T15:30:00.000Z');
  });

  it('anchor day clamping across short months', () => {
    // Billing day 31: the window containing mid-March starts on Feb 28.
    const start = anchoredPeriodStart(iso('2026-03-31T00:00:00Z'), iso('2026-03-15T00:00:00Z'));
    expect(start.toISOString()).toBe('2026-02-28T00:00:00.000Z');
  });
});
