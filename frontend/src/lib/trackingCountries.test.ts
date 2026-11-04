import { describe, expect, it } from 'vitest';
import { answersFrom, countryName, isCountryCode, missingEngines } from './trackingCountries';

/** The countries the tracking engines answer from (PROMPT-015e). */

describe('isCountryCode and countryName', () => {
  it('knows any country by its code, and no group', () => {
    expect(isCountryCode('BO')).toBe(true);
    expect(countryName('BO')).toBe('Bolivia');
    expect(isCountryCode('XK')).toBe(true);
    for (const group of ['EU', 'UN', 'ZZ', 'EZ', 'QO']) expect(isCountryCode(group)).toBe(false);
    expect(isCountryCode('bo')).toBe(false);
    expect(isCountryCode('B1')).toBe(false);
  });
});

describe('missingEngines', () => {
  it('names the engines a country is not answered by', () => {
    const all = [
      { code: 'US', models: ['chatgpt', 'copilot', 'aimode'] },
      { code: 'KE', models: ['chatgpt', 'aimode'] },
    ];
    expect(missingEngines(all[1], all)).toEqual(['copilot']);
    expect(missingEngines(all[0], all)).toEqual([]);
  });
});

describe('answersFrom', () => {
  const countries = [
    { code: 'TR', models: ['chatgpt', 'copilot', 'aimode'] },
    { code: 'KE', models: ['chatgpt', 'aimode'] },
    { code: 'US', models: ['chatgpt', 'copilot', 'aimode', 'aioverview'] },
  ];
  const country = (code: string) => ({ country: code, state: null });

  it("says whether any of the prompt's engines answers from the country", () => {
    expect(answersFrom({ platforms: ['copilot-web'] }, country('KE'), countries)).toBe(false);
    expect(
      answersFrom({ platforms: ['copilot-web', 'chatgpt-web'] }, country('KE'), countries),
    ).toBe(true);
    // A country no engine lists.
    expect(answersFrom({ platforms: ['chatgpt-web'] }, country('BO'), countries)).toBe(false);
  });

  it("asks a city only of Google's engines, and lets the API models answer anywhere", () => {
    const istanbul = { country: 'TR', state: null, city: 'ISTANBUL' };
    expect(answersFrom({ platforms: ['chatgpt-web'] }, istanbul, countries)).toBe(false);
    expect(answersFrom({ platforms: ['google-aimode'] }, istanbul, countries)).toBe(true);
    expect(
      answersFrom({ platforms: [], models: ['gpt-5'] }, { ...istanbul, country: 'BO' }, countries),
    ).toBe(true);
  });

  it("counts Google's engines in a US state: the run asks them from the state", () => {
    const california = { country: 'US', state: 'CA' };
    expect(answersFrom({ platforms: ['google-aio', 'google-aimode'] }, california, countries)).toBe(
      true,
    );
    expect(answersFrom({ platforms: ['google-aimode'] }, california, null)).toBe(true);
    // As in the country itself.
    expect(answersFrom({ platforms: ['google-aio'] }, country('US'), countries)).toBe(true);
  });

  it('restricts nothing without the lists, or for an engine the provider does not list', () => {
    expect(answersFrom({ platforms: ['copilot-web'] }, country('KE'), [])).toBe(true);
    expect(answersFrom({ platforms: ['grok-web'] }, country('KE'), countries)).toBe(true);
  });

  it('gives an engine no list was read for the benefit of the doubt, as the run does', () => {
    // No country lists Gemini: the run asks it anywhere.
    expect(answersFrom({ platforms: ['gemini-web'] }, country('KE'), countries)).toBe(true);
    expect(answersFrom({ platforms: ['gemini-web'] }, country('BO'), countries)).toBe(true);
  });
});
