import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PAGE_TYPE_FORMATS,
  PAGE_TYPE_FRESHNESS,
  PAGE_TYPE_SECTION_FORMATS,
  SITE_PAGE_TYPES,
  SITE_TYPES,
  SITE_TYPE_NAMES,
  siteTypeLine,
  pageTypeFormat,
  sitePageTypeLines,
  siteTypeOf,
} from './contentPageTypes.js';

describe('the brief’s plan by page type', () => {
  it('leans and dates only page types the editor has', () => {
    for (const type of [
      ...Object.keys(PAGE_TYPE_SECTION_FORMATS),
      ...Object.keys(PAGE_TYPE_FRESHNESS),
    ]) {
      expect(PAGE_TYPE_FORMATS, type).toHaveProperty(type);
    }
    // A page with the year in its title shows when it was updated too.
    for (const [type, dates] of Object.entries(PAGE_TYPE_FRESHNESS)) {
      expect(dates.updatedLine || !dates.yearInTitle, type).toBe(true);
    }
  });
});

describe('pageTypeFormat', () => {
  it('names a page type as the person picks it, with its format', () => {
    expect(pageTypeFormat('solution_page')).toBe(
      'Use case page: how the product serves one use case, industry or team',
    );
    expect(pageTypeFormat('guide')).toMatch(/^How-to guide: numbered steps/);
  });

  it('says so when there is none, and passes on a type it doesn’t know', () => {
    expect(pageTypeFormat(null)).toBe('not set');
    expect(pageTypeFormat('')).toBe('not set');
    expect(pageTypeFormat('constructor')).toBe('constructor');
    expect(pageTypeFormat('webinar_page')).toBe('webinar_page');
  });

  it('covers every page type the editor offers, under the name the person sees', () => {
    const drafts = readFileSync(
      new URL('../../../frontend/src/lib/content/drafts.ts', import.meta.url),
      'utf8',
    );
    const list = drafts.match(/export const PAGE_TYPES = \[([\s\S]*?)\] as const/)[1];
    const types = [...list.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(Object.keys(PAGE_TYPE_FORMATS).sort()).toEqual([...types].sort());

    const messages = JSON.parse(
      readFileSync(new URL('../../../frontend/messages/en.json', import.meta.url), 'utf8'),
    );
    for (const [type, label] of Object.entries(messages.contentEditor.pageTypes)) {
      expect(PAGE_TYPE_FORMATS[type].split(':')[0]).toBe(label);
    }
  });
});

describe('siteTypeOf', () => {
  it('takes the site type picked, else guesses it as the editor does', () => {
    expect(siteTypeOf({ siteType: 'b2c', industry: 'E-commerce & Retail' })).toBe('b2c');
    expect(siteTypeOf({ siteType: 'app', shoppingModeEnabled: true })).toBe('app');
    expect(siteTypeOf({ siteType: null, shoppingModeEnabled: true })).toBe('ecommerce');
    expect(siteTypeOf({ siteType: 'retail', industry: 'Fashion & Apparel' })).toBe('ecommerce');
    expect(siteTypeOf({ industry: 'Travel & Hospitality' })).toBe('b2c');
    expect(siteTypeOf({ industry: 'Technology & Software' })).toBe('b2b');
    expect(siteTypeOf({ industry: 'constructor' })).toBe('b2b');
    expect(siteTypeOf()).toBe('b2b');
  });

  it("keeps the editor's lists and guesses (frontend/src/lib/content/pageTypes.ts)", () => {
    const source = readFileSync(
      new URL('../../../frontend/src/lib/content/pageTypes.ts', import.meta.url),
      'utf8',
    );
    const block = (start) => source.slice(source.indexOf(start)).match(/\{([\s\S]*?)\n\};/)[1];
    const sites = block('export const SITE_PAGE_TYPES');
    for (const site of SITE_TYPES) {
      const list = sites.match(new RegExp(`\\b${site}: \\[([\\s\\S]*?)\\]`))[1];
      expect(SITE_PAGE_TYPES[site]).toEqual([...list.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]));
    }
    expect(SITE_TYPES).toEqual(
      source
        .match(/export const SITE_TYPES = \[([^\]]*)\]/)[1]
        .match(/'([a-z0-9]+)'/g)
        .map((m) => m.slice(1, -1)),
    );
    const industries = block('const INDUSTRY_SITE_TYPES');
    const guesses = [...industries.matchAll(/^\s*'?([^':\n]+)'?: '([a-z0-9]+)',$/gm)];
    expect(guesses).toHaveLength(6);
    for (const [, industry, site] of guesses) expect(siteTypeOf({ industry })).toBe(site);
  });
});

describe('sitePageTypeLines', () => {
  it('lists the site’s page types with their formats', () => {
    const lines = sitePageTypeLines('b2c').split('\n');
    expect(lines).toHaveLength(SITE_PAGE_TYPES.b2c.length);
    expect(lines[0]).toBe(
      '- destination_page: Destination page: a place, what to do there and when to go',
    );
    // A mobile app's site (00456), as opportunities read it.
    expect(sitePageTypeLines('app').split('\n')).toHaveLength(SITE_PAGE_TYPES.app.length);
    expect(sitePageTypeLines('app')).toContain(
      '- pricing: Pricing: the plans, their prices and what each includes',
    );
  });
});

describe('siteTypeLine (Quality CE-056)', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('says nothing until Quality’s phase 2 is live', () => {
    vi.stubEnv('CONTENT_QUALITY_PHASE', '1');
    expect(siteTypeLine({ site_type: 'ecommerce' })).toBe('');
    vi.stubEnv('CONTENT_QUALITY_PHASE', '');
    expect(siteTypeLine({ site_type: 'ecommerce' })).toBe('');
  });

  it('names the kind of site picked, else the guess, on a line of its own', () => {
    vi.stubEnv('CONTENT_QUALITY_PHASE', '2');
    expect(siteTypeLine({ site_type: 'ecommerce' })).toBe(
      'Site type: E-commerce (an online shop selling products)\n',
    );
    expect(siteTypeLine({ industry: 'Travel & Hospitality' })).toBe(
      'Site type: B2C (a service for consumers)\n',
    );
    expect(siteTypeLine(null)).toBe(
      'Site type: B2B SaaS (software or services sold to businesses)\n',
    );
    expect(siteTypeLine({ site_type: 'app' })).toBe(
      'Site type: Mobile app (a mobile app people install from an app store)\n',
    );
  });

  it('names each kind of site as Brand settings does', () => {
    const messages = JSON.parse(
      readFileSync(new URL('../../../frontend/messages/en.json', import.meta.url), 'utf8'),
    );
    expect(SITE_TYPE_NAMES).toEqual(messages.brands.siteTypes);
  });
});
