import { describe, expect, it } from 'vitest';
import { isTrustedHost, parseTrustedSources, trustedHost } from './trustedSources';

/** The sites a brand trusts (00449), as Settings › Content saves them. */

describe('trustedHost', () => {
  it('keeps the host alone, in lower case, without www.', () => {
    expect(trustedHost('sca.coffee')).toBe('sca.coffee');
    expect(trustedHost('https://www.Example.org/docs?x=1')).toBe('example.org');
    expect(trustedHost('docs.example.org:8443/path')).toBe('docs.example.org');
    expect(trustedHost('  saglik.gov.tr  ')).toBe('saglik.gov.tr');
  });

  it('is null for what isn’t a site', () => {
    for (const text of ['', 'coffee', 'not a site', 'http://', 'exa mple.org', '-bad.org']) {
      expect([text, trustedHost(text)]).toEqual([text, null]);
    }
  });
});

describe('parseTrustedSources', () => {
  it('reads one site per line or comma, each once, and names the lines that aren’t', () => {
    expect(
      parseTrustedSources('sca.coffee\nhttps://www.sca.coffee/guide, ncausa.org\n\nnot a site'),
    ).toEqual({ sources: ['sca.coffee', 'ncausa.org'], invalid: ['not a site'] });
  });
});

describe('isTrustedHost', () => {
  it('trusts a site and its pages, not a lookalike', () => {
    expect(isTrustedHost('www.sca.coffee', ['sca.coffee'])).toBe(true);
    expect(isTrustedHost('docs.sca.coffee', ['sca.coffee'])).toBe(true);
    expect(isTrustedHost('notsca.coffee', ['sca.coffee'])).toBe(false);
  });
});
