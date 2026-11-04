import { describe, expect, it } from 'vitest';
import { sourceClass } from './sourceClass';

/** A page's link as a kind of source (CE-046): from its address, or not at all. */

const ctx = {
  brandDomains: ['acme.example'],
  competitorDomains: ['https://www.rival.example/'],
  pageType: 'guide',
};

describe('sourceClass', () => {
  it('reads official, research and standards sites as primary', () => {
    expect(sourceClass('https://www.cdc.gov/flu/index.html', ctx)).toBe('primary');
    expect(sourceClass('https://ec.europa.eu/eurostat', ctx)).toBe('primary');
    expect(sourceClass('https://doi.org/10.1000/182', ctx)).toBe('primary');
    expect(sourceClass('https://arxiv.org/abs/2311.09735', ctx)).toBe('primary');
    expect(sourceClass('https://www.w3.org/TR/WCAG22/', ctx)).toBe('primary');
  });

  it('reads news and review sites as secondary, forums and social posts as weak', () => {
    expect(sourceClass('https://www.reuters.com/markets/', ctx)).toBe('secondary');
    expect(sourceClass('https://www.g2.com/products/x/reviews', ctx)).toBe('secondary');
    expect(sourceClass('https://old.reddit.com/r/coffee/comments/1', ctx)).toBe('weak');
    expect(sourceClass('https://medium.com/@someone/post', ctx)).toBe('weak');
  });

  it('reads an encyclopedia anyone edits as secondary, uploaded papers as weak', () => {
    expect(sourceClass('https://en.wikipedia.org/wiki/Coffee', ctx)).toBe('secondary');
    expect(sourceClass('https://www.academia.edu/123/paper', ctx)).toBe('weak');
    // Other .edu sites stay official.
    expect(sourceClass('https://www.stanford.edu/research', ctx)).toBe('primary');
  });

  it('names the brand’s own pages and a competitor’s', () => {
    expect(sourceClass('https://blog.acme.example/post', ctx)).toBe('own');
    expect(sourceClass('https://rival.example/pricing', ctx)).toBe('competitor');
  });

  it('takes a competitor’s own page as primary on a page that compares', () => {
    for (const pageType of ['comparison', 'alternatives', 'best_of']) {
      expect(sourceClass('https://rival.example/pricing', { ...ctx, pageType })).toBe('primary');
    }
  });

  it('reads a site the brand trusts, and its pages, as primary, but not its own pages (00449)', () => {
    const trusting = {
      ...ctx,
      trustedDomains: ['some-coffee-blog.example', 'medium.com', 'acme.example'],
    };
    expect(sourceClass('https://some-coffee-blog.example/post', trusting)).toBe('primary');
    expect(sourceClass('https://docs.some-coffee-blog.example/', trusting)).toBe('primary');
    // The brand's word wins over the shared lists…
    expect(sourceClass('https://medium.com/@someone/post', trusting)).toBe('primary');
    // …but its own pages stay its own.
    expect(sourceClass('https://acme.example/about', trusting)).toBe('own');
  });

  it('leaves out an address the rules can’t place', () => {
    expect(sourceClass('https://some-coffee-blog.example/post', ctx)).toBeNull();
    expect(sourceClass('not a link', { ...ctx, pageType: null })).toBeNull();
  });
});
