import { describe, expect, it } from 'vitest';
import type { OverlapPage } from './drafts';
import { overlapOptions, pagePath, samePage } from './overlap';

const page = (over: Partial<OverlapPage> = {}): OverlapPage => ({
  url: 'https://acme.example/guides/espresso',
  title: 'Espresso guide',
  promptsInCommon: 3,
  citations: 4,
  gscPosition: 3.5,
  ...over,
});

describe('overlapOptions', () => {
  const top = page({ promptsInCommon: 1 });
  const given = page({ url: 'https://acme.example/pricing', promptsInCommon: 0 });

  it('offers no choice when a new page is the only one', () => {
    expect(overlapOptions({ totalPrompts: 4, pages: [] }, null)).toEqual([]);
    // Pages, but no prompts to read them against.
    expect(overlapOptions({ totalPrompts: 0, pages: [top] }, null)).toEqual([]);
  });

  it('offers a new page and the page cited for most of the prompts, recommending neither', () => {
    // However many of the prompts the page answers: more pages cited is no loss.
    for (const promptsInCommon of [1, 3]) {
      const cited = page({ promptsInCommon });
      expect(overlapOptions({ totalPrompts: 3, pages: [cited] }, null)).toEqual([
        { key: 'createNew', choice: { kind: 'create' } },
        { key: 'optimizeInstead', choice: { kind: 'optimize', page: cited } },
      ]);
    }
  });

  it('offers the plan’s page first, then a new page, then the page cited most when it is another', () => {
    expect(overlapOptions({ totalPrompts: 3, pages: [top] }, given)).toEqual([
      { key: 'optimizeGiven', choice: { kind: 'optimize', page: given } },
      { key: 'createNew', choice: { kind: 'create' } },
      { key: 'optimizeInstead', choice: { kind: 'optimize', page: top } },
    ]);
    // Nothing cited: the plan's page and a new page.
    expect(overlapOptions({ totalPrompts: 2, pages: [] }, given)).toEqual([
      { key: 'optimizeGiven', choice: { kind: 'optimize', page: given } },
      { key: 'createNew', choice: { kind: 'create' } },
    ]);
    // The plan's page is the one cited most (by address): offered once.
    expect(
      overlapOptions(
        { totalPrompts: 3, pages: [top] },
        page({ url: 'https://www.acme.example/Guides/espresso/' }),
      ).map((o) => o.key),
    ).toEqual(['optimizeGiven', 'createNew']);
  });
});

describe('samePage', () => {
  it('compares addresses as pages, and anything else as text', () => {
    expect(samePage('https://acme.example/a/', 'http://www.acme.example/A')).toBe(true);
    expect(samePage('https://acme.example/a', 'https://acme.example/b')).toBe(false);
    expect(samePage('not a url', 'not a url')).toBe(true);
    expect(samePage('not a url', 'https://acme.example/a')).toBe(false);
  });
});

describe('pagePath', () => {
  it('names a page by its path, the home page by its host', () => {
    expect(pagePath('https://acme.example/guides/espresso/')).toBe('/guides/espresso');
    expect(pagePath('https://acme.example/')).toBe('acme.example');
    expect(pagePath('not a url')).toBe('not a url');
  });
});
