import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TRAFFIC_PRESET,
  TRAFFIC_RANGE_KEY,
  readTrafficRange,
  writeTrafficRange,
} from './trafficRange';
import { isHourlyWindow, listUtcHours, utcHourKey } from './trafficBuckets';

/** AT-017: the page opens on the last 24 hours, or the member's last range. */

function memoryStorage(initial?: string) {
  const values = new Map<string, string>(
    initial === undefined ? [] : [[TRAFFIC_RANGE_KEY, initial]],
  );
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    values,
  };
}

describe('readTrafficRange', () => {
  it('opens on the last 24 hours the first time', () => {
    expect(DEFAULT_TRAFFIC_PRESET).toBe('24h');
    expect(readTrafficRange(memoryStorage())).toEqual({ preset: '24h', from: '', to: '' });
    expect(readTrafficRange(null)).toEqual({ preset: '24h', from: '', to: '' });
  });

  it('opens on the last range chosen', () => {
    expect(readTrafficRange(memoryStorage('{"preset":"30d"}'))).toEqual({
      preset: '30d',
      from: '',
      to: '',
    });
    expect(
      readTrafficRange(memoryStorage('{"preset":"custom","from":"2026-10-01","to":"2026-10-10"}')),
    ).toEqual({ preset: 'custom', from: '2026-10-01', to: '2026-10-10' });
  });

  it('falls back to 24 hours on anything it cannot read', () => {
    const fallback = { preset: '24h', from: '', to: '' };
    expect(readTrafficRange(memoryStorage('not json'))).toEqual(fallback);
    expect(readTrafficRange(memoryStorage('{"preset":"1y"}'))).toEqual(fallback);
    const blocked = {
      getItem: () => {
        throw new Error('SecurityError');
      },
    };
    expect(readTrafficRange(blocked)).toEqual(fallback);
  });

  it("keeps a custom range's days only when they are days", () => {
    expect(
      readTrafficRange(memoryStorage('{"preset":"custom","from":"yesterday","to":"2026-10-10"}')),
    ).toEqual({ preset: 'custom', from: '', to: '2026-10-10' });
  });
});

describe('writeTrafficRange', () => {
  it('stores a preset, and a custom range with its days', () => {
    const storage = memoryStorage();
    writeTrafficRange(storage, { preset: '7d', from: '2026-10-01', to: '' });
    expect(JSON.parse(storage.values.get(TRAFFIC_RANGE_KEY)!)).toEqual({
      preset: '7d',
      from: '',
      to: '',
    });
    writeTrafficRange(storage, { preset: 'custom', from: '2026-10-01', to: '2026-10-10' });
    expect(readTrafficRange(storage)).toEqual({
      preset: 'custom',
      from: '2026-10-01',
      to: '2026-10-10',
    });
  });

  it('does nothing when storage refuses the write', () => {
    const full = {
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    expect(() => writeTrafficRange(full, { preset: '24h', from: '', to: '' })).not.toThrow();
  });
});

describe('trend buckets', () => {
  it('reads a day or less hour by hour, and longer windows by day', () => {
    const to = '2026-10-18T13:00:00.000Z';
    expect(isHourlyWindow('2026-10-17T13:00:00.000Z', to)).toBe(true);
    expect(isHourlyWindow('2026-10-11T13:00:00.000Z', to)).toBe(false);
    // All time has no start.
    expect(isHourlyWindow(undefined, to)).toBe(false);
  });

  it('lists every hour of the last 24, on the hour', () => {
    const hours = listUtcHours('2026-10-17T13:25:00.000Z', '2026-10-18T13:25:00.000Z');
    expect(hours).toHaveLength(25);
    expect(hours[0]).toBe('2026-10-17T13:00:00.000Z');
    expect(hours[24]).toBe('2026-10-18T13:00:00.000Z');
  });

  it('puts a visit in the hour it happened', () => {
    expect(utcHourKey('2026-10-17T09:30:12.123+00:00')).toBe('2026-10-17T09:00:00.000Z');
  });
});
