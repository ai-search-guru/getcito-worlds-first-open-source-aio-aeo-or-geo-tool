import { describe, expect, it } from 'vitest';
import { ctrPct, googlePagesWindow, impressionsRise } from './trafficGooglePages';

/** Is AI taking Google clicks? (AT-008, spec §3.6): the days compared and the figures. */

const NOW = Date.parse('2026-10-19T09:30:00.000Z');

describe('googlePagesWindow', () => {
  it('keeps a rolling range as whole days ending on its last', () => {
    expect(googlePagesWindow('2026-10-12T09:30:00.000Z', '2026-10-19T09:30:00.000Z')).toEqual({
      since: '2026-10-13',
      until: '2026-10-19',
    });
    expect(googlePagesWindow('2026-10-18T09:30:00.000Z', undefined, NOW)).toEqual({
      since: '2026-10-19',
      until: '2026-10-19',
    });
    expect(googlePagesWindow('2026-09-19T09:30:00.000Z', undefined, NOW).since).toBe('2026-09-20');
  });

  it('reads a custom range as its days', () => {
    expect(googlePagesWindow('2026-08-01', '2026-08-31T23:59:59.999Z')).toEqual({
      since: '2026-08-01',
      until: '2026-08-31',
    });
  });

  it('has no first day for all time', () => {
    expect(googlePagesWindow(undefined, undefined, NOW)).toEqual({
      since: null,
      until: '2026-10-19',
    });
  });
});

describe('impressionsRise and ctrPct', () => {
  it('reads the rise in impressions and the CTR as the table shows them', () => {
    expect(impressionsRise({ impressions: 1420, prevImpressions: 1000 })).toBe(42);
    expect(ctrPct(31, 1000)).toBe(3.1);
    expect(ctrPct(14, 1000)).toBe(1.4);
    expect(ctrPct(3, 0)).toBeNull();
  });
});
