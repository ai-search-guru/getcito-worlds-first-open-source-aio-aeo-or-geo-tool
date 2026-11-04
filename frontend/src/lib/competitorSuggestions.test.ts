import { describe, expect, it } from 'vitest';
import {
  competitorSuggestionKey,
  filterNewCompetitorSuggestions,
  normalizeCompetitorDomain,
  normalizeCompetitorName,
} from './competitorSuggestions';

describe('normalizeCompetitorName', () => {
  it('ignores case, whitespace, punctuation, and accents', () => {
    expect(normalizeCompetitorName('  Café & Co. ')).toBe('cafeandco');
    expect(normalizeCompetitorName('CAFE-AND-CO')).toBe('cafeandco');
  });
});

describe('normalizeCompetitorDomain', () => {
  it('normalizes protocols, www, paths, and trailing dots', () => {
    expect(normalizeCompetitorDomain('https://www.Acme.com/pricing/')).toBe('acme.com');
    expect(normalizeCompetitorDomain('acme.com.')).toBe('acme.com');
  });
});

describe('filterNewCompetitorSuggestions', () => {
  it('removes existing names/domains and retains only unique new suggestions', () => {
    const suggestions = [
      { name: 'Existing Inc', domain: 'new-domain.example' },
      { name: 'New competitor', domain: 'https://www.acme.com/' },
      { name: 'Unique Co', domain: 'unique.example' },
      { name: 'Unique Co', domain: 'unique-alt.example' },
      { name: 'Another Co', domain: 'unique.example' },
      { name: 'Missing Domain', domain: '' },
    ];

    expect(
      filterNewCompetitorSuggestions(suggestions, [
        { name: 'Existing Inc', domain: 'existing.example' },
        { name: 'Other name', domain: 'https://acme.com/pricing' },
      ]),
    ).toEqual([{ name: 'Unique Co', domain: 'unique.example' }]);
  });

  it('uses a normalized domain as the stable selection key', () => {
    expect(competitorSuggestionKey({ name: 'Acme', domain: 'https://www.acme.com/' })).toBe(
      'domain:acme.com',
    );
  });
});
