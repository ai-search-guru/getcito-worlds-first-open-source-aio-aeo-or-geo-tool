import { describe, expect, it } from 'vitest';
import {
  rateSamples,
  arrowChange,
  formatWindowBound,
  lowerIsGood,
  signedChange,
  signedValue,
  upIsGood,
} from './kpiFormat';

describe('KPI card formatting', () => {
  it('writes changes with a sign, and no change as ±0', () => {
    expect(signedChange(1.5)).toBe('+1.5');
    expect(signedChange(-3.2)).toBe('−3.2');
    expect(signedChange(0)).toBe('±0');
  });

  it('writes a zero value as 0, not as a change', () => {
    expect(signedValue(34)).toBe('+34');
    expect(signedValue(-6)).toBe('−6');
    expect(signedValue(0)).toBe('0');
  });

  it('colours a rise good and a fall bad on most cards', () => {
    expect(upIsGood(18, { percent: true })).toEqual({ text: '+18%', tone: 'good' });
    expect(upIsGood(-4)).toEqual({ text: '−4', tone: 'bad' });
    expect(upIsGood(0, { percent: true })).toEqual({ text: '±0', tone: 'neutral' });
    expect(upIsGood(null)).toBeNull();
  });

  it('writes every number in the UI’s locale (VIS-005)', () => {
    expect(signedChange(-1234.5, 'tr')).toBe('−1.234,5');
    expect(upIsGood(18.5, { percent: true, locale: 'tr' })?.text).toBe('+%18,5');
    expect(lowerIsGood(-0.3, 'tr')?.text).toBe('↑0,3');
    expect(arrowChange(4.1, 'tr')?.text).toBe('↑ 4,1');
    expect(formatWindowBound('2026-08-16', 'tr')).toBe('16 Ağu 2026');
  });

  it('reads a lower Avg. position as an improvement', () => {
    expect(lowerIsGood(-0.3)).toEqual({ text: '↑0.3', tone: 'good' });
    expect(lowerIsGood(0.5)).toEqual({ text: '↓0.5', tone: 'bad' });
    expect(lowerIsGood(0)).toEqual({ text: '±0', tone: 'neutral' });
  });

  it('writes a leaderboard change with an arrow', () => {
    expect(arrowChange(4.1)).toEqual({ text: '↑ 4.1', tone: 'good' });
    expect(arrowChange(-1.06)).toEqual({ text: '↓ 1.1', tone: 'bad' });
    expect(arrowChange(0)).toEqual({ text: '±0', tone: 'neutral' });
    expect(arrowChange(null)).toBeNull();
  });

  it('takes each rate over its own answers (VIS-005)', () => {
    const samples = rateSamples({ totalResults: 300, mentioningResults: 6, positionedResults: 4 });
    expect(samples.visibility).toEqual({ count: 300, of: 'all' });
    expect(samples.citationRate).toEqual({ count: 300, of: 'all' });
    // Net sentiment and Avg. position can be a low sample in a full period.
    expect(samples.netSentiment).toEqual({ count: 6, of: 'named' });
    expect(samples.avgPosition).toEqual({ count: 4, of: 'placed' });
  });

  it('labels whole-day windows by their UTC days', () => {
    // A day-only bound is the UTC day itself, whatever the viewer's zone.
    expect(formatWindowBound('2026-08-16')).toBe('Aug 16, 2026');
  });
});
