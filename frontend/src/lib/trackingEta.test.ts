import { describe, expect, it } from 'vitest';
import { PACE_WINDOW_MS, etaParts, minutesLeft, withSample } from './trackingEta';

/** "About N min left" for a tracking run, from the pace its checks finish at. */

const MIN = 60_000;

describe('withSample', () => {
  it('keeps a reading only when the count moved, within the pace window', () => {
    let samples = withSample([], { at: 0, current: 0 });
    samples = withSample(samples, { at: MIN, current: 0 });
    expect(samples).toEqual([{ at: 0, current: 0 }]);
    samples = withSample(samples, { at: 2 * MIN, current: 10 });
    // The first reading falls out of the window; the one at 2 min stays.
    samples = withSample(samples, { at: PACE_WINDOW_MS + MIN, current: 20 });
    expect(samples).toEqual([
      { at: 2 * MIN, current: 10 },
      { at: PACE_WINDOW_MS + MIN, current: 20 },
    ]);
  });

  it('starts over when the count goes back (a new run)', () => {
    expect(withSample([{ at: 0, current: 40 }], { at: MIN, current: 2 })).toEqual([
      { at: MIN, current: 2 },
    ]);
  });
});

describe('minutesLeft', () => {
  const samples = [
    { at: 0, current: 100 },
    { at: 2 * MIN, current: 120 },
  ];

  it('reads the pace of the last minutes: 20 checks in 2 min, 180 left, about 18 min', () => {
    expect(minutesLeft(samples, 300, 2 * MIN)).toBe(18);
  });

  it('says nothing without enough to go on', () => {
    expect(minutesLeft([{ at: 0, current: 100 }], 300, 0)).toBeNull();
    // Under a minute apart, or fewer than 5 checks done.
    expect(minutesLeft([samples[0], { at: 30_000, current: 140 }], 300, 30_000)).toBeNull();
    expect(minutesLeft([samples[0], { at: 2 * MIN, current: 103 }], 300, 2 * MIN)).toBeNull();
    // Done, or no total.
    expect(minutesLeft([samples[0], { at: 2 * MIN, current: 300 }], 300, 2 * MIN)).toBeNull();
    expect(minutesLeft(samples, 0, 2 * MIN)).toBeNull();
  });

  it('says nothing once the count has been still for the pace window', () => {
    expect(minutesLeft(samples, 300, 2 * MIN + PACE_WINDOW_MS + 1)).toBeNull();
  });

  it('never says less than a minute', () => {
    expect(minutesLeft([samples[0], { at: 2 * MIN, current: 299 }], 300, 2 * MIN)).toBe(1);
  });
});

describe('etaParts', () => {
  it('reads minutes up to 90, to the nearest 5 past 10, and hours past it', () => {
    expect(etaParts(4)).toEqual({ minutes: 4 });
    expect(etaParts(18)).toEqual({ minutes: 20 });
    expect(etaParts(90)).toEqual({ minutes: 90 });
    expect(etaParts(125)).toEqual({ hours: 2 });
  });
});
