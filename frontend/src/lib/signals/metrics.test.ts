import { describe, expect, it } from 'vitest';
import { signalChangeTone, signedPercent, type SignalMetric } from './metrics';

describe('signalChangeTone', () => {
  it('shows a change in how many signals there are as neutral, either way', () => {
    for (const metric of ['total', 'important', 'new'] as SignalMetric[]) {
      expect(signalChangeTone(metric, 878)).toBe('neutral');
      expect(signalChangeTone(metric, -40)).toBe('neutral');
    }
  });

  it('shows more resolved as good, and fewer as neutral', () => {
    expect(signalChangeTone('resolved', 1300)).toBe('positive');
    expect(signalChangeTone('resolved', -25)).toBe('neutral');
    expect(signalChangeTone('resolved', 0)).toBe('neutral');
  });
});

describe('signedPercent', () => {
  it('says which way the count went', () => {
    expect([550, -40, 0].map(signedPercent)).toEqual(['+550%', '−40%', '0%']);
  });
});
