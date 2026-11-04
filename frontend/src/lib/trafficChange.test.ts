import { describe, expect, it } from 'vitest';
import { LOW_SAMPLE_VISITS, visitChange } from './trafficChange';

describe('visitChange', () => {
  it('shows a % once both periods have 30 visits', () => {
    expect(LOW_SAMPLE_VISITS).toBe(30);
    expect(visitChange(45, 30)).toEqual({ kind: 'pct', pct: 50 });
    expect(visitChange(30, 60)).toEqual({ kind: 'pct', pct: -50 });
  });

  it('says Low sample instead of a big % on a few visits (F4)', () => {
    // The live page: +367% on 14 visits, −65% on 11.
    expect(visitChange(14, 3)).toEqual({ kind: 'low' });
    expect(visitChange(11, 31)).toEqual({ kind: 'low' });
    expect(visitChange(29, 100)).toEqual({ kind: 'low' });
  });

  it('says Low sample when the previous period is the small one', () => {
    // 40 against 3 would read +1,233%.
    expect(visitChange(40, 3)).toEqual({ kind: 'low' });
  });

  it('calls visits after none "new", however few', () => {
    expect(visitChange(1, 0)).toEqual({ kind: 'new' });
    expect(visitChange(120, 0)).toEqual({ kind: 'new' });
  });

  it('shows no change with no visits, no previous period, or the same count', () => {
    expect(visitChange(0, 0)).toEqual({ kind: 'none' });
    expect(visitChange(50, 0, { comparable: false })).toEqual({ kind: 'none' });
    expect(visitChange(50, 50)).toEqual({ kind: 'none' });
  });
});
