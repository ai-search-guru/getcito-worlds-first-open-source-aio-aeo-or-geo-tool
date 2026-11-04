import { describe, expect, it } from 'vitest';
import { classifyDomain, extractHostname, normalizeDomain } from './classify.js';

const emptyContext = { brandDomains: [], competitorDomains: [] };

describe('classifyDomain', () => {
  it('lets brand domains win over competitor domains', () => {
    expect(
      classifyDomain('mybrand.com', {
        brandDomains: ['mybrand.com'],
        competitorDomains: ['mybrand.com'],
      }),
    ).toBe('you');
  });

  it('lets competitor domains win over content-type lists', () => {
    expect(
      classifyDomain('old.reddit.com', {
        brandDomains: [],
        competitorDomains: ['reddit.com'],
      }),
    ).toBe('competitor');

    expect(
      classifyDomain('youtube.com', {
        brandDomains: [],
        competitorDomains: ['youtube.com'],
      }),
    ).toBe('competitor');
  });

  it('matches brand domains by suffix', () => {
    expect(
      classifyDomain('blog.mybrand.com', {
        brandDomains: ['mybrand.com'],
        competitorDomains: [],
      }),
    ).toBe('you');
  });

  it('matches competitor domains by suffix', () => {
    expect(
      classifyDomain('news.competitor.example', {
        brandDomains: [],
        competitorDomains: ['competitor.example'],
      }),
    ).toBe('competitor');
  });

  it('classifies forum, social, review, and institutional list domains', () => {
    expect(classifyDomain('reddit.com', emptyContext)).toBe('forum');
    expect(classifyDomain('old.reddit.com', emptyContext)).toBe('forum');
    expect(classifyDomain('youtube.com', emptyContext)).toBe('social');
    expect(classifyDomain('trustpilot.com', emptyContext)).toBe('review');
    expect(classifyDomain('nih.gov', emptyContext)).toBe('institutional');
  });

  it('classifies institutional TLD patterns', () => {
    expect(classifyDomain('school.edu', emptyContext)).toBe('institutional');
    expect(classifyDomain('agency.gov', emptyContext)).toBe('institutional');
    expect(classifyDomain('base.mil', emptyContext)).toBe('institutional');
    expect(classifyDomain('oxford.ac.uk', emptyContext)).toBe('institutional');
    expect(classifyDomain('school.edu.tr', emptyContext)).toBe('institutional');
    expect(classifyDomain('agency.gov.xx', emptyContext)).toBe('institutional');
  });

  it('classifies editorial list domains', () => {
    expect(classifyDomain('nytimes.com', emptyContext)).toBe('editorial');
  });

  it('falls through to other for unknown domains and empty context lists', () => {
    expect(classifyDomain('example.com', emptyContext)).toBe('other');
    expect(
      classifyDomain('unknown-competitor.com', {
        brandDomains: ['mybrand.com'],
        competitorDomains: [],
      }),
    ).toBe('other');
  });
});

describe('extractHostname', () => {
  it('strips www and lowercases full URLs', () => {
    expect(extractHostname('https://www.FOO.com/bar')).toBe('foo.com');
  });

  it('recovers hostnames from bare or stripped inputs', () => {
    expect(extractHostname('www.FOO.com/bar')).toBe('foo.com');
    expect(extractHostname('FOO.com/path?x=1#hash')).toBe('foo.com');
  });

  it('returns null for empty or unparseable inputs', () => {
    expect(extractHostname('')).toBeNull();
    expect(extractHostname('   ')).toBeNull();
    expect(extractHostname('mailto:foo@example.com')).toBeNull();
  });
});

describe('normalizeDomain', () => {
  it('normalizes full URLs and bare domains', () => {
    expect(normalizeDomain('https://www.Foo.com/x')).toBe('foo.com');
    expect(normalizeDomain('foo.COM/')).toBe('foo.com');
  });

  it('returns an empty string for nullish values', () => {
    expect(normalizeDomain(null)).toBe('');
    expect(normalizeDomain(undefined)).toBe('');
  });
});
