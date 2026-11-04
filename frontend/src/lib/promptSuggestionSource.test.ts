import { describe, expect, it } from 'vitest';

import {
  fromYourData,
  gaSourceData,
  gscSourceData,
  type GaSuggestionSourceData,
  type GscSuggestionSourceData,
} from './promptSuggestionSource';

const gscData: GscSuggestionSourceData = {
  query: 'brand monitoring software',
  impressions: 1200,
  clicks: 84,
  avgPosition: 7.2,
  badge: 'capture_demand',
  competitionIndex: 31,
};

const gaData: GaSuggestionSourceData = {
  landingPage: '/guides/brand-monitoring',
  kind: 'ai_momentum',
  rank: 2,
  sessions: 480,
  keyEvents: 37,
  transactions: 9,
  revenue: 1250,
  aiSessions: 64,
  aiPlatforms: ['ChatGPT', 'Perplexity'],
  pageTitle: 'Brand Monitoring Guide',
};

describe('gscSourceData', () => {
  it('returns the payload when the source and shape agree', () => {
    expect(gscSourceData({ source: 'gsc', sourceData: gscData })).toBe(gscData);
  });

  it('returns null when sourceData is null', () => {
    expect(gscSourceData({ source: 'gsc', sourceData: null })).toBeNull();
  });

  it('returns null when the payload has the GA shape', () => {
    expect(gscSourceData({ source: 'gsc', sourceData: gaData })).toBeNull();
  });

  it('returns null when another source carries a GSC-shaped payload', () => {
    expect(gscSourceData({ source: 'llm', sourceData: gscData })).toBeNull();
  });
});

describe('gaSourceData', () => {
  it('returns the payload when the source and shape agree', () => {
    expect(gaSourceData({ source: 'ga', sourceData: gaData })).toBe(gaData);
  });

  it('returns null when sourceData is null', () => {
    expect(gaSourceData({ source: 'ga', sourceData: null })).toBeNull();
  });

  it('returns null when the payload has the GSC shape', () => {
    expect(gaSourceData({ source: 'ga', sourceData: gscData })).toBeNull();
  });

  it('returns null when another source carries a GA-shaped payload', () => {
    expect(gaSourceData({ source: 'heuristic', sourceData: gaData })).toBeNull();
  });
});

describe('fromYourData', () => {
  it('takes a suggestion built from Search Console or Analytics data', () => {
    expect(fromYourData({ source: 'gsc', sourceData: gscData })).toBe(true);
    expect(fromYourData({ source: 'ga', sourceData: gaData })).toBe(true);
  });

  it("leaves out the agents' suggestions and a source without its data", () => {
    expect(fromYourData({ source: 'llm', sourceData: null })).toBe(false);
    expect(fromYourData({ source: 'gsc', sourceData: null })).toBe(false);
    expect(fromYourData({ source: 'ga', sourceData: gscData })).toBe(false);
  });
});
