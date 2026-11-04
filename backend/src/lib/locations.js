import { cityFor } from './cities.js';

/**
 * Tracking locations (#691).
 *
 * A prompt's `regions` column holds location codes, not plain countries: a
 * bare ISO country (`DE`) or an ISO 3166-2 US state (`US-CA`). One code is
 * one tracked location — one set of scraper and model calls, one plan-quota
 * unit, one `prompt_results.region` value.
 *
 * Parsing lives here so exactly one definition decides what a code means.
 * The web tier keeps a deliberately identical copy in `frontend/src/lib/region.ts`
 * (same rule as the citation hostname split): both sides must agree on which
 * codes are valid, or the app would offer targeting the worker cannot run.
 */

/**
 * USPS code → full state name, for the AI providers' `user_location.region`,
 * which takes a human-readable region rather than a code.
 */
export const US_STATE_NAMES = {
  AL: 'Alabama',
  AK: 'Alaska',
  AZ: 'Arizona',
  AR: 'Arkansas',
  CA: 'California',
  CO: 'Colorado',
  CT: 'Connecticut',
  DE: 'Delaware',
  FL: 'Florida',
  GA: 'Georgia',
  HI: 'Hawaii',
  ID: 'Idaho',
  IL: 'Illinois',
  IN: 'Indiana',
  IA: 'Iowa',
  KS: 'Kansas',
  KY: 'Kentucky',
  LA: 'Louisiana',
  ME: 'Maine',
  MD: 'Maryland',
  MA: 'Massachusetts',
  MI: 'Michigan',
  MN: 'Minnesota',
  MS: 'Mississippi',
  MO: 'Missouri',
  MT: 'Montana',
  NE: 'Nebraska',
  NV: 'Nevada',
  NH: 'New Hampshire',
  NJ: 'New Jersey',
  NM: 'New Mexico',
  NY: 'New York',
  NC: 'North Carolina',
  ND: 'North Dakota',
  OH: 'Ohio',
  OK: 'Oklahoma',
  OR: 'Oregon',
  PA: 'Pennsylvania',
  RI: 'Rhode Island',
  SC: 'South Carolina',
  SD: 'South Dakota',
  TN: 'Tennessee',
  TX: 'Texas',
  UT: 'Utah',
  VT: 'Vermont',
  VA: 'Virginia',
  WA: 'Washington',
  WV: 'West Virginia',
  WI: 'Wisconsin',
  WY: 'Wyoming',
  DC: 'District of Columbia',
};

/**
 * Scrapers that can ask from a city (PROMPT-015d): Google's, through the
 * provider's `location`. The others answer per country (or US state), so a
 * city code is skipped for them rather than run again country-wide. The
 * web's CITY_PLATFORMS is the same list (cities.test.js). A US state they
 * ask from through `location` too (googleLocationFor).
 */
export const CITY_SCRAPERS = new Set(['google-aio', 'google-aimode']);

/**
 * Split a location code into what the providers actually take.
 * `US-CA` → `{ country: 'US', state: 'CA' }`; `DE` → `{ country: 'DE',
 * state: null }`; `TR~ISTANBUL` → `{ country: 'TR', state: null, city }`
 * (cities.js; an unknown city reads as its country). Unparsable or empty
 * input yields a null country, which the callers treat as "no targeting" —
 * the same as a prompt with no regions.
 */
export function parseLocation(code) {
  if (typeof code !== 'string') return { country: null, state: null };
  const trimmed = code.trim().toUpperCase();
  if (!trimmed) return { country: null, state: null };
  if (trimmed.includes('~')) {
    const country = trimmed.split('~')[0];
    if (!/^[A-Z]{2}$/.test(country)) return { country: null, state: null };
    return { country, state: null, city: cityFor(trimmed) };
  }

  const [country, state] = trimmed.split('-');
  if (!/^[A-Z]{2}$/.test(country || '')) return { country: null, state: null };
  if (state === undefined) return { country, state: null };
  // Sub-country targeting exists for US states only; anything else is
  // treated as the bare country rather than silently sent as a bad code.
  if (country === 'US' && US_STATE_NAMES[state]) return { country, state };
  return { country, state: null };
}

/** True for a city code (`TR~ISTANBUL`). */
export function isCityCode(code) {
  return typeof code === 'string' && code.includes('~');
}

/**
 * True for a city code no city in cities.js names (PROMPT-015d): there is
 * nothing to ask from, and asking country-wide instead would record the
 * country's answers as the city's, so no engine runs it.
 */
export function isUnknownCity(code) {
  return isCityCode(code) && !cityFor(code);
}

/**
 * The locations one scraper should actually be run for.
 *
 * A city code (PROMPT-015d) is kept only for the engines that can ask from
 * a city (CITY_SCRAPERS) and dropped for the rest: they answer per country,
 * and the prompt's country, when tracked, already runs them.
 *
 * Every other code survives as-is, a US state included: the AI endpoints
 * take it as `state`, Google's engines as `location` (googleLocationFor).
 * Until 2026-10 Google's engines ran a state country-wide, once per country.
 *
 * Order is preserved so task submission stays deterministic.
 */
export function locationsForScraper(locations, scraperId) {
  const given = locationsForModels(locations);
  // A city is run only by the engines that can ask from one (PROMPT-015d).
  return CITY_SCRAPERS.has(scraperId) ? given : given.filter((code) => !isCityCode(code));
}

/**
 * Where Google's engines (CITY_SCRAPERS) ask from, as the provider's
 * `location` takes it: Google's canonical name of a city
 * ("Los Angeles,California,United States", cities.js) or of a US state
 * ("California,United States"); undefined for a country, which goes as
 * `country` alone. Never sent with `state`: the Google endpoints take one
 * place, and the AI endpoints' `state` isn't theirs.
 */
export function googleLocationFor(code) {
  const { state, city } = parseLocation(code);
  if (city) return city.google;
  if (state) return `${US_STATE_NAMES[state]},United States`;
  return undefined;
}

/**
 * The locations the API models are run for: every code, each read by
 * userLocationFor, but a city no list names (isUnknownCity). No locations
 * means one untargeted run; only unknown cities means none.
 */
export function locationsForModels(locations) {
  const given = Array.isArray(locations) && locations.length > 0 ? locations : [null];
  return given.filter((code) => !isUnknownCity(code));
}

/**
 * `user_location` for the API models' web-search tool, or null when the
 * prompt is untargeted. `region` carries the full state name because that is
 * what both providers document for the field — a USPS code is not a region
 * name. Country-only locations produce exactly the payload they did before
 * states existed, so untargeted and country-targeted runs are unchanged.
 */
export function userLocationFor(code) {
  const { country, state, city } = parseLocation(code);
  if (!country) return null;
  const location = { type: 'approximate', country };
  if (state) location.region = US_STATE_NAMES[state];
  // A city (PROMPT-015d): both providers take `city`, beside its region.
  if (city) {
    location.region = city.region;
    location.city = city.name;
  }
  return location;
}
