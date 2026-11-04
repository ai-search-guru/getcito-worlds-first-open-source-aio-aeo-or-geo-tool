import { CITIES } from '@/config/cities';
import { TRACKING_COUNTRIES, US_STATES } from '@/config/promptOptions';
import { countryName, isCountryCode } from '@/lib/trackingCountries';

/**
 * Tracking locations (#691).
 *
 * A location code is a bare ISO country (`DE`), an ISO 3166-2 US state
 * (`US-CA`) or a city (`TR~ISTANBUL`, PROMPT-015d). One code is one tracked
 * location: one set of scraper and model calls, one plan-quota unit, one
 * `prompt_results.region` value.
 *
 * `backend/src/lib/locations.js` keeps a deliberately identical parse — both
 * sides must agree on which codes are valid, or the picker would offer
 * targeting the worker cannot run.
 */

const REGION_LABELS: ReadonlyMap<string, string> = new Map(
  TRACKING_COUNTRIES.map((region) => [region.code, region.label]),
);

const STATE_LABELS: ReadonlyMap<string, string> = new Map(
  US_STATES.map((state) => [state.code, state.label]),
);

const CITY_LABELS: ReadonlyMap<string, string> = new Map(
  CITIES.map((city) => [`${city.country}~${city.id}`, city.label]),
);

function normalizeRegionCode(code: string): string {
  return code.trim().toUpperCase();
}

export interface ParsedLocation {
  country: string;
  /** USPS code when the location targets a US state, else null. */
  state: string | null;
  /** The city's id when the location is a city (PROMPT-015d), else absent. */
  city?: string;
}

/**
 * Split a location code into country and state, or null when it is neither a
 * country we track nor a US state. Sub-country targeting exists for US
 * states only — every other engine mechanism is country-wide.
 */
export function parseLocation(code: string): ParsedLocation | null {
  const normalized = normalizeRegionCode(code);
  if (normalized.includes('~')) {
    const [country, city] = normalized.split('~');
    return CITY_LABELS.has(normalized) ? { country, state: null, city } : null;
  }
  const [country, state, ...rest] = normalized.split('-');
  // Any country (PROMPT-015e): the picker offers those an engine answers
  // from, and the run skips an engine in one it doesn't.
  if (rest.length > 0 || !(REGION_LABELS.has(country) || isCountryCode(country))) return null;
  if (state === undefined) return { country, state: null };
  if (country !== 'US' || !STATE_LABELS.has(state)) return null;
  return { country, state };
}

/** True when a code names a location the product can actually track. */
export function isValidLocation(code: string): boolean {
  return parseLocation(code) !== null;
}

/** The code for a city (PROMPT-015d): `TR~ISTANBUL`. */
export function cityCode(country: string, id: string): string {
  return `${normalizeRegionCode(country)}~${normalizeRegionCode(id)}`;
}

/** Build the code for a country, or for one of its states. */
export function locationCode(country: string, state?: string | null): string {
  const normalizedCountry = normalizeRegionCode(country);
  if (!state) return normalizedCountry;
  return `${normalizedCountry}-${normalizeRegionCode(state)}`;
}

/**
 * The location's own name: the state for a state code, the country
 * otherwise. States are shown without their country because the flag beside
 * them already carries it, and lists group them under a country heading.
 */
export function regionLabel(code: string): string {
  const parsed = parseLocation(code);
  if (!parsed) return code.trim();
  if (parsed.city) return CITY_LABELS.get(normalizeRegionCode(code)) ?? parsed.city;
  if (parsed.state) return STATE_LABELS.get(parsed.state) ?? parsed.state;
  return REGION_LABELS.get(parsed.country) ?? countryName(parsed.country);
}

export function regionFlag(code: string): string {
  const parsed = parseLocation(code);
  if (!parsed) return '';

  const [first, second] = parsed.country;
  return String.fromCodePoint(
    0x1f1e6 + first.charCodeAt(0) - 65,
    0x1f1e6 + second.charCodeAt(0) - 65,
  );
}

export function formatRegionDisplay(code: string): string {
  const label = regionLabel(code);
  const flag = regionFlag(code);
  return flag ? `${flag} ${label}` : label;
}

/** A name without its accents and dots: İstanbul → Istanbul, Türkiye → Turkiye. */
function withoutMarks(name: string): string {
  return name.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** Other names a country is searched by: Türkiye by its former English one. */
const COUNTRY_ALIASES: ReadonlyMap<string, readonly string[]> = new Map([['TR', ['Turkey']]]);

/**
 * What the location picker's search finds a code by: its name, the name
 * without its marks ("Ist" finds İstanbul, "Turkiye" Türkiye), a country's
 * other names, and for a city its country's too ("Turkey" finds İzmir).
 */
export function locationSearchText(code: string): string {
  const parsed = parseLocation(code);
  if (!parsed) return code.trim();
  const name = regionLabel(code);
  const names = [name, withoutMarks(name)];
  if (parsed.city) names.push(locationSearchText(parsed.country));
  else if (!parsed.state) names.push(...(COUNTRY_ALIASES.get(parsed.country) ?? []));
  return [...new Set(names)].join(' ');
}
