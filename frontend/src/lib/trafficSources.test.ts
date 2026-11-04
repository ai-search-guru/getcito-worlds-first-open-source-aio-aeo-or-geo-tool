import { describe, expect, it } from 'vitest';
import {
  TRAFFIC_SECTION_SOURCES,
  googleSourceStatus,
  gscPropertyHost,
  sectionsNeeding,
  snippetDetected,
  snippetState,
  snippetStateOf,
  sourceHost,
} from './trafficSources';

const NOW = Date.parse('2026-10-18T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

describe('snippetDetected', () => {
  it('counts a visit in the last 7 days', () => {
    expect(snippetDetected(daysAgo(0.1), NOW)).toBe(true);
    expect(snippetDetected(daysAgo(6.9), NOW)).toBe(true);
  });

  it('reads an older last visit, or none, as not detected', () => {
    expect(snippetDetected(daysAgo(7.1), NOW)).toBe(false);
    expect(snippetDetected(null, NOW)).toBe(false);
  });
});

describe('snippetState', () => {
  it('is active with an AI visit in the last 7 days', () => {
    expect(snippetState({ lastVisitAt: daysAgo(1), foundAt: null }, NOW)).toBe('active');
  });

  it('is installed and quiet when the home page check found it, or a visit came before', () => {
    expect(snippetState({ lastVisitAt: null, foundAt: daysAgo(2) }, NOW)).toBe('installed_quiet');
    expect(snippetState({ lastVisitAt: daysAgo(40), foundAt: null }, NOW)).toBe('installed_quiet');
  });

  it('is not detected with no visit ever and no check that found it', () => {
    expect(snippetState({ lastVisitAt: null, foundAt: null }, NOW)).toBe('not_detected');
    expect(snippetStateOf({ snippetLastVisitAt: null, snippetFoundAt: null }, NOW)).toBe(
      'not_detected',
    );
  });
});

describe('googleSourceStatus', () => {
  const ready = { configured: true, connected: true, mapped: true, lastDataAt: daysAgo(0.1) };

  it('is connected once data has arrived, syncing until then', () => {
    expect(googleSourceStatus(ready)).toBe('connected');
    expect(googleSourceStatus({ ...ready, lastDataAt: null })).toBe('syncing');
  });

  it('asks for a property when connected without one for the brand', () => {
    expect(googleSourceStatus({ ...ready, mapped: false, lastDataAt: null })).toBe('unmapped');
  });

  it('is not connected, or not set up on a server without the keys', () => {
    expect(googleSourceStatus({ ...ready, connected: false })).toBe('not_connected');
    expect(googleSourceStatus({ ...ready, configured: false, connected: false })).toBe(
      'not_configured',
    );
  });
});

describe('gscPropertyHost', () => {
  it('names a domain property by its domain, without "sc-domain:"', () => {
    expect(gscPropertyHost('sc-domain:getcito.com')).toBe('getcito.com');
  });

  it('names a URL-prefix property by its host', () => {
    expect(gscPropertyHost('https://blog.getcito.com/')).toBe('blog.getcito.com');
  });

  it('leaves anything else as it is', () => {
    expect(gscPropertyHost('getcito.com')).toBe('getcito.com');
  });
});

describe('sectionsNeeding', () => {
  it('lists the sections a source unlocks, in the page order (AT-016, AT-017)', () => {
    expect(TRAFFIC_SECTION_SOURCES.pageValue).toBe('google-analytics');
    expect(sectionsNeeding('google-analytics')).toEqual([
      'aiShare',
      'engagedVisits',
      'keyEvents',
      'conversions',
      'pageValue',
    ]);
    expect(sectionsNeeding('google-search-console')).toEqual([
      'googleClicks',
      'googleTrend',
      'googlePages',
      'googleQueries',
    ]);
  });
});

describe('sourceHost', () => {
  it('names a Search Console property by its own host', () => {
    expect(sourceHost('google-search-console', 'sc-domain:acme.example', 'other.example')).toBe(
      'acme.example',
    );
    expect(sourceHost('google-search-console', 'https://blog.acme.example/', undefined)).toBe(
      'blog.acme.example',
    );
  });

  it("names Google Analytics by the brand's domain, its property id names no site", () => {
    expect(sourceHost('google-analytics', '123456789', 'acme.example')).toBe('acme.example');
    expect(sourceHost('google-analytics', '123456789', undefined)).toBe('123456789');
    expect(sourceHost('google-analytics', null, undefined)).toBe('');
  });
});
