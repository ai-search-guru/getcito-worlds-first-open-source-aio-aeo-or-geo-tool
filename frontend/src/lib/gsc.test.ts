import { describe, expect, it } from 'vitest';
import { matchGscProperty, propertyMatchesDomain } from './gsc';

describe('propertyMatchesDomain', () => {
  it('matches a domain property against the apex and subdomains', () => {
    expect(propertyMatchesDomain('sc-domain:example.com', 'example.com')).toBe(true);
    expect(propertyMatchesDomain('sc-domain:example.com', 'app.example.com')).toBe(true);
    expect(propertyMatchesDomain('sc-domain:example.com', 'other.com')).toBe(false);
    // Suffix must be a label boundary, not a substring.
    expect(propertyMatchesDomain('sc-domain:example.com', 'notexample.com')).toBe(false);
  });

  it('matches a URL-prefix property by host, ignoring scheme, www and paths', () => {
    expect(propertyMatchesDomain('https://www.example.com/', 'example.com')).toBe(true);
    expect(propertyMatchesDomain('https://example.com/', 'https://www.example.com')).toBe(true);
    expect(propertyMatchesDomain('https://blog.example.com/', 'example.com')).toBe(false);
  });
});

describe('matchGscProperty', () => {
  const properties = ['sc-domain:acme.dev', 'https://www.example.com/', 'https://docs.other.io/'];

  it('returns the single matching property', () => {
    expect(matchGscProperty(properties, ['example.com'])).toBe('https://www.example.com/');
    expect(matchGscProperty(properties, ['app.acme.dev'])).toBe('sc-domain:acme.dev');
  });

  it('returns null when nothing matches', () => {
    expect(matchGscProperty(properties, ['unrelated.com'])).toBeNull();
  });

  it('returns null when several properties match (human pick required)', () => {
    expect(
      matchGscProperty(['sc-domain:example.com', 'https://example.com/'], ['example.com']),
    ).toBeNull();
  });
});
