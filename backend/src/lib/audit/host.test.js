import { describe, expect, it } from 'vitest';
import { normHost, normStoredDomain, onBrandDomain } from './host.js';

describe('normHost', () => {
  it('lowercases, strips a leading www. and ignores path, query and fragment', () => {
    expect(normHost('https://www.Example.com/Pricing?x=1#top')).toBe('example.com');
  });

  it('ignores the port', () => {
    expect(normHost('https://example.com:8443/')).toBe('example.com');
  });

  it('returns null for something that is not a URL', () => {
    expect(normHost('example.com')).toBeNull();
    expect(normHost('')).toBeNull();
    expect(normHost(undefined)).toBeNull();
  });
});

describe('normStoredDomain', () => {
  // The trend endpoint keeps an audit when normHost(audit url) equals this value, so every way a
  // brand's domain can be stored has to reduce to the host an audit of that site reduces to.
  const auditedHost = normHost('https://example.com/some/page');

  it.each([
    'example.com',
    'Example.COM',
    'www.example.com',
    'example.com/',
    'example.com/en',
    'example.com:443',
    'example.com:8080/en?x=1',
    'https://example.com',
    'HTTPS://example.com',
    'http://www.Example.com/x',
    'https://www.Example.com/x/',
    '  example.com/  ',
  ])('reduces stored domain %j to the audited host', (stored) => {
    expect(normStoredDomain(stored)).toBe(auditedHost);
  });

  it('does not match a different host', () => {
    expect(normStoredDomain('https://example.org/')).not.toBe(auditedHost);
    expect(normStoredDomain('notexample.com')).not.toBe(auditedHost);
  });

  it('returns null when there is no usable domain', () => {
    expect(normStoredDomain(null)).toBeNull();
    expect(normStoredDomain(undefined)).toBeNull();
    expect(normStoredDomain('')).toBeNull();
    expect(normStoredDomain('not a domain')).toBeNull();
  });
});

describe('onBrandDomain', () => {
  it('matches the brand domain however it is stored, and its subdomains', () => {
    expect(onBrandDomain('https://www.acme.com/pricing', ['https://Acme.com/'])).toBe(true);
    expect(onBrandDomain('https://blog.acme.com/post', ['acme.com'])).toBe(true);
    expect(onBrandDomain('https://shop.example.org/', ['acme.com', 'example.org'])).toBe(true);
  });

  it('rejects another site, a look-alike host and a brand without domains', () => {
    expect(onBrandDomain('https://competitor.com/pricing', ['acme.com'])).toBe(false);
    expect(onBrandDomain('https://notacme.com/', ['acme.com'])).toBe(false);
    expect(onBrandDomain('https://acme.com/', [])).toBe(false);
    expect(onBrandDomain('not a url', ['acme.com'])).toBe(false);
  });
});
