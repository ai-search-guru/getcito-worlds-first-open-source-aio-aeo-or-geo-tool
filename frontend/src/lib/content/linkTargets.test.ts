import { describe, expect, it } from 'vitest';
import { linkAllowList, linkHref, linkKey, pickLinkTargets } from './linkTargets';

/** Where an agent may link: the brand's pages and the draft's own sources. */
describe('linkKey and linkHref', () => {
  it('compare links without www, tracking, a hash or a trailing slash', () => {
    expect(linkKey('https://WWW.Acme.example/Pricing/?utm_source=x&plan=pro#top')).toBe(
      'acme.example/Pricing?plan=pro',
    );
    expect(linkKey('mailto:hi@acme.example')).toBeNull();
    expect(linkKey('/pricing')).toBeNull();
    expect(linkHref('https://www.acme.example/a/?utm_source=chatgpt.com&plan=pro#top')).toBe(
      'https://www.acme.example/a/?plan=pro',
    );
  });

  it('read long links in time near their size', () => {
    expect(linkKey('https://acme.example/a//b///')).toBe('acme.example/a//b');
    const slashes = `https://acme.example/${'/'.repeat(100_000)}a`;
    const page = Array.from(
      { length: 500 },
      (_, i) => `https://acme.example/${'/'.repeat(2_000)}${i}`,
    );
    const started = performance.now();
    expect(linkKey(slashes)).toBe(`acme.example/${'/'.repeat(100_000)}a`);
    for (const url of page) linkKey(url);
    expect(performance.now() - started).toBeLessThan(2000);
  });
});

describe('pickLinkTargets', () => {
  const pages = [
    { url: 'https://acme.example/pricing', title: 'Pricing', h1: null },
    { url: 'https://acme.example/guides/brew', title: null, h1: 'Brew guide' },
    { url: 'https://acme.example/guides/brew/', title: 'Duplicate', h1: null },
  ];
  const sources = {
    citedPages: [
      { url: 'https://research.example/study?utm_source=chatgpt.com', title: 'Coffee study' },
      { url: 'https://www.rival.example/compare', title: 'Rival compares' },
      { url: 'https://shop.other-rival.example/x', title: 'Other rival' },
      { url: 'https://blog.acme.example/post', title: 'Our blog' },
      { url: 'https://forum.example/thread', title: 'A thread' },
    ],
    brandDomains: ['acme.example'],
    // A competitor's domain may be written with a path.
    competitorDomains: ['rival.example', 'other-rival.example/en'],
  };
  const choices = [
    { ref: 'https://forum.example/thread', included: false, added: false },
    { ref: 'https://standards.example/spec', included: true, added: true },
  ];

  it("offers the brand's pages and the kept sources, never its own or a competitor's", () => {
    const targets = pickLinkTargets({
      pages,
      sources,
      choices,
      sourceUrl: 'https://acme.example/pricing',
    });
    expect(targets.own).toEqual([{ url: 'https://acme.example/guides/brew', title: 'Brew guide' }]);
    expect(targets.sources).toEqual([
      { url: 'https://research.example/study', title: 'Coffee study' },
      { url: 'https://standards.example/spec', title: 'https://standards.example/spec' },
    ]);
  });

  it('offers no sources without their read: competitors could not be told apart', () => {
    expect(pickLinkTargets({ pages, sources: null, choices, sourceUrl: null }).sources).toEqual([]);
  });

  it('allows each target by its key, giving back its URL', () => {
    const allow = linkAllowList(pickLinkTargets({ pages, sources, choices, sourceUrl: null }));
    expect(allow.get(linkKey('https://www.acme.example/pricing/')!)).toBe(
      'https://acme.example/pricing',
    );
    expect(allow.get(linkKey('https://made-up.example/')!)).toBeUndefined();
  });
});
