import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

// The module reaches the supabase admin client at import time, whose config
// hard-exits when SUPABASE_* env is absent (as in CI).
vi.mock('../config/supabase.js', () => ({ default: {} }));

import { fakeDb } from './catalog/__fixtures__/fakeDb.js';
import { logger } from './logger.js';
import { CITY_SCRAPERS } from './locations.js';
import {
  CLORO_COUNTRY_MODELS,
  countryCodesIn,
  fetchCloroCountries,
  loadSupportedCountries,
  refreshCloroCountries,
  supportedLocations,
  supportsCountry,
} from './cloroCountries.js';

/** The countries each tracking engine answers from (PROMPT-015e). */

const answer = (lists) =>
  vi.fn(async (url) => {
    const model = new URL(url).searchParams.get('model');
    const list = lists[model];
    if (list instanceof Error) throw list;
    if (list === 500) return { ok: false, status: 500, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => list ?? ['US'] };
  });

describe('fetchCloroCountries', () => {
  it("reads an engine's codes with the key, and nothing without one", async () => {
    const fetchImpl = answer({ chatgpt: ['us', 'GB', 'GB', 'xx1', 7] });
    expect(await fetchCloroCountries('chatgpt', { fetchImpl, apiKey: 'k' })).toEqual(['US', 'GB']);
    expect(fetchImpl.mock.calls[0][0]).toBe('https://api.cloro.dev/v1/countries?model=chatgpt');
    expect(fetchImpl.mock.calls[0][1].headers).toEqual({ Authorization: 'Bearer k' });
    expect(await fetchCloroCountries('chatgpt', { fetchImpl, apiKey: '' })).toBeNull();
  });

  it('reads an empty or malformed answer as no list, never as "no countries"', async () => {
    expect(
      await fetchCloroCountries('gemini', { fetchImpl: answer({ gemini: [] }), apiKey: 'k' }),
    ).toBeNull();
    expect(
      await fetchCloroCountries('gemini', {
        fetchImpl: answer({ gemini: { codes: [] } }),
        apiKey: 'k',
      }),
    ).toBeNull();
    await expect(
      fetchCloroCountries('gemini', { fetchImpl: answer({ gemini: 500 }), apiKey: 'k' }),
    ).rejects.toThrow('HTTP 500');
  });
});

describe('countryCodesIn', () => {
  it('reads the codes in each shape a list may come in', () => {
    expect(countryCodesIn(['us', ' GB ', 'GB', 'USA', 7, null])).toEqual(['US', 'GB']);
    expect(countryCodesIn({ countries: ['US', 'TR'] })).toEqual(['US', 'TR']);
    expect(countryCodesIn([{ code: 'us' }, { code: 'XYZ' }, { name: 'Peru' }])).toEqual(['US']);
    expect(countryCodesIn([{ country: 'TR', name: 'Türkiye' }, { country: 'de' }])).toEqual([
      'TR',
      'DE',
    ]);
    expect(countryCodesIn({ countries: [{ code: 'KE' }] })).toEqual(['KE']);
  });

  it('reads any other shape as no list', () => {
    for (const body of [null, 'US', 42, { codes: ['US'] }, { countries: 'US' }]) {
      expect(countryCodesIn(body)).toBeNull();
    }
  });
});

describe('fetchCloroCountries, in any shape', () => {
  it('reads a wrapped list and listed entries alike', async () => {
    const fetchImpl = answer({
      chatgpt: { countries: ['US', 'GB'] },
      gemini: [{ code: 'US' }, { code: 'KE' }],
      copilot: [{ country: 'TR' }],
    });
    expect(await fetchCloroCountries('chatgpt', { fetchImpl, apiKey: 'k' })).toEqual(['US', 'GB']);
    expect(await fetchCloroCountries('gemini', { fetchImpl, apiKey: 'k' })).toEqual(['US', 'KE']);
    expect(await fetchCloroCountries('copilot', { fetchImpl, apiKey: 'k' })).toEqual(['TR']);
  });

  it('says so, and keeps the last list, when an answer is in no known shape', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    try {
      const fetchImpl = answer({ gemini: { data: { list: ['US'] } } });
      expect(await fetchCloroCountries('gemini', { fetchImpl, apiKey: 'k' })).toBeNull();
      expect(warn).toHaveBeenCalledWith(
        { model: 'gemini', shape: 'object', keys: ['data'] },
        '[cloro-countries] answer holds no country codes; last list kept',
      );
    } finally {
      warn.mockRestore();
    }
  });
});

