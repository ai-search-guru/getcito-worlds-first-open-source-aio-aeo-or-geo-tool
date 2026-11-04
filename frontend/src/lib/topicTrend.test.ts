import { describe, expect, it } from 'vitest';
import { customUtcWindow, topicTrendDays, windowDayCount } from './topicTrend';

const NOW = Date.parse('2026-10-17T09:30:00Z');
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

describe('topicTrendDays', () => {
  it('has no days for a window under two days', () => {
    expect(topicTrendDays({ from: hoursAgo(24) }, NOW)).toEqual([]);
  });

  it("counts a rolling week's whole days back from today, not a clipped eighth", () => {
    expect(topicTrendDays({ from: hoursAgo(7 * 24) }, NOW)).toEqual([
      '2026-10-11',
      '2026-10-12',
      '2026-10-13',
      '2026-10-14',
      '2026-10-15',
      '2026-10-16',
      '2026-10-17',
    ]);
  });

  it('keeps a rolling week at 7 days when the server reads it a moment later', () => {
    expect(windowDayCount(NOW - 7 * 86_400_000, NOW + 2_000)).toBe(7);
    expect(topicTrendDays({ from: hoursAgo(7 * 24) }, NOW + 2_000)).toHaveLength(7);
  });

  it('ends a custom range on its own last day', () => {
    expect(
      topicTrendDays({ from: '2026-10-01T00:00:00Z', to: '2026-10-03T23:59:59Z' }, NOW),
    ).toEqual(['2026-10-01', '2026-10-02', '2026-10-03']);
  });

  it("reads a custom range's dates as whole UTC days, wherever the viewer is", () => {
    const window = customUtcWindow('2026-10-10', '2026-10-14', {
      // New York's day edges, as the date inputs resolve them there.
      from: '2026-10-10T04:00:00.000Z',
      to: '2026-10-15T03:59:59.999Z',
    });
    expect(window).toEqual({ from: '2026-10-10T00:00:00.000Z', to: '2026-10-14T23:59:59.999Z' });
    expect(topicTrendDays(window, NOW)).toEqual([
      '2026-10-10',
      '2026-10-11',
      '2026-10-12',
      '2026-10-13',
      '2026-10-14',
    ]);
  });
});
