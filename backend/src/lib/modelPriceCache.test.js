import { afterEach, describe, expect, it } from 'vitest';
import {
  catalogIds,
  inTimeWindow,
  perMillion,
  priceInEffect,
  setSyncedPrices,
  syncedPriceFor,
  variesByTime,
} from './modelPriceCache.js';

/** The synced model prices, held in the process (CHAT-16 §A, 00404). */

afterEach(() => setSyncedPrices([]));

// Wednesday 2026-10-28 at 00:30, 01:30, 07:00 and 12:00 UTC, and Saturday 2026-10-31 at noon.
const WED_0030 = new Date('2026-10-28T00:30:00Z');
const WED_0130 = new Date('2026-10-28T01:30:00Z');
const WED_0700 = new Date('2026-10-28T07:00:00Z');
const WED_NOON = new Date('2026-10-28T12:00:00Z');
const SAT_NOON = new Date('2026-10-31T12:00:00Z');

/** OpenRouter's shapes, as the 2026-10-29 catalog lists them. */
const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
const OFF_PEAK = { prompt: '0.00000066', completion: '0.00000198' };
const PEAK = { prompt: '0.00000132', completion: '0.00000396' };
const DEEPSEEK = {
  model_id: 'deepseek/deepseek-v4-pro-0813',
  input_per_m: 0.66,
  output_per_m: 1.98,
  overrides: [
    { utc_days: ['saturday', 'sunday'], ...OFF_PEAK },
    { utc_days: WEEKDAYS, utc_start: 0, utc_end: 100, ...OFF_PEAK },
    { utc_days: WEEKDAYS, utc_start: 100, utc_end: 400, ...PEAK },
    { utc_days: WEEKDAYS, utc_start: 400, utc_end: 600, ...OFF_PEAK },
    { utc_days: WEEKDAYS, utc_start: 600, utc_end: 1000, ...PEAK },
    { utc_days: WEEKDAYS, utc_start: 1000, utc_end: 0, ...OFF_PEAK },
  ],
};
const HAIKU = {
  model_id: 'anthropic/claude-haiku-5.5',
  input_per_m: 0.1,
  output_per_m: 0.5,
  overrides: [{ min_prompt_tokens: 100000, prompt: '0.0000005', completion: '0.0000025' }],
};

describe('perMillion', () => {
  it('reads a per-token price as USD per million tokens, and none for a variable one', () => {
    expect(perMillion('0.000002')).toBeCloseTo(2);
    expect(perMillion('0')).toBe(0);
    expect(perMillion('-1')).toBeNull();
    expect(perMillion(undefined)).toBeNull();
    expect(perMillion('')).toBeNull();
  });
});

describe('inTimeWindow', () => {
  const nights = { utc_days: ['monday', 'wednesday'], utc_start: 0, utc_end: 100 };
  it('applies on its days, inside its HHMM window, the end left out', () => {
    expect(inTimeWindow(nights, WED_0030)).toBe(true);
    expect(inTimeWindow(nights, WED_0130)).toBe(false);
    expect(inTimeWindow(nights, new Date('2026-10-28T01:00:00Z'))).toBe(false);
    expect(inTimeWindow(nights, new Date('2026-10-29T00:30:00Z'))).toBe(false);
  });

  it('applies all day on days without a window, and every day for a window without days', () => {
    expect(inTimeWindow({ utc_days: ['Saturday'] }, SAT_NOON)).toBe(true);
    expect(inTimeWindow({ utc_start: 1100, utc_end: 1600 }, SAT_NOON)).toBe(true);
  });

  it('runs a window past midnight when it ends before it starts, and to midnight at an end of 0', () => {
    const overnight = { utc_start: 2200, utc_end: 200 };
    expect(inTimeWindow(overnight, new Date('2026-10-28T23:30:00Z'))).toBe(true);
    expect(inTimeWindow(overnight, WED_0130)).toBe(true);
    expect(inTimeWindow(overnight, SAT_NOON)).toBe(false);
    const evening = { utc_start: 1600, utc_end: 0 };
    expect(inTimeWindow(evening, new Date('2026-10-28T23:59:00Z'))).toBe(true);
    expect(inTimeWindow(evening, WED_NOON)).toBe(false);
  });
});

