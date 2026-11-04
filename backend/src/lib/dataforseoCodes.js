/**
 * Map our internal region / language codes to DataForSEO's numeric location_code
 * and ISO language code expected by the Google Ads search_volume endpoint.
 *
 * https://docs.dataforseo.com/v3/keywords_data/google_ads/locations/
 */

const REGION_TO_LOCATION_CODE = {
  US: 2840,
  GB: 2826,
  CA: 2124,
  AU: 2036,
  DE: 2276,
  FR: 2250,
  IT: 2380,
  ES: 2724,
  NL: 2528,
  SE: 2752,
  CH: 2756,
  TR: 2792,
  JP: 2392,
  BR: 2076,
  IN: 2356,
  KR: 2410,
  MX: 2484,
  SG: 2702,
  AE: 2784,
};

const LANGUAGE_PASSTHROUGH = new Set([
  'en',
  'de',
  'fr',
  'es',
  'tr',
  'ja',
  'pt',
  'hi',
  'ko',
  'it',
  'nl',
  'sv',
  'ar',
]);

/**
 * @param {string|null|undefined} region ISO 3166-1 alpha-2 (e.g. 'US', 'TR')
 * @returns {number|undefined} DataForSEO numeric location code, or undefined if no mapping
 */
export function regionToLocationCode(region) {
  if (!region) return undefined;
  return REGION_TO_LOCATION_CODE[region.toUpperCase()];
}

/**
 * @param {string|null|undefined} language ISO 639-1 (e.g. 'en', 'tr')
 * @returns {string|undefined} DataForSEO-compatible language code, or undefined
 */
export function languageToCode(language) {
  if (!language) return undefined;
  const lower = language.toLowerCase();
  return LANGUAGE_PASSTHROUGH.has(lower) ? lower : undefined;
}
