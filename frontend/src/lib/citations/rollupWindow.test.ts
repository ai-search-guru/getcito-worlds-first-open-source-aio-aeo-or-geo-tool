import { describe, expect, it } from 'vitest';
import { rollupDayWindow, runDayWindow } from './rollupWindow';

const NOW = new Date('2026-10-08T21:00:00Z');

describe('rollupDayWindow', () => {
  it('counts today in the 7, 30 and 90 day windows', () => {
    expect(rollupDayWindow({ datePreset: '7d' }, NOW)).toEqual({
      dayFrom: '2026-10-02',
      dayTo: '2026-10-08',
    });
    expect(rollupDayWindow({ datePreset: '30d' }, NOW)).toEqual({
      dayFrom: '2026-09-09',
      dayTo: '2026-10-08',
    });
    expect(rollupDayWindow({ datePreset: '90d' }, NOW)).toEqual({
      dayFrom: '2026-07-11',
      dayTo: '2026-10-08',
    });
  });

  it('leaves all time unbounded', () => {
    expect(rollupDayWindow({ datePreset: 'all' }, NOW)).toEqual({});
  });

  it('takes the days of a custom range', () => {
    expect(
      rollupDayWindow({ datePreset: 'custom', dateFrom: '2026-09-01', dateTo: '2026-09-15' }, NOW),
    ).toEqual({ dayFrom: '2026-09-01', dayTo: '2026-09-15' });
    expect(rollupDayWindow({ datePreset: 'custom', dateFrom: '2026-09-01' }, NOW)).toEqual({
      dayFrom: '2026-09-01',
      dayTo: undefined,
    });
  });

  it('asks for the latest run on the 24h view', () => {
    expect(rollupDayWindow({ datePreset: '24h' }, NOW)).toBe('latest-run');
  });

  it('sends a prompt filter to the raw functions', () => {
    expect(rollupDayWindow({ datePreset: '30d', promptIds: ['p1'] }, NOW)).toBeNull();
    expect(rollupDayWindow({ datePreset: '30d', promptIds: [] }, NOW)).not.toBeNull();
  });
});

describe('runDayWindow', () => {
  it('spans a run that crossed UTC midnight', () => {
    expect(
      runDayWindow({ started_at: '2026-10-07T23:40:00Z', completed_at: '2026-10-08T02:10:00Z' }),
    ).toEqual({ dayFrom: '2026-10-07', dayTo: '2026-10-08' });
  });
});