describe('priceInEffect', () => {
  it('takes the time override whose window it is', () => {
    const at = (now) => priceInEffect(DEEPSEEK, { now });
    expect(at(WED_0030)).toEqual({ input: expect.closeTo(0.66), output: expect.closeTo(1.98) });
    expect(at(WED_0130)).toEqual({ input: expect.closeTo(1.32), output: expect.closeTo(3.96) });
    expect(at(WED_0700).input).toBeCloseTo(1.32);
    expect(at(WED_NOON).input).toBeCloseTo(0.66);
    expect(at(SAT_NOON).input).toBeCloseTo(0.66);
  });

  it('keeps the base price where no time override applies', () => {
    const nightsOnly = { ...DEEPSEEK, overrides: [DEEPSEEK.overrides[2]] };
    expect(priceInEffect(nightsOnly, { now: WED_NOON })).toEqual({ input: 0.66, output: 1.98 });
  });

  it('takes the prompt-size price for a call that large, and not below it', () => {
    expect(priceInEffect(HAIKU, { promptTokens: 7000 })).toEqual({ input: 0.1, output: 0.5 });
    expect(priceInEffect(HAIKU, { promptTokens: 100000 })).toEqual({
      input: expect.closeTo(0.5),
      output: expect.closeTo(2.5),
    });
  });

  it("keeps the cache-read rate, an override's own, or one raised with the input rate", () => {
    const cached = { ...HAIKU, cache_read_per_m: 0.01 };
    expect(priceInEffect(cached, { promptTokens: 7000 })).toEqual({
      input: 0.1,
      output: 0.5,
      cacheRead: 0.01,
    });
    // The prompt-size override raises the input 5x and names no cache-read rate: 5x too.
    expect(priceInEffect(cached, { promptTokens: 100000 }).cacheRead).toBeCloseTo(0.05);
    const own = {
      ...cached,
      overrides: [{ ...HAIKU.overrides[0], input_cache_read: '0.00000003' }],
    };
    expect(priceInEffect(own, { promptTokens: 100000 }).cacheRead).toBeCloseTo(0.03);
    // A cheaper window lowers the input, never the cache-read rate.
    const peak = { ...DEEPSEEK, input_per_m: 1.32, output_per_m: 3.96, cache_read_per_m: 0.1 };
    expect(priceInEffect(peak, { now: WED_0030 })).toMatchObject({
      input: expect.closeTo(0.66),
      cacheRead: expect.closeTo(0.1),
    });
  });

  it('gives none without a base price (a variable-priced router)', () => {
    expect(
      priceInEffect({ model_id: 'openrouter/auto', input_per_m: null, output_per_m: null }),
    ).toBeNull();
    expect(priceInEffect(null)).toBeNull();
  });

  it('says a model varies by the hour only for a time override', () => {
    expect(variesByTime(DEEPSEEK)).toBe(true);
    expect(variesByTime(HAIKU)).toBe(false);
  });
});

describe('syncedPriceFor and catalogIds', () => {
  it("finds a model under OpenRouter's id, its prefix or a hyphened version", () => {
    expect(catalogIds('openrouter/anthropic/claude-haiku-5-5')).toEqual([
      'anthropic/claude-haiku-5-5',
      'anthropic/claude-haiku-5.5',
    ]);
    setSyncedPrices([HAIKU]);
    expect(syncedPriceFor('anthropic/claude-haiku-5.5')).toEqual({ input: 0.1, output: 0.5 });
    expect(syncedPriceFor('anthropic/claude-haiku-5-5')).toEqual({ input: 0.1, output: 0.5 });
    expect(syncedPriceFor('openrouter/anthropic/claude-haiku-5.5')).toEqual({
      input: 0.1,
      output: 0.5,
    });
    expect(syncedPriceFor('google/gemini-3-flash')).toBeNull();
  });
});
