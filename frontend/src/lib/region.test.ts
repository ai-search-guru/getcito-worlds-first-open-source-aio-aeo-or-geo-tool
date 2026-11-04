import { describe, expect, it } from 'vitest';

import {
  cityCode,
  formatRegionDisplay,
  isValidLocation,
  locationCode,
  locationSearchText,
  parseLocation,
  regionFlag,
  regionLabel,
} from './region';

const usFlag = String.fromCodePoint(0x1f1fa, 0x1f1f8);

describe('region display helpers', () => {
  it('shows a known region as flag plus country name', () => {
    expect(regionLabel('US')).toBe('United States');
    expect(regionFlag('US')).toBe(usFlag);
    expect(formatRegionDisplay('US')).toBe(`${usFlag} United States`);
  });

  it('normalizes lower-case known region codes', () => {
    const gbFlag = String.fromCodePoint(0x1f1ec, 0x1f1e7);

    expect(formatRegionDisplay('gb')).toBe(`${gbFlag} United Kingdom`);
  });

  it('falls back to the raw code without a flag for unknown values', () => {
    expect(regionLabel('ZZ')).toBe('ZZ');
    expect(regionFlag('ZZ')).toBe('');
    expect(formatRegionDisplay('ZZ')).toBe('ZZ');
    expect(formatRegionDisplay('USA')).toBe('USA');
  });
});

describe('location codes', () => {
  it('shows a US state under its country flag, named by the state', () => {
    expect(regionLabel('US-CA')).toBe('California');
    expect(regionFlag('US-CA')).toBe(usFlag);
    expect(formatRegionDisplay('US-CA')).toBe(`${usFlag} California`);
  });

  it('parses countries and US states', () => {
    expect(parseLocation('DE')).toEqual({ country: 'DE', state: null });
    expect(parseLocation('us-ca')).toEqual({ country: 'US', state: 'CA' });
  });

  it('keeps Delaware distinct from Germany', () => {
    // 'DE' is both a country code and a USPS code; only the prefix decides.
    expect(regionLabel('DE')).toBe('Germany');
    expect(regionLabel('US-DE')).toBe('Delaware');
  });

  it('rejects sub-country codes the product cannot track', () => {
    // No non-US sub-country mechanism, and US-ZZ is not a state. Rejecting
    // beats silently degrading to the country: the picker must not offer
    // targeting the worker would quietly ignore.
    expect(parseLocation('DE-BY')).toBeNull();
    expect(parseLocation('US-ZZ')).toBeNull();
    expect(parseLocation('US-CA-1')).toBeNull();
    expect(isValidLocation('DE-BY')).toBe(false);
  });

  it('validates the codes it accepts', () => {
    expect(isValidLocation('US')).toBe(true);
    expect(isValidLocation('US-TX')).toBe(true);
    expect(isValidLocation('ZZ')).toBe(false);
  });

  it('reads a city as its country and city, by its own name (PROMPT-015d)', () => {
    expect(parseLocation('tr~istanbul')).toEqual({ country: 'TR', state: null, city: 'ISTANBUL' });
    expect(isValidLocation('TR~ISTANBUL')).toBe(true);
    expect(isValidLocation('TR~NOWHERE')).toBe(false);
    expect(isValidLocation('DE~ISTANBUL')).toBe(false);
    expect(regionLabel('TR~ISTANBUL')).toBe('İstanbul');
    expect(regionFlag('TR~ISTANBUL')).toBe(regionFlag('TR'));
    expect(cityCode('tr', 'izmir')).toBe('TR~IZMIR');
  });

  it('takes any country the engines may answer from, by its own name (PROMPT-015e)', () => {
    expect(isValidLocation('BO')).toBe(true);
    expect(regionLabel('BO')).toBe('Bolivia');
    expect(isValidLocation('EU')).toBe(false);
  });

  it('names Türkiye as Türkiye, and finds it and its cities by its other names too', () => {
    expect(regionLabel('TR')).toBe('Türkiye');
    expect(locationSearchText('TR')).toBe('Türkiye Turkiye Turkey');
    expect(locationSearchText('TR~IZMIR')).toBe('İzmir Izmir Türkiye Turkiye Turkey');
    expect(locationSearchText('BR~SAO_PAULO')).toBe('São Paulo Sao Paulo Brazil');
    expect(locationSearchText('DE')).toBe('Germany');
    expect(locationSearchText('US-CA')).toBe('California');
  });

  it('takes the tracking countries beyond the brand regions (PROMPT-015c)', () => {
    expect(isValidLocation('PL')).toBe(true);
    expect(regionLabel('PL')).toBe('Poland');
    expect(isValidLocation('ZA')).toBe(true);
  });

  it('builds codes from a country and optional state', () => {
    expect(locationCode('US')).toBe('US');
    expect(locationCode('US', null)).toBe('US');
    expect(locationCode('us', 'ca')).toBe('US-CA');
  });
});
