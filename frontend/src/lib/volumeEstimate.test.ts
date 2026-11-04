import { describe, expect, it } from 'vitest';
import {
  averageEstimate,
  formatEstimateRange,
  guessedVolumeEstimate,
  keywordVolumeEstimate,
  promptVolumeEstimate,
  rankable,
  sumEstimates,
} from './volumeEstimate';

const NOW = new Date('2026-10-22T12:00:00Z');

/** A prompt's volume row: its keywords' Google volumes at the 45% rate. */
const row = (
  googleVolumes: Record<string, number>,
  estAiVolume: number,
  fetchedAt = '2026-10-10T19:28:41Z',
) => ({
  estAiVolume,
  googleVolumes,
  aiVolumeMultiplier: 0.45,
  keywords: Object.keys(googleVolumes),
  fetchedAt,
});

describe('promptVolumeEstimate', () => {
  it('is high when three or more keywords have data and their middle half agrees within 4×', () => {
    const e = promptVolumeEstimate(row({ office: 3600, business: 1600, monthly: 1900 }, 855), NOW);
    expect(e).toMatchObject({ confidence: 'high', measured: 3, keywords: 3, value: 855 });
    // The quartiles 1,750–2,750 × 45%, widened to at least ±25% and rounded outwards.
    expect([e.low, e.high]).toEqual([640, 1300]);
    expect(formatEstimateRange(e)).toBe('640–1.3k');
  });

  it('is medium when their middle half differs by more, and spans it', () => {
    const e = promptVolumeEstimate(row({ a: 400, b: 2000, c: 10_000 }, 900), NOW);
    // Quartiles 1,200 and 6,000: 5× apart.
    expect(e.confidence).toBe('medium');
    // 540–2,700 × 45%, kept within ½× to 2× of 900.
    expect([e.low, e.high]).toEqual([540, 1800]);
    expect(formatEstimateRange(e)).toBe('540–1.8k');
  });

  it('reads past one broad head term, which the median already ignores', () => {
    // Five keywords with data, one of them far broader: still medium.
    const five = promptVolumeEstimate(row({ a: 10, b: 170, c: 210, d: 900, e: 27_100 }, 95), NOW);
    expect(five.confidence).toBe('medium');
    expect(formatEstimateRange(five)).toBe('71–190');
    // A prod row: two keywords without data, three left 170, 210 and 27,100.
    // With three, the broad one is half the upper quartile: low.
    const three = promptVolumeEstimate(row({ a: 0, b: 0, c: 170, d: 210, e: 27_100 }, 95), NOW);
    expect(three).toMatchObject({ confidence: 'low', measured: 3, keywords: 5 });
    expect(formatEstimateRange(three)).toBe('71–190');
  });

  it('is low with one keyword to go by, or volumes 10× apart', () => {
    const one = promptVolumeEstimate(row({ a: 2000, b: 0, c: 0 }, 900), NOW);
    expect(one).toMatchObject({ confidence: 'low', measured: 1, keywords: 3 });
    // ×½ to ×2 with nothing to compare against.
    expect([one.low, one.high]).toEqual([450, 1800]);

    const apart = promptVolumeEstimate(row({ a: 100, b: 2000, c: 50_000 }, 900), NOW);
    expect(apart.confidence).toBe('low');
    // Never more than 2× from the estimate either way.
    expect([apart.low, apart.high]).toEqual([470, 1800]);
  });

  it('counts volumes over six months old one level less', () => {
    const e = promptVolumeEstimate(
      row({ office: 3600, business: 1600, monthly: 1900 }, 855, '2026-03-01T00:00:00Z'),
      NOW,
    );
    expect(e).toMatchObject({ confidence: 'medium', stale: true });
  });

  it('has nothing to range over when no keyword has data', () => {
    const e = promptVolumeEstimate(row({ a: 0, b: 0 }, 0), NOW);
    expect(e).toMatchObject({ confidence: 'low', low: 0, high: 0, measured: 0 });
    expect(formatEstimateRange(e)).toBe('0');
  });
});

describe('sumEstimates', () => {
  const high = promptVolumeEstimate(row({ a: 3600, b: 1600, c: 1900 }, 855), NOW);
  const medium = promptVolumeEstimate(row({ a: 400, b: 2000, c: 10_000 }, 900), NOW);
  const low = promptVolumeEstimate(row({ a: 2000 }, 900), NOW);

  it('adds the lows and the highs, and dates it by the latest fetch', () => {
    const total = sumEstimates([high, medium]);
    expect(total).toMatchObject({
      value: 1755,
      low: 1180,
      high: 3100,
      count: 2,
      byConfidence: { high: 1, medium: 1, low: 0 },
    });
    expect(formatEstimateRange(total)).toBe('1.2–3.1k');
  });

  it('is as confident as most of its volume', () => {
    expect(sumEstimates([high]).confidence).toBe('high');
    // 49% of the volume is high, none low: medium.
    expect(sumEstimates([high, medium]).confidence).toBe('medium');
    // 900 of 1,755 is low: more than half.
    expect(sumEstimates([high, low]).confidence).toBe('low');
    expect(sumEstimates([]).confidence).toBe('low');
  });

  it('averages per prompt', () => {
    const avg = averageEstimate(sumEstimates([high, medium]));
    expect(avg).toMatchObject({ value: 878, low: 590, high: 1600 });
  });
});

describe('rankable', () => {
  it('leaves low-confidence estimates out of ranking on their own', () => {
    expect(rankable({ confidence: 'high' })).toBe(true);
    expect(rankable({ confidence: 'medium' })).toBe(true);
    expect(rankable({ confidence: 'low' })).toBe(false);
  });
});

describe('keywordVolumeEstimate', () => {
  it("is medium, ±25%, from one keyword's measured volume", () => {
    const e = keywordVolumeEstimate(22_200, 0.45, '2026-10-10T19:28:41Z', NOW);
    expect(e).toMatchObject({ basis: 'keyword', value: 9990, confidence: 'medium', measured: 1 });
    expect(formatEstimateRange(e)).toBe('7.4–13k');
  });

  it('is low with no volume, or over six months old', () => {
    expect(keywordVolumeEstimate(0, 0.45, '2026-10-10T19:28:41Z', NOW).confidence).toBe('low');
    expect(keywordVolumeEstimate(22_200, 0.45, '2026-03-01T00:00:00Z', NOW)).toMatchObject({
      confidence: 'low',
      stale: true,
    });
  });
});

describe('guessedVolumeEstimate', () => {
  it("is always low, half to twice an AI's guess", () => {
    const e = guessedVolumeEstimate(1200, '2026-10-22T08:00:00Z');
    expect(e).toMatchObject({ basis: 'guess', confidence: 'low', low: 600, high: 2400 });
    expect(formatEstimateRange(e)).toBe('600–2.4k');
  });
});
