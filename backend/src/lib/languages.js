export const LANGUAGE_NAMES = {
  en: 'English',
  de: 'German',
  fr: 'French',
  es: 'Spanish',
  tr: 'Turkish',
  ja: 'Japanese',
  pt: 'Portuguese',
  hi: 'Hindi',
  ko: 'Korean',
  it: 'Italian',
  nl: 'Dutch',
  sv: 'Swedish',
  ar: 'Arabic',
};

export function getLanguageName(code) {
  return LANGUAGE_NAMES[code] || 'English';
}

/**
 * A language as a brand or a Language rule names it ("tr", "pt-BR",
 * "Turkish", "English (US)", "US English") as its two-letter code, or null
 * for one not known here. A code on its own ("pl", "pl-PL") is taken as it
 * is; a two-letter word before a name is a region ("US", "UK"), not one.
 */
export function languageCodeOf(value) {
  const text = String(value ?? '')
    .trim()
    .toLowerCase();
  const words = text.split(/[^\p{L}]+/u).filter(Boolean);
  if (!words.length) return null;
  if (LANGUAGE_NAMES[words[0]]) return words[0];
  const code = Object.keys(LANGUAGE_NAMES).find((c) =>
    words.includes(LANGUAGE_NAMES[c].toLowerCase()),
  );
  if (code) return code;
  return /^[a-z]{2}(?:[-_][a-z]{2,4})?$/.test(text) ? words[0] : null;
}
