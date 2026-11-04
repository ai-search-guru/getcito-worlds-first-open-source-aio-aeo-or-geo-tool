import { US_STATES } from '@/config/promptOptions';

/**
 * AI shopping markets (#1278).
 *
 * ChatGPT Shopping picks products differently by market: in the US from
 * OpenAI's own product index, built from product feeds; in Europe still from
 * Google Shopping. What a brand should fix for ChatGPT depends on the market,
 * so every e-commerce surface reads it from here: the Shopping page now, the
 * Readiness checklist and the Content Editor's Shopping tab once they exist.
 *
 * Countries arrive as location codes (`prompts.regions` and
 * `prompt_result_shopping_cards.region`: `DE`, `US-CA`) or as the free-text
 * `brand_domains.country` (`US`, `tr`, `UK`). A country outside both markets
 * maps to none, and gets no claim about where ChatGPT's products come from.
 */

export type ShoppingMarket = 'us' | 'europe';

/** The switch's order. */
export const SHOPPING_MARKETS: readonly ShoppingMarket[] = ['us', 'europe'];

/** The EU, the rest of the EEA (Iceland, Liechtenstein, Norway), the UK and Switzerland. */
const EUROPE_COUNTRIES: readonly string[] = [
  'AT',
  'BE',
  'BG',
  'CH',
  'CY',
  'CZ',
  'DE',
  'DK',
  'EE',
  'ES',
  'FI',
  'FR',
  'GB',
  'GR',
  'HR',
  'HU',
  'IE',
  'IS',
  'IT',
  'LI',
  'LT',
  'LU',
  'LV',
  'MT',
  'NL',
  'NO',
  'PL',
  'PT',
  'RO',
  'SE',
  'SI',
  'SK',
];

const EUROPE = new Set(EUROPE_COUNTRIES);

const US_STATE_CODES = new Set<string>(US_STATES.map((state) => state.code));

/** How people write a country in a free-text field, against its ISO code. */
const COUNTRY_ALIASES: ReadonlyMap<string, string> = new Map([['UK', 'GB']]);

export function isShoppingMarket(value: unknown): value is ShoppingMarket {
  return value === 'us' || value === 'europe';
}

/**
 * The market a country or location code belongs to: the US for `US` and its
 * states (`US-CA`), Europe for an EU / EEA country, the UK or Switzerland,
 * null for anything else. Sub-country codes exist for US states only, so any
 * other one (`DE-BY`, `US-ZZ`) is not a location and maps to none.
 */
export function marketForCountry(code: string | null | undefined): ShoppingMarket | null {
  if (typeof code !== 'string') return null;
  const [rawCountry, state, ...rest] = code.trim().toUpperCase().split('-');
  if (rest.length > 0) return null;
  const country = COUNTRY_ALIASES.get(rawCountry) ?? rawCountry;
  if (country === 'US') return state === undefined || US_STATE_CODES.has(state) ? 'us' : null;
  if (state !== undefined) return null;
  return EUROPE.has(country) ? 'europe' : null;
}

/**
 * The market a brand opens on, from its countries: the US when any of them is
 * in the US, Europe when every one of them is European, none otherwise. With
 * none there is no switch and no source claim. Blank entries (a domain with
 * no country) say nothing either way.
 */
export function defaultMarket(
  countries: Iterable<string | null | undefined>,
): ShoppingMarket | null {
  let european = false;
  let other = false;
  for (const code of countries) {
    if (!code?.trim()) continue;
    const market = marketForCountry(code);
    if (market === 'us') return 'us';
    if (market === 'europe') european = true;
    else other = true;
  }
  return european && !other ? 'europe' : null;
}

/**
 * Every location code in a market: the values a tracked result's region, and
 * so a shopping card's, can hold there. The US includes its states, which
 * prompts can target.
 */
export function marketRegionCodes(market: ShoppingMarket): string[] {
  if (market === 'us') return ['US', ...US_STATES.map((state) => `US-${state.code}`)];
  return [...EUROPE_COUNTRIES];
}
