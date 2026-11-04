import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CITIES, cityFor } from './cities.js';
import { CITY_SCRAPERS, locationsForScraper } from './locations.js';

/**
 * The cities and the engines that ask from them (PROMPT-015d) are listed on
 * both sides: the web offers them (frontend/src/config/cities.ts, the location
 * picker), the API runs them. A city or an engine on one side only would be
 * offered and never run, or run and never offered; these tests keep them
 * together.
 */

const read = (path) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');
const quoted = (list) => [...list.matchAll(/'([^']+)'/g)].map((m) => m[1]);

describe('cities on both sides (PROMPT-015d)', () => {
  it('lists the same cities, in the same order, as the web', () => {
    const web = [
      ...read('frontend/src/config/cities.ts').matchAll(
        /country:\s*'([A-Z]{2})',\s*id:\s*'([A-Z_]+)'/g,
      ),
    ].map((m) => `${m[1]}~${m[2]}`);
    expect(web.length).toBeGreaterThan(40);
    expect(CITIES.map((c) => `${c.country}~${c.id}`)).toEqual(web);
    for (const code of web) expect(cityFor(code)?.google).toBeTruthy();
  });

  it("asks Google from Türkiye's cities as Turkiye", () => {
    const turkiye = CITIES.filter((c) => c.country === 'TR');
    expect(turkiye.length).toBeGreaterThan(0);
    for (const city of turkiye) expect(city.google).toMatch(/,Turkiye$/);
  });

  it('runs a city on the engines the web says ask from one', () => {
    const web = read('frontend/src/config/cities.ts').match(
      /CITY_PLATFORMS[^=]*=\s*new Set\(\[([^\]]*)\]\)/,
    );
    expect(web).not.toBeNull();
    expect([...CITY_SCRAPERS].sort()).toEqual(quoted(web[1]).sort());
  });

  it('runs a US state on every engine, as the location picker no longer says otherwise', () => {
    for (const id of CITY_SCRAPERS) expect(locationsForScraper(['US-CA'], id)).toEqual(['US-CA']);
    expect(read('frontend/src/components/dashboard/LocationPicker.tsx')).not.toMatch(
      /COUNTRY_ONLY_PLATFORMS/,
    );
  });
});
