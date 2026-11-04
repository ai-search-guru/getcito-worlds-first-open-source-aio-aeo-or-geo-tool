import { describe, it, expect } from 'vitest';
import {
  googleLocationFor,
  isUnknownCity,
  locationsForModels,
  locationsForScraper,
  parseLocation,
  userLocationFor,
} from './locations.js';

describe('parseLocation', () => {
  it('splits a US state code into country and state', () => {
    expect(parseLocation('US-CA')).toEqual({ country: 'US', state: 'CA' });
  });

  it('reads a bare country as country-only', () => {
    expect(parseLocation('DE')).toEqual({ country: 'DE', state: null });
  });

  it('normalizes case and surrounding space', () => {
    expect(parseLocation(' us-ca ')).toEqual({ country: 'US', state: 'CA' });
  });

  it('falls back to the country for sub-country codes we cannot target', () => {
    // Non-US sub-country targeting has no mechanism, and US-ZZ is not a state.
    expect(parseLocation('DE-BY')).toEqual({ country: 'DE', state: null });
    expect(parseLocation('US-ZZ')).toEqual({ country: 'US', state: null });
  });

  it('treats empty and malformed input as untargeted', () => {
    for (const value of ['', '   ', 'USA', 'U', null, undefined, 42]) {
      expect(parseLocation(value)).toEqual({ country: null, state: null });
    }
  });
});

describe('locationsForScraper', () => {
  it('keeps every location for state-capable engines', () => {
    expect(locationsForScraper(['US-CA', 'US-TX', 'DE'], 'chatgpt')).toEqual([
      'US-CA',
      'US-TX',
      'DE',
    ]);
  });

  it('keeps every US state for Google engines too, each asked from the state', () => {
    // Until 2026-10 they ran a state country-wide, once per country.
    expect(locationsForScraper(['US-CA', 'US-TX', 'DE'], 'google-aio')).toEqual([
      'US-CA',
      'US-TX',
      'DE',
    ]);
    expect(locationsForScraper(['US', 'US-CA'], 'google-aimode')).toEqual(['US', 'US-CA']);
  });

  it('leaves country-only targeting untouched for Google engines', () => {
    expect(locationsForScraper(['US', 'DE'], 'google-aio')).toEqual(['US', 'DE']);
  });

  it('runs once with no targeting when the prompt has no locations', () => {
    expect(locationsForScraper([], 'chatgpt')).toEqual([null]);
    expect(locationsForScraper(undefined, 'google-aio')).toEqual([null]);
  });
});

describe('googleLocationFor', () => {
  it('names a US state as Google does, beside its country', () => {
    expect(googleLocationFor('US-CA')).toBe('California,United States');
    expect(googleLocationFor('us-ny')).toBe('New York,United States');
    expect(googleLocationFor('US-DC')).toBe('District of Columbia,United States');
  });

  it('names a city by its Google name, and a country not at all', () => {
    expect(googleLocationFor('TR~ISTANBUL')).toBe('Istanbul,Istanbul,Turkiye');
    expect(googleLocationFor('US')).toBeUndefined();
    expect(googleLocationFor('DE')).toBeUndefined();
    expect(googleLocationFor(null)).toBeUndefined();
    expect(googleLocationFor('TR~NOWHERE')).toBeUndefined();
  });
});

describe('userLocationFor', () => {
  it('sends country only for a country location, exactly as before states', () => {
    expect(userLocationFor('DE')).toEqual({ type: 'approximate', country: 'DE' });
  });

  it('adds the full state name as the region for a state location', () => {
    expect(userLocationFor('US-CA')).toEqual({
      type: 'approximate',
      country: 'US',
      region: 'California',
    });
  });

  it('is null for untargeted runs so the tool config stays untouched', () => {
    expect(userLocationFor(null)).toBeNull();
    expect(userLocationFor('')).toBeNull();
  });
});

describe('cities (PROMPT-015d)', () => {
  it('reads a city code as its country and city, and an unknown city as its country', () => {
    expect(parseLocation('tr~istanbul')).toMatchObject({
      country: 'TR',
      state: null,
      city: { name: 'Istanbul', google: 'Istanbul,Istanbul,Turkiye' },
    });
    expect(parseLocation('TR~NOWHERE')).toEqual({ country: 'TR', state: null, city: null });
    expect(parseLocation('T1~ISTANBUL')).toEqual({ country: null, state: null });
  });

  it("runs a city only on Google's engines, and never twice", () => {
    const codes = ['TR', 'TR~ISTANBUL', 'TR~ANKARA'];
    expect(locationsForScraper(codes, 'chatgpt-web')).toEqual(['TR']);
    expect(locationsForScraper(codes, 'google-aimode')).toEqual(['TR', 'TR~ISTANBUL', 'TR~ANKARA']);
    expect(locationsForScraper(['US-CA', 'US~NEW_YORK'], 'google-aio')).toEqual([
      'US-CA',
      'US~NEW_YORK',
    ]);
    // A prompt tracked only in cities: nothing for the engines that can't ask from one.
    expect(locationsForScraper(['TR~ISTANBUL'], 'perplexity-web')).toEqual([]);
  });

  it('runs a city no list names on no engine, rather than country-wide under its name', () => {
    expect(isUnknownCity('TR~NOWHERE')).toBe(true);
    expect(isUnknownCity('TR~ISTANBUL')).toBe(false);
    expect(isUnknownCity('TR')).toBe(false);
    const codes = ['TR~NOWHERE', 'TR~ISTANBUL'];
    expect(locationsForScraper(codes, 'google-aimode')).toEqual(['TR~ISTANBUL']);
    expect(locationsForScraper(['TR~NOWHERE'], 'google-aio')).toEqual([]);
    expect(locationsForModels(codes)).toEqual(['TR~ISTANBUL']);
    expect(locationsForModels(['TR~NOWHERE'])).toEqual([]);
    // No locations at all is still one untargeted run.
    expect(locationsForModels([])).toEqual([null]);
    expect(locationsForModels(['DE', 'US-CA'])).toEqual(['DE', 'US-CA']);
  });

  it('gives the API models the city and its region', () => {
    expect(userLocationFor('TR~ISTANBUL')).toEqual({
      type: 'approximate',
      country: 'TR',
      region: 'Istanbul',
      city: 'Istanbul',
    });
  });
});
