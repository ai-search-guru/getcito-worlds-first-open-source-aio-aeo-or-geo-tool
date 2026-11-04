/**
 * A report card's target country and the language its questions are asked
 * in: the country's main language (owner decision 2026-11-02). The form
 * lists every country; one not named here is asked in English, the
 * language most of its buyers search AI answers in where business runs in
 * several. Names are English, from the runtime's own country and language
 * names (Intl).
 */

const MAIN_LANGUAGE = {
  // Europe
  AD: 'ca',
  AL: 'sq',
  AT: 'de',
  BA: 'bs',
  BE: 'nl',
  BG: 'bg',
  BY: 'ru',
  CH: 'de',
  CY: 'el',
  CZ: 'cs',
  DE: 'de',
  DK: 'da',
  EE: 'et',
  ES: 'es',
  FI: 'fi',
  FR: 'fr',
  GB: 'en',
  GR: 'el',
  HR: 'hr',
  HU: 'hu',
  IE: 'en',
  IS: 'is',
  IT: 'it',
  LI: 'de',
  LT: 'lt',
  LU: 'fr',
  LV: 'lv',
  MC: 'fr',
  MD: 'ro',
  ME: 'sr',
  MK: 'mk',
  MT: 'en',
  NL: 'nl',
  NO: 'no',
  PL: 'pl',
  PT: 'pt',
  RO: 'ro',
  RS: 'sr',
  RU: 'ru',
  SE: 'sv',
  SI: 'sl',
  SK: 'sk',
  SM: 'it',
  TR: 'tr',
  UA: 'uk',
  VA: 'it',
  XK: 'sq',
  // The Americas
  AR: 'es',
  BO: 'es',
  BR: 'pt',
  CA: 'en',
  CL: 'es',
  CO: 'es',
  CR: 'es',
  CU: 'es',
  DO: 'es',
  EC: 'es',
  GT: 'es',
  HN: 'es',
  MX: 'es',
  NI: 'es',
  PA: 'es',
  PE: 'es',
  PR: 'es',
  PY: 'es',
  SV: 'es',
  US: 'en',
  UY: 'es',
  VE: 'es',
  HT: 'fr',
  // Middle East and Africa
  AE: 'ar',
  BH: 'ar',
  DZ: 'ar',
  EG: 'ar',
  IL: 'he',
  IQ: 'ar',
  IR: 'fa',
  JO: 'ar',
  KW: 'ar',
  LB: 'ar',
  LY: 'ar',
  MA: 'ar',
  OM: 'ar',
  QA: 'ar',
  SA: 'ar',
  SY: 'ar',
  TN: 'ar',
  YE: 'ar',
  AO: 'pt',
  CI: 'fr',
  CM: 'fr',
  ET: 'am',
  MZ: 'pt',
  SN: 'fr',
  TZ: 'sw',
  // Asia and the Pacific
  AZ: 'az',
  CN: 'zh',
  GE: 'ka',
  HK: 'zh',
  ID: 'id',
  JP: 'ja',
  KR: 'ko',
  KZ: 'kk',
  TH: 'th',
  TW: 'zh',
  UZ: 'uz',
  VN: 'vi',
  AM: 'hy',
  BD: 'bn',
  KH: 'km',
  LA: 'lo',
  MN: 'mn',
  MY: 'ms',
  NP: 'ne',
  LK: 'si',
  MM: 'my',
};

const regionNames = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' });
const languageNames = new Intl.DisplayNames(['en'], { type: 'language', fallback: 'none' });

/**
 * Codes that name no country: unknown (ZZ), groups (EU, EZ, UN) and the
 * private-use ranges (AA, QM–QZ, XA–XZ), Kosovo's XK aside.
 */
const NOT_COUNTRIES = /^(ZZ|EU|EZ|UN|AA|Q[M-Z]|X[A-JL-Z])$/;

/** A country code the runtime names: a real ISO 3166-1 alpha-2 country. */
export function isCountry(code) {
  if (typeof code !== 'string' || !/^[A-Z]{2}$/.test(code) || NOT_COUNTRIES.test(code)) {
    return false;
  }
  try {
    return Boolean(regionNames.of(code));
  } catch {
    return false;
  }
}

/** The country's English name: "Türkiye", "United States". */
export function countryName(code) {
  return regionNames.of(code) ?? code;
}

/** The language a country's questions are asked in (ISO 639-1). */
export function countryLanguage(code) {
  return MAIN_LANGUAGE[code] ?? 'en';
}

/** A language's English name: "Turkish". */
export function languageName(code) {
  return languageNames.of(code) ?? code;
}