describe('refreshCloroCountries', () => {
  it('keeps a list that shrank by more than half, and takes one that shrank less', async () => {
    const fake = fakeDb();
    await refreshCloroCountries({
      db: fake.db,
      apiKey: 'k',
      now: new Date('2026-10-27T06:00:00Z'),
      fetchImpl: answer({
        chatgpt: ['US', 'GB', 'DE', 'FR', 'TR', 'JP'],
        aimode: ['US', 'GB', 'DE', 'FR'],
      }),
    });
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    try {
      const outcome = await refreshCloroCountries({
        db: fake.db,
        apiKey: 'k',
        now: new Date('2026-10-28T06:00:00Z'),
        // ChatGPT down to two of six: cut short. AI Mode two of four: half, taken.
        fetchImpl: answer({ chatgpt: ['US', 'GB'], aimode: ['US', 'GB'] }),
      });
      expect(outcome).toMatchObject({ chatgpt: 'kept', aimode: 2 });
      expect(warn).toHaveBeenCalledWith(
        { model: 'chatgpt', before: 6, now: 2 },
        '[cloro-countries] list shrank by more than half; last list kept',
      );
    } finally {
      warn.mockRestore();
    }
    const supported = await loadSupportedCountries({ db: fake.db });
    expect(supported.get('chatgpt').size).toBe(6);
    expect([...supported.get('aimode')].sort()).toEqual(['GB', 'US']);
  });

  it('writes each engine’s list, drops what it no longer lists, and keeps a list it could not read', async () => {
    const fake = fakeDb();
    const day1 = new Date('2026-10-27T06:00:00Z');
    await refreshCloroCountries({
      db: fake.db,
      apiKey: 'k',
      now: day1,
      fetchImpl: answer({ chatgpt: ['US', 'GB', 'CZ'], copilot: ['US', 'BR'] }),
    });
    const day2 = new Date('2026-10-28T06:00:00Z');
    const outcome = await refreshCloroCountries({
      db: fake.db,
      apiKey: 'k',
      now: day2,
      fetchImpl: answer({
        // CZ dropped from ChatGPT; Copilot's read fails and keeps yesterday's.
        chatgpt: ['US', 'GB'],
        copilot: new Error('timeout'),
      }),
    });
    expect(outcome).toMatchObject({ chatgpt: 2, copilot: 'kept' });
    const supported = await loadSupportedCountries({ db: fake.db });
    expect([...supported.get('chatgpt')].sort()).toEqual(['GB', 'US']);
    expect([...supported.get('copilot')].sort()).toEqual(['BR', 'US']);
  });

  it('reads nothing without the provider key', async () => {
    const fetchImpl = answer({});
    expect(await refreshCloroCountries({ db: fakeDb().db, apiKey: '', fetchImpl })).toEqual({
      skipped: 'no provider key',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('supportsCountry and supportedLocations', () => {
  const supported = new Map([
    ['copilot', new Set(['US', 'TR'])],
    ['aimode', new Set(['US', 'TR', 'KE'])],
  ]);

  it('asks an engine only where it answers from', () => {
    expect(supportsCountry(supported, 'copilot-web', 'KE')).toBe(false);
    expect(supportsCountry(supported, 'copilot-web', 'TR')).toBe(true);
  });

  it('restricts nothing it has no list for', () => {
    // No list read for ChatGPT, the API models aren't the provider's, an untargeted run.
    expect(supportsCountry(supported, 'chatgpt-web', 'KE')).toBe(true);
    expect(supportsCountry(supported, 'gpt-5', 'KE')).toBe(true);
    expect(supportsCountry(supported, 'copilot-web', null)).toBe(true);
    expect(supportsCountry(new Map(), 'copilot-web', 'KE')).toBe(true);
  });

  it('skips a country an engine does not support, cities and states included', () => {
    const codes = ['US', 'KE', 'TR~ISTANBUL', 'US-CA'];
    expect(supportedLocations(codes, 'copilot-web', supported)).toEqual(['US', 'US-CA']);
    // Google's engines ask from the state too.
    expect(supportedLocations(codes, 'google-aimode', supported)).toEqual([
      'US',
      'KE',
      'TR~ISTANBUL',
      'US-CA',
    ]);
    expect(supportedLocations([], 'copilot-web', supported)).toEqual([null]);
  });
});

/**
 * The web names the provider's engines and knows which answer from a city
 * (frontend/src/lib/trackingCountries.ts): the same models the API reads lists
 * for, or the location picker would leave an engine unnamed or offer a city
 * where no engine asks from one.
 */
describe('the provider models on both sides (PROMPT-015e)', () => {
  const web = readFileSync(
    new URL('../../../frontend/src/lib/trackingCountries.ts', import.meta.url),
    'utf8',
  );
  const models = new Set(Object.values(CLORO_COUNTRY_MODELS));

  it('names every model the API reads a list for, and no other', () => {
    const labels = web.match(/ENGINE_LABELS[^=]*=\s*\{([^}]*)\}/);
    expect(labels).not.toBeNull();
    const named = [...labels[1].matchAll(/^\s*'?([a-z]+)'?:/gm)].map((m) => m[1]);
    expect(named.sort()).toEqual([...models].sort());
  });

  it("maps each engine to the provider's model as the API does", () => {
    const mapped = web.match(/PLATFORM_MODELS[^=]*=\s*\{([^}]*)\}/);
    expect(mapped).not.toBeNull();
    const pairs = Object.fromEntries(
      [...mapped[1].matchAll(/'([a-z-]+)':\s*'([a-z]+)'/g)].map((m) => [m[1], m[2]]),
    );
    expect(pairs).toEqual(CLORO_COUNTRY_MODELS);
  });

  it('leaves a US state to every model, as the API runs a state on every engine', () => {
    expect(web).not.toMatch(/COUNTRY_ONLY_MODELS/);
  });

  it("takes a city on the models of the API's city engines", () => {
    const cities = web.match(/CITY_MODELS[^=]*=\s*new Set\(\[([^\]]*)\]\)/);
    expect(cities).not.toBeNull();
    const webModels = [...cities[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(webModels.sort()).toEqual(
      [...new Set([...CITY_SCRAPERS].map((id) => CLORO_COUNTRY_MODELS[id]))].sort(),
    );
  });
});
