import { describe, expect, it } from 'vitest';
import { detectAmazonShareDrop, type WeeklyAmazonShare } from './shoppingAmazonShareAlert';

function fixture(shares: number[], classifiedCards: number[] = [100, 100, 100, 100, 100]) {
  const firstWeek = Date.parse('2026-09-21T00:00:00.000Z');
  return shares.map((share, index): WeeklyAmazonShare => {
    const weekStart = new Date(firstWeek + index * 7 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const total = classifiedCards[index];
    return {
      weekStart,
      amazonCards: Math.round((share / 100) * total),
      classifiedCards: total,
    };
  });
}

describe('detectAmazonShareDrop', () => {
  it('alerts on a fall from 31% to 4% when every week has enough classified cards', () => {
    expect(detectAmazonShareDrop(fixture([31, 31, 31, 31, 4]))).toEqual({
      fromShare: 0.31,
      toShare: 0.04,
      baselineCards: 400,
      currentCards: 100,
    });
  });

  it('does not alert on ordinary weekly noise', () => {
    expect(detectAmazonShareDrop(fixture([31, 28, 33, 30, 26]))).toBeNull();
  });

  it('does not alert when the current week has fewer than 30 classified cards', () => {
    expect(
      detectAmazonShareDrop(fixture([31, 31, 31, 31, 4], [100, 100, 100, 100, 29])),
    ).toBeNull();
  });

  it('does not alert if any week in the four-week baseline has fewer than 30 cards', () => {
    expect(
      detectAmazonShareDrop(fixture([31, 31, 31, 31, 4], [100, 29, 100, 100, 100])),
    ).toBeNull();
  });

  it('does not alert unless the current share is below half of the baseline', () => {
    expect(detectAmazonShareDrop(fixture([31, 31, 31, 31, 16]))).toBeNull();
  });

  it('does not alert when the drop is below ten percentage points', () => {
    expect(detectAmazonShareDrop(fixture([20, 20, 20, 20, 11]))).toBeNull();
  });

  it('alerts at exactly ten percentage points despite floating-point representation', () => {
    expect(detectAmazonShareDrop(fixture([18, 18, 18, 18, 8]))).toEqual({
      fromShare: 0.18,
      toShare: 0.08,
      baselineCards: 400,
      currentCards: 100,
    });
  });

  it('requires five consecutive weeks', () => {
    const weeks = fixture([31, 31, 31, 31, 4]);
    weeks[2] = { ...weeks[2], weekStart: '2026-10-06' };
    expect(detectAmazonShareDrop(weeks)).toBeNull();
  });

  it('does not alert on malformed counts', () => {
    const weeks = fixture([31, 31, 31, 31, 4]);
    weeks[4] = { ...weeks[4], amazonCards: 101 };
    expect(detectAmazonShareDrop(weeks)).toBeNull();
  });
});
