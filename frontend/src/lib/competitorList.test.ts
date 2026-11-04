import { describe, expect, it } from 'vitest';
import {
  addCompetitorChoice,
  mergeCompetitorSuggestions,
  normalizeCompetitorDomain,
} from './competitorList';

const listed = [
  { name: 'Rival', domain: 'rival.com', selected: true },
  { name: 'Other Co', domain: '', selected: false },
];

describe('normalizeCompetitorDomain', () => {
  it('strips the protocol, trailing slashes and surrounding space', () => {
    expect(normalizeCompetitorDomain('  https://rival.com/ ')).toBe('rival.com');
    expect(normalizeCompetitorDomain('http://rival.com//')).toBe('rival.com');
  });
});

describe('addCompetitorChoice', () => {
  it('puts a new competitor at the top, selected', () => {
    const { list, duplicate } = addCompetitorChoice(listed, ' New One ', 'https://new.io/');
    expect(duplicate).toBeNull();
    expect(list[0]).toEqual({ name: 'New One', domain: 'new.io', selected: true });
    expect(list).toHaveLength(3);
  });

  it('adds a competitor typed without a domain', () => {
    const { list } = addCompetitorChoice(listed, 'Nameless', '');
    expect(list[0]).toEqual({ name: 'Nameless', domain: '', selected: true });
  });

  it('ignores an empty name', () => {
    const { list, duplicate } = addCompetitorChoice(listed, '   ', 'x.com');
    expect(list).toBe(listed);
    expect(duplicate).toBeNull();
  });

  it('treats the same domain as a duplicate, ignoring case and www', () => {
    const { list, duplicate } = addCompetitorChoice(listed, 'Rival Inc', 'https://WWW.Rival.com');
    expect(duplicate?.name).toBe('Rival');
    expect(list).toHaveLength(2);
  });

  it('matches by name when a side has no domain, and selects the existing entry', () => {
    const { list, duplicate } = addCompetitorChoice(listed, 'other co', 'otherco.com');
    expect(duplicate?.name).toBe('Other Co');
    expect(list).toHaveLength(2);
    expect(list[1].selected).toBe(true);
  });

  it('does not match different domains that share a name', () => {
    const { list, duplicate } = addCompetitorChoice(listed, 'Rival', 'rival.de');
    expect(duplicate).toBeNull();
    expect(list).toHaveLength(3);
  });
});

describe('mergeCompetitorSuggestions', () => {
  it('keeps competitors typed in while suggestions loaded', () => {
    const typed = [{ name: 'Mine', domain: 'mine.com', selected: true }];
    const merged = mergeCompetitorSuggestions(typed, [
      { name: 'Rival', domain: 'rival.com' },
      { name: 'Other', domain: 'other.com' },
    ]);
    expect(merged.map((c) => c.name)).toEqual(['Mine', 'Rival', 'Other']);
    expect(merged.every((c) => c.selected)).toBe(true);
  });

  it('skips a suggestion the user already listed', () => {
    const typed = [{ name: 'Rival Co', domain: 'rival.com', selected: false }];
    const merged = mergeCompetitorSuggestions(typed, [
      { name: 'Rival', domain: 'https://www.rival.com/' },
    ]);
    expect(merged).toEqual(typed);
  });
});
