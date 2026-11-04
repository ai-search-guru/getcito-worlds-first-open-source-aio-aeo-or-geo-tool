import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDateRange } from './dateRange';

afterEach(() => {
  vi.useRealTimers();
});

describe('getDateRange', () => {
  it('returns inclusive whole-day windows for 7d, 30d and 90d presets', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-20T12:00:00.000Z'));

    expect(getDateRange('7d', { from: '', to: '' })).toEqual({
      dateFrom: '2026-10-14T00:00:00.000Z',
      dateTo: undefined,
      days: { dayFrom: '2026-10-14', dayTo: '2026-10-20' },
    });
    expect(getDateRange('30d', { from: '', to: '' })).toEqual({
      dateFrom: '2026-09-21T00:00:00.000Z',
      dateTo: undefined,
      days: { dayFrom: '2026-09-21', dayTo: '2026-10-20' },
    });
    expect(getDateRange('90d', { from: '', to: '' })).toEqual({
      dateFrom: '2026-07-23T00:00:00.000Z',
      dateTo: undefined,
      days: { dayFrom: '2026-07-23', dayTo: '2026-10-20' },
    });
  });

  it('uses an empty days window for all-time rollup reads', () => {
    expect(getDateRange('all', { from: '', to: '' })).toEqual({
      dateFrom: undefined,
      dateTo: undefined,
      days: {},
    });
  });

  it('sets inclusive timestamp and day boundaries for custom ranges', () => {
    expect(getDateRange('custom', { from: '2026-10-01', to: '2026-10-05' })).toEqual({
      dateFrom: '2026-10-01T00:00:00.000Z',
      dateTo: '2026-10-05T23:59:59.999Z',
      days: { dayFrom: '2026-10-01', dayTo: '2026-10-05' },
    });
  });

  it('supports a partially selected custom range', () => {
    expect(getDateRange('custom', { from: '2026-10-01', to: '' })).toEqual({
      dateFrom: '2026-10-01T00:00:00.000Z',
      dateTo: undefined,
      days: { dayFrom: '2026-10-01', dayTo: undefined },
    });
  });

  it('keeps 24h as a rolling timestamp window without daily rollup bounds', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-20T12:00:00.000Z'));

    expect(getDateRange('24h', { from: '', to: '' })).toEqual({
      dateFrom: '2026-10-19T12:00:00.000Z',
      dateTo: undefined,
    });
  });
});
