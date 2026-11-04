import { describe, expect, it } from 'vitest';

import {
  defaultMarket,
  isShoppingMarket,
  marketForCountry,
  marketRegionCodes,
  SHOPPING_MARKETS,
} from './markets';

describe('marketForCountry', () => {
  it('maps the US to the US market', () => {
    expect(marketForCountry('US')).toBe('us');
  });

  it('maps a US state code to the US market', () => {
    expect(marketForCountry('US-CA')).toBe('us');
    expect(marketForCountry('US-DE')).toBe('us');
    expect(marketForCountry('US-DC')).toBe('us');
  });

  it('maps EU countries to Europe', () => {
    for (const code of ['DE', 'FR', 'IT', 'ES', 'NL', 'SE', 'PL', 'IE', 'AT']) {
      expect(marketForCountry(code)).toBe('europe');
    }
  });

  it('maps the rest of the EEA to Europe', () => {
    for (const code of ['NO', 'IS', 'LI']) {
      expect(marketForCountry(code)).toBe('europe');
    }
  });

  it('maps the UK to Europe, written as GB or UK', () => {
    expect(marketForCountry('GB')).toBe('europe');
    expect(marketForCountry('UK')).toBe('europe');
  });

  it('maps Switzerland to Europe', () => {
    expect(marketForCountry('CH')).toBe('europe');
  });

  it('maps any other country to no market', () => {
    for (const code of ['TR', 'IN', 'AE', 'CA', 'JP', 'BR', 'AU', 'SG']) {
      expect(marketForCountry(code)).toBeNull();
    }
  });

  it('reads free-text domain countries: lower case and padded', () => {
    expect(marketForCountry(' us ')).toBe('us');
    expect(marketForCountry('de')).toBe('europe');
    expect(marketForCountry('us-ny')).toBe('us');
  });

  it('maps blanks and codes that are not locations to no market', () => {
    expect(marketForCountry(null)).toBeNull();
    expect(marketForCountry(undefined)).toBeNull();
    expect(marketForCountry('')).toBeNull();
    expect(marketForCountry('United States')).toBeNull();
    expect(marketForCountry('USA')).toBeNull();
    // Sub-country codes exist for US states only.
    expect(marketForCountry('US-ZZ')).toBeNull();
    expect(marketForCountry('US-')).toBeNull();
    expect(marketForCountry('DE-BY')).toBeNull();
    expect(marketForCountry('US-CA-LA')).toBeNull();
  });
});

describe('defaultMarket', () => {
  it('opens on the US when any country is in the US', () => {
    expect(defaultMarket(['US'])).toBe('us');
    expect(defaultMarket(['DE', 'FR', 'US-CA'])).toBe('us');
    expect(defaultMarket(['TR', 'US'])).toBe('us');
  });

  it('opens on Europe when every country is European', () => {
    expect(defaultMarket(['DE'])).toBe('europe');
    expect(defaultMarket(['GB', 'CH', 'FR'])).toBe('europe');
  });

  it('has no market when a country outside both markets sits beside European ones', () => {
    expect(defaultMarket(['DE', 'TR'])).toBeNull();
  });

  it('has no market for unmapped countries or none at all', () => {
    expect(defaultMarket(['TR', 'IN'])).toBeNull();
    expect(defaultMarket([])).toBeNull();
  });

  it('ignores blank domain countries', () => {
    expect(defaultMarket([null, '', '  ', 'DE'])).toBe('europe');
    expect(defaultMarket([null, undefined])).toBeNull();
  });
});

describe('marketRegionCodes', () => {
  it('lists the US and every US state', () => {
    const codes = marketRegionCodes('us');
    expect(codes).toContain('US');
    expect(codes).toContain('US-CA');
    expect(codes).toContain('US-DC');
    expect(codes.every((code) => marketForCountry(code) === 'us')).toBe(true);
  });

  it('lists the European countries', () => {
    const codes = marketRegionCodes('europe');
    expect(codes).toEqual(expect.arrayContaining(['DE', 'FR', 'GB', 'CH', 'NO']));
    expect(codes).not.toContain('TR');
    expect(codes.every((code) => marketForCountry(code) === 'europe')).toBe(true);
  });
});

describe('isShoppingMarket', () => {
  it('accepts the markets and nothing else', () => {
    for (const market of SHOPPING_MARKETS) expect(isShoppingMarket(market)).toBe(true);
    expect(isShoppingMarket('eu')).toBe(false);
    expect(isShoppingMarket(null)).toBe(false);
  });
});
