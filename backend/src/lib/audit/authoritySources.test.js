import { describe, expect, it } from 'vitest';
import * as cheerio from 'cheerio';
import { authorityKind } from './authoritySources.js';
import { outboundAuthorityLinks } from './signals/authority.js';

/**
 * Customer priorities item 6: an authority source is a government or
 * academic site in any country's form, an international body, a reference
 * or research site, or major news; the report says which counted and which
 * other sites the page links to.
 */

describe('authorityKind', () => {
  it('counts government and academic sites in every country’s form', () => {
    for (const host of [
      'cdc.gov',
      'www.mit.edu',
      'army.mil',
      'saglik.gov.tr',
      'metu.edu.tr',
      'ox.ac.uk',
      'gov.uk',
      'anu.edu.au',
    ]) {
      expect([host, authorityKind(host)]).toEqual([host, 'official']);
    }
  });

  it('counts international bodies, any .int among them', () => {
    expect(authorityKind('who.int')).toBe('international');
    expect(authorityKind('wipo.int')).toBe('international');
    expect(authorityKind('ec.europa.eu')).toBe('international');
    expect(authorityKind('www.unesco.org')).toBe('international');
  });

  it('counts reference, research and major news, as before', () => {
    expect(authorityKind('en.wikipedia.org')).toBe('research');
    expect(authorityKind('doi.org')).toBe('research');
    expect(authorityKind('www.nature.com')).toBe('research');
    expect(authorityKind('www.reuters.com')).toBe('news');
    expect(authorityKind('bbc.co.uk')).toBe('news');
  });

  it('counts the sites a brand trusts, and their pages (00449)', () => {
    const trusted = ['sca.coffee', 'www.NCAusa.org'];
    expect(authorityKind('sca.coffee', trusted)).toBe('trusted');
    expect(authorityKind('www.sca.coffee', trusted)).toBe('trusted');
    expect(authorityKind('docs.ncausa.org', trusted)).toBe('trusted');
    expect(authorityKind('notsca.coffee', trusted)).toBeNull();
    // A site on the shared list stays what it is.
    expect(authorityKind('fda.gov', ['fda.gov'])).toBe('official');
  });

  it("doesn't count a company's site that only looks like one", () => {
    expect(authorityKind('example.gov.com')).toBeNull();
    expect(authorityKind('notarxiv.org')).toBeNull();
    expect(authorityKind('instagram.com')).toBeNull();
    expect(authorityKind('')).toBeNull();
  });
});

describe('outboundAuthorityLinks', () => {
  const page = (links) => ({
    url: 'https://acme.example/guide',
    $: cheerio.load(
      `<html><body>${links.map((href) => `<a href="${href}">x</a>`).join('')}</body></html>`,
    ),
  });

  it('passes at two sites, and says what each counted as', () => {
    const result = outboundAuthorityLinks.evaluate(
      page([
        'https://www.saglik.gov.tr/a',
        'https://www.unesco.org/b',
        'https://www.instagram.com/acme',
        '/about',
      ]),
    );
    expect(result).toEqual({
      status: 'pass',
      score: 1,
      evidence: {
        authorityHosts: ['saglik.gov.tr', 'unesco.org'],
        count: 2,
        authorityKinds: { 'saglik.gov.tr': 'official', 'unesco.org': 'international' },
        otherHosts: ['instagram.com'],
        trustedSources: [],
      },
    });
  });

  it('counts the brand’s trusted sources its run read, and says which', () => {
    const ctx = {
      ...page(['https://sca.coffee/brewing', 'https://arxiv.org/abs/1']),
      trustedSources: ['sca.coffee'],
    };
    expect(outboundAuthorityLinks.evaluate(ctx)).toMatchObject({
      status: 'pass',
      evidence: {
        authorityKinds: { 'sca.coffee': 'trusted', 'arxiv.org': 'research' },
        trustedSources: ['sca.coffee'],
      },
    });
  });

  it('warns at one, fails at none, naming at most five sites that didn’t count', () => {
    expect(outboundAuthorityLinks.evaluate(page(['https://arxiv.org/abs/1']))).toMatchObject({
      status: 'warn',
      score: 0.5,
    });
    const none = outboundAuthorityLinks.evaluate(
      page(['a', 'b', 'c', 'd', 'e', 'f'].map((s) => `https://${s}.example.com/`)),
    );
    expect(none).toMatchObject({ status: 'fail', score: 0, evidence: { count: 0 } });
    expect(none.evidence.otherHosts).toHaveLength(5);
  });
});
