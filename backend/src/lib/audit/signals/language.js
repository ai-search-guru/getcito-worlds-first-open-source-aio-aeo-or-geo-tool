/**
 * The language a page is written in, as a two-letter code: its <html lang>,
 * else a guess from its own words. Readability picks its formula by it and
 * first person its rules, as the Content Editor reads a draft in its
 * language (frontend/src/lib/content/readability.ts).
 */

/** "tr-TR", "en_US", "de" → "tr", "en", "de"; null for none or one not a language ("und", "x-default"). */
export function langAttribute(value) {
  const match = /^\s*([a-z]{2})(?:[-_]|\s*$)/i.exec(String(value ?? ''));
  return match ? match[1].toLowerCase() : null;
}

/** Scripts whose letters name their language: Japanese by its kana, before the Chinese characters it shares. */
const SCRIPTS = [
  ['ja', /[\p{Script=Hiragana}\p{Script=Katakana}]/gu],
  ['ko', /\p{Script=Hangul}/gu],
  ['zh', /\p{Script=Han}/gu],
  ['th', /\p{Script=Thai}/gu],
  ['ar', /\p{Script=Arabic}/gu],
  ['hi', /\p{Script=Devanagari}/gu],
];

/** Each language's commonest short words: a page's words that are these say which it is. */
const COMMON_WORDS = {
  en: 'the and of to is in that for with are this you we it on was be as have not',
  tr: 've bir bu için ile da de çok ama gibi daha olarak ne değil sonra kadar her mi var olan',
  de: 'der die das und ist nicht mit ein eine auf für sich den dem auch wir ich sie es zu',
  fr: 'le la les et est des une un du pour que qui dans pas sur au avec nous je ce',
  es: 'el la los las y es que una un por para con del se no en como más pero su',
  pt: 'o a os as e é que uma um para com não do da dos em por mais se no',
  it: 'il la le e è che di un una per con non del della sono gli si anche come al',
  nl: 'de het een en is van dat niet op met voor zijn ook wij ik je te die als aan',
  sv: 'och att det en som är på för med inte den av till har jag vi om ett de så',
};
const COMMON = Object.entries(COMMON_WORDS).map(([code, words]) => [
  code,
  new Set(words.split(' ')),
]);

/** Fewer of a language's common words than this say nothing. */
const MIN_COMMON = 3;

/**
 * The language of a text by its words: its script when that names one,
 * else the language whose common words it uses most. Null when too few
 * words say.
 * @param {string} text
 * @returns {string|null}
 */
export function guessLanguage(text) {
  const value = String(text ?? '');
  const letters = value.match(/\p{L}/gu)?.length ?? 0;
  if (letters === 0) return null;
  for (const [code, re] of SCRIPTS) {
    if ((value.match(re)?.length ?? 0) > letters / 4) return code;
  }
  // "İçin" lower-cased outside Turkish keeps its dot as a mark: dropped.
  const words =
    value
      .toLowerCase()
      .replace(/\u0307/g, '')
      .match(/\p{L}+/gu) ?? [];
  let best = null;
  let bestHits = MIN_COMMON - 1;
  for (const [code, set] of COMMON) {
    const hits = words.reduce((n, w) => n + (set.has(w) ? 1 : 0), 0);
    if (hits > bestHits) {
      best = code;
      bestHits = hits;
    }
  }
  return best;
}
