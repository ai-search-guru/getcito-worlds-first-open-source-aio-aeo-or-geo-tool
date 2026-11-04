import { describe, expect, it } from 'vitest';
import { CITED_NOT_CLICKED_MIN, citationState, pageStatuses, pageUrl } from './trafficPages';

/** The Pages section's lists, as 00178 and 00186 sort pages into them (AT-006, AT-012). */

const row = (over: Partial<Parameters<typeof pageStatuses>[0]> = {}) => ({
  aiVisits: 0,
  citations: 0,
  sessions: 0,
  inSitemap: false,
  broken: false,
  ...over,
});

describe('pageStatuses', () => {
  it('puts a page with traffic or a sitemap entry and no AI visit on No AI traffic', () => {
    expect(pageStatuses(row({ sessions: 12 }))).toEqual(['noAiTraffic']);
    expect(pageStatuses(row({ inSitemap: true }))).toEqual(['noAiTraffic']);
    // Known only from citations: nothing says it has visitors to win.
    expect(pageStatuses(row({ citations: 3 }))).toEqual([]);
  });

  it('counts a page as cited, not clicked from 20 citations', () => {
    expect(pageStatuses(row({ citations: CITED_NOT_CLICKED_MIN - 1 }))).toEqual([]);
    expect(pageStatuses(row({ citations: CITED_NOT_CLICKED_MIN, sessions: 5 }))).toEqual([
      'noAiTraffic',
      'citedNotClicked',
    ]);
    expect(pageStatuses(row({ citations: 40, aiVisits: 1 }))).toEqual([]);
  });

  it('puts AI visits that no tracked answer cites on Traffic, no prompt', () => {
    expect(pageStatuses(row({ aiVisits: 3 }))).toEqual(['trafficNoPrompt']);
    expect(pageStatuses(row({ aiVisits: 3, citations: 1 }))).toEqual([]);
  });

  it('puts a page AI visitors found missing on Broken AI links, not Traffic, no prompt (AT-012)', () => {
    expect(pageStatuses(row({ aiVisits: 3, broken: true }))).toEqual(['brokenAiLinks']);
    expect(pageStatuses(row({ aiVisits: 3, citations: 9, broken: true }))).toEqual([
      'brokenAiLinks',
    ]);
  });
});

describe('citationState', () => {
  it('says why AI engines skip a page', () => {
    expect(citationState({ citations: 2, targetingPrompts: 1 })).toBe('cited');
    expect(citationState({ citations: 0, targetingPrompts: 1 })).toBe('targeted_not_cited');
    expect(citationState({ citations: 0, targetingPrompts: 0 })).toBe('not_targeted');
  });
});

describe('pageUrl', () => {
  it("builds a page's URL on the brand's domain, however the domain is stored", () => {
    expect(pageUrl('acme.example', '/gifts')).toBe('https://acme.example/gifts');
    expect(pageUrl('https://www.acme.example/', '/gifts')).toBe('https://www.acme.example/gifts');
    expect(pageUrl(' http://acme.example ', '/')).toBe('https://acme.example/');
  });
});
