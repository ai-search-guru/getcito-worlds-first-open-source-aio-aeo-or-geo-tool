import * as cheerio from 'cheerio';
import { extractPageContent } from '../../pageContent.js';
import { guessLanguage, langAttribute } from './language.js';

/**
 * Readability as the Content Editor's Quality reads a page in its language,
 * so a page scores the same in Site Audit and in the editor: its prose
 * blocks (headings aside, a list item on its own), its sentences (an
 * abbreviation's dot ends none), its syllables, the language's formula
 * (Flesch for English, Ateşman for Turkish…) and its band.
 * Mirrors frontend/src/lib/content/readability.ts (readBlocks, sentencesOf,
 * syllablesOf, FORMULAS, formulaScore, FLESCH_BAND): keep the two in step.
 * Both tests read the same texts and expect the same scores.
 */

/**
 * English's band (rubric.json, readability: 50–70 for general audiences):
 * inside it passes, 30–50 warns, under 30 fails. Over 70 only warns: a
 * plain page is never failed for reading easily.
 */
export const FLESCH_BAND = { pass: [50, 70], warnFrom: 30 };

/**
 * Each language's formula and the score that reads as easy (the editor's
 * FORMULAS): from it a page passes; under it, it warns, and 30 under it,
 * where the editor's points run out, it fails.
 */
const FORMULAS = {
  en: { formula: 'flesch', target: FLESCH_BAND.pass[0] },
  // Ateşman's "medium" band starts at 50; Turkish words run longer.
  tr: { formula: 'atesman', target: 50 },
  de: { formula: 'amstad', target: 60 },
  fr: { formula: 'kandelMoles', target: 60 },
  es: { formula: 'fernandezHuerta', target: 60 },
};
const TARGET_SPAN = 30;

/** Without a formula, sentence and word length: an average sentence and word at most this long reads short. */
const SHORT_SENTENCE_WORDS = 20;
const SHORT_WORD_LETTERS = 6.5;

/** Languages written without spaces between words: their words and sentences can't be counted yet. */
export const UNSPACED = new Set(['ja', 'zh', 'th']);

/** About this many characters fit a line on a phone (375 px wide, 16 px type). */
const MOBILE_LINE_CHARS = 40;

/** Fewer words than this give no score. */
const MIN_WORDS = 30;

/** Words as the editor counts them, a vowel sign or other mark kept inside its word. */
const WORD = /[\p{L}\p{N}][\p{L}\p{M}\p{N}'’-]*/gu;
const countWords = (text) => text.match(WORD)?.length ?? 0;

/**
 * Text joined as a reader sees it: a space between blocks and at a line
 * break, a list item's own words without the list nested in it.
 */
function ownText(el) {
  let out = '';
  for (const node of el.children ?? []) {
    if (node.type === 'text') out += node.data;
    else if (node.type === 'tag') {
      const tag = node.name.toLowerCase();
      if (tag === 'ul' || tag === 'ol') continue;
      if (tag === 'br') out += ' ';
      else out += ` ${ownText(node)} `;
    }
  }
  return out;
}

/** Elements whose words stay in the line around them. */
const INLINE = new Set(
  'a abbr b bdi bdo cite code data dfn em i kbd mark q s samp small span strong sub sup time u var wbr'.split(
    ' ',
  ),
);

/** A block's own words, without the blocks inside it: a div's loose text. */
function inlineText(el) {
  let out = '';
  for (const node of el.children ?? []) {
    if (node.type === 'text') out += node.data;
    else if (node.type === 'tag' && INLINE.has(node.name.toLowerCase())) out += inlineText(node);
    else if (node.type === 'tag' && node.name.toLowerCase() === 'br') out += ' ';
  }
  return out;
}

/** The elements read as blocks, by name. */
const BLOCKS = new Set('h1 h2 h3 p li blockquote div section article figcaption dd dt'.split(' '));

/**
 * The body's block elements in document order, as
 * `$('body').find('h1, h2, …')` gives them, in one walk: that find's
 * context step is quadratic in the elements it starts from, and a page of
 * tens of thousands of short paragraphs held the server for a minute.
 */
function blockElements($) {
  const found = [];
  const body = $('body')[0];
  if (!body) return found;
  const stack = [...(body.children ?? [])].reverse();
  while (stack.length) {
    const node = stack.pop();
    if (node.type !== 'tag' && node.type !== 'script' && node.type !== 'style') continue;
    if (BLOCKS.has(node.name.toLowerCase())) found.push(node);
    const children = node.children ?? [];
    for (let i = children.length - 1; i >= 0; i -= 1) stack.push(children[i]);
  }
  return found;
}

/** Whether an element sits inside one of these, by name (a selector per element costs more than the walk). */
function insideOf(el, names) {
  for (let up = el.parent; up && up.type === 'tag'; up = up.parent) {
    if (names.includes(up.name.toLowerCase())) return true;
  }
  return false;
}

/**
 * The page's headings and prose, in order: a quote once, each list item on
 * its own, a table's cells not at all. Text a page builder leaves loose in
 * a div, a figure's caption or a definition list is a paragraph, as the
 * editor's import makes it one.
 * @param {string} html
 * @returns {{ tag: string, text: string }[]}
 */
export function readingBlocks(html) {
  const $ = cheerio.load(html ?? '');
  $('script, style, noscript, template, svg').remove();
  const blocks = [];
  blockElements($).forEach((el) => {
    const tag = el.name.toLowerCase();
    if (['div', 'section', 'article', 'figcaption', 'dd', 'dt'].includes(tag)) {
      // Inside a block read whole, or a table, it is read with it, or not at all.
      if (insideOf(el, ['p', 'li', 'blockquote', 'td', 'th'])) return;
      const loose = inlineText(el).replace(/\s+/g, ' ').trim();
      if (loose) blocks.push({ tag: 'p', text: loose });
      return;
    }
    // A paragraph in a list item, a quote or a cell is read with it, or not at all.
    if (tag === 'p' && insideOf(el, ['li', 'blockquote', 'td', 'th'])) return;
    if (tag === 'li' && insideOf(el, ['td', 'th'])) return;
    const text = ownText(el).replace(/\s+/g, ' ').trim();
    if (text) blocks.push({ tag, text });
  });
  return blocks;
}

/**
 * Abbreviations whose dot ends no sentence, by language; English's are read
 * in all. A dot inside one may take a space ("z. B.").
 */
const ABBREVIATIONS = {
  en: [
    ...['e.g', 'i.e', 'etc', 'vs', 'approx', 'cf', 'et al', 'Dr', 'Mr', 'Mrs', 'Ms', 'Prof'],
    ...['Jr', 'Sr', 'St', 'Inc', 'Ltd', 'Co', 'Corp', 'U.S', 'U.K'],
  ],
  de: [
    ...['z.B', 'd.h', 'u.a', 'u.U', 'z.T', 'o.Ä', 'i.d.R', 'bzw', 'ca', 'usw', 'ggf', 'evtl'],
    ...['inkl', 'vgl', 'bspw', 'sog', 'Hr', 'Fr', 'Str', 'Mio', 'Mrd'],
  ],
  tr: ['vb', 'örn', 'bkz', 'yy', 'Doç', 'Yrd', 'Av', 'Sn', 'T.C', 'Mah', 'Cad', 'Sok', 'Apt'],
  fr: ['p.ex', 'c.-à-d', 'M', 'Mme', 'Mlle', 'MM', 'env', 'av.J.-C', 'apr.J.-C', 'Ste'],
  es: [
    ...['p.ej', 'Sr', 'Sra', 'Srta', 'Dra', 'Ud', 'Uds', 'aprox', 'EE.UU', 'a.C', 'd.C'],
    ...['Avda', 'Lic', 'Ing'],
  ],
  pt: ['p.ex', 'Sr', 'Sra', 'Dra', 'aprox', 'Av'],
  it: ['ad es', 'ecc', 'Sig', 'Sig.ra', 'Dott', 'Dott.ssa'],
  nl: ['bijv', 'bv', 'o.a', 'd.w.z', 'enz', 'm.b.t', 'i.p.v', 'Dhr', 'Mevr'],
  sv: ['t.ex', 'bl.a', 'm.m', 'osv', 'dvs', 'ca', 's.k'],
};
/** These end no sentence before a number only ("No. 5", "S. 12"), so "Say no." still does. */
const BEFORE_NUMBER = {
  en: ['No', 'p', 'pp', 'Fig', 'Vol', 'Ch'],
  de: ['Nr', 'S', 'Abb', 'Kap', 'Bd'],
  tr: ['s', 'Md'],
  fr: ['p', 'n', 'fig', 'chap', 'vol'],
  es: ['pág', 'núm', 'art', 'cap', 'fig'],
  pt: ['pág', 'n', 'art', 'cap'],
  it: ['pag', 'n', 'art', 'cap'],
  nl: ['nr', 'blz', 'art'],
  sv: ['nr', 's'],
};
/** Languages whose ordinals are a number and a dot ("am 3. Oktober", "3. Kat"). */
const DOT_ORDINALS = new Set(['de', 'tr']);

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A list as one alternation, each with its upper-case opening and a space allowed after an inner dot. */
function alternation(list, lang) {
  return list
    .flatMap((a) => {
      const upper = a[0].toLocaleUpperCase(lang) + a.slice(1);
      return upper !== a && a.replace(/\P{L}/gu, '').length > 1 ? [a, upper] : [a];
    })
    .map((a) => escapeRe(a).replace(/\\\./g, '\\.\\s?').replace(/ /g, '\\s'))
    .join('|');
}

const protectedDotsRe = new Map();
/** The dots that end no sentence in a language: its abbreviations', and its ordinals'. */
function protectedDots(lang) {
  let re = protectedDotsRe.get(lang);
  if (!re) {
    const own = (table) =>
      alternation([...table.en, ...(lang === 'en' ? [] : (table[lang] ?? []))], lang);
    const parts = [
      `(?:${own(ABBREVIATIONS)})\\.(?=\\s)`,
      `(?:${own(BEFORE_NUMBER)})\\.(?=\\s*\\p{N})`,
      ...(DOT_ORDINALS.has(lang) ? ['\\p{N}+\\.(?=\\s+\\p{L})'] : []),
    ];
    re = new RegExp(`(?<![\\p{L}\\p{N}])(?:${parts.join('|')})`, 'gu');
    protectedDotsRe.set(lang, re);
  }
  return re;
}

/** What may close a sentence after its mark: a quote or a bracket. */
const CLOSE = `["'”’»)\\]」』]`;
/**
 * A sentence ends after . ! ? or … and a space, unless the next word starts
 * in lower case; a closing quote or bracket may come between.
 */
const SENTENCE_END = new RegExp(
  `(?<=[.!?…]${CLOSE}?)\\s+(?![\\s(\\["'“‘«¿¡]*\\p{Ll})|(?<=[。！？।؟]${CLOSE}?)(?!${CLOSE})\\s*`,
  'u',
);

/** A block's sentences, an abbreviation's or an ordinal's dot aside, in a two-letter language. */
export function sentencesOf(text, language = 'en') {
  return text
    .replace(protectedDots(language ?? 'en'), (m) => m.replace(/\./g, '․'))
    .split(SENTENCE_END)
    .map((s) => s.replace(/․/g, '.').trim())
    .filter((s) => countWords(s) > 0);
}

const VOWELS = {
  en: /[aeiouy]+/g,
  tr: /[aeıioöuüâîû]/g,
  de: /[aeiouäöüy]+/g,
  fr: /[aeiouyàâäéèêëîïôöùûüœæ]+/g,
  es: /[aeiouáéíóúü]+/g,
};

/**
 * A word's syllables, as each formula counts them: vowel groups (each
 * vowel in Turkish), an English silent final e left out. Never under one.
 */
export function syllablesOf(word, language = 'en') {
  let w = word.toLocaleLowerCase(language).replace(/[^\p{L}]/gu, '');
  if (!w) return 0;
  if (language === 'en') {
    if (w.length <= 3) return 1;
    // A silent final e ("make", "makes"); "-ted"/"-ded" keep their syllable ("wanted").
    w = w.replace(/(?:[^laeiouy]es|[^laeiouytd]ed|[^laeiouy]e)$/, (m) => m[0]);
  }
  if (language === 'fr') w = w.replace(/(?:es|e)$/, (m) => (w.length > 3 ? '' : m));
  const groups = w.match(VOWELS[language] ?? VOWELS.en)?.length ?? 0;
  return Math.max(1, groups);
}

/** A formula's score from the average sentence length and syllables per word. */
function formulaScore(formula, asl, asw) {
  switch (formula) {
    case 'flesch':
      return 206.835 - 1.015 * asl - 84.6 * asw;
    case 'atesman':
      return 198.825 - 40.175 * asw - 2.61 * asl;
    case 'amstad':
      return 180 - asl - 58.5 * asw;
    case 'kandelMoles':
      return 207 - 1.015 * asl - 73.6 * asw;
    case 'fernandezHuerta':
      // Syllables per 100 words, and words per sentence: the corrected form.
      return 206.84 - 0.6 * (asw * 100) - 1.02 * asl;
    default:
      return null;
  }
}

const round = (n, digits = 0) => Math.round(n * 10 ** digits) / 10 ** digits;
const isHeading = (b) => b.tag === 'h1' || b.tag === 'h2' || b.tag === 'h3';

/**
 * The prose blocks' reading level in a language, and its parts: the
 * formula's score (none for a language without one), sentence and word
 * length, and paragraph length, in words and in lines on a phone. Null
 * under 30 words.
 * @param {{ tag: string, text: string }[]} blocks
 * @param {string} language a two-letter code
 */
export function readingLevel(blocks, language = 'en') {
  const prose = blocks.filter((b) => !isHeading(b));
  const sentences = prose.flatMap((b) => sentencesOf(b.text, language));
  const words = sentences.reduce((sum, s) => sum + countWords(s), 0);
  if (words < MIN_WORDS || sentences.length === 0) return null;
  const syllables = sentences
    .flatMap((s) => s.match(WORD) ?? [])
    .reduce((sum, w) => sum + syllablesOf(w, language), 0);
  const letters = sentences
    .flatMap((s) => s.match(/[\p{L}\p{M}]+/gu) ?? [])
    .reduce((sum, w) => sum + w.length, 0);
  const asl = words / sentences.length;
  const known = FORMULAS[language] ?? null;
  const paragraphs = prose.filter((b) => b.tag === 'p');
  const average = (list, of) => list.reduce((sum, item) => sum + of(item), 0) / list.length;
  return {
    language,
    formula: known?.formula ?? null,
    score: known ? formulaScore(known.formula, asl, syllables / words) : null,
    target: known?.target ?? null,
    wordsPerSentence: asl,
    // Syllables count only for a formula: they're counted its way.
    syllablesPerWord: known ? syllables / words : null,
    lettersPerWord: letters / words,
    wordsPerParagraph: paragraphs.length ? average(paragraphs, (b) => countWords(b.text)) : null,
    mobileLinesPerParagraph: paragraphs.length
      ? average(paragraphs, (b) => Math.ceil(b.text.length / MOBILE_LINE_CHARS))
      : null,
  };
}

/**
 * Where a reading level passes, as the editor gives it points, so a pass
 * there is a pass here: English by its band (as the score shows, rounded);
 * another formula from its target up; a language without one by sentence
 * and word length, both short to pass. Pass (1), warn (0.5) or fail (0).
 * @param {{ formula: string|null, score: number|null, target: number|null,
 *   wordsPerSentence: number, lettersPerWord: number }} level
 */
export function readingBand(level) {
  const PASS = { status: 'pass', score: 1 };
  const WARN = { status: 'warn', score: 0.5 };
  const FAIL = { status: 'fail', score: 0 };
  if (level.formula === null || level.score === null) {
    const short =
      (level.wordsPerSentence <= SHORT_SENTENCE_WORDS ? 1 : 0) +
      (level.lettersPerWord <= SHORT_WORD_LETTERS ? 1 : 0);
    return short === 2 ? PASS : short === 1 ? WARN : FAIL;
  }
  const shown = Math.round(level.score);
  if (level.formula === 'flesch') {
    const [passFrom, passTo] = FLESCH_BAND.pass;
    if (shown >= passFrom && shown <= passTo) return PASS;
    return shown >= FLESCH_BAND.warnFrom ? WARN : FAIL;
  }
  if (shown >= level.target) return PASS;
  return shown > level.target - TARGET_SPAN ? WARN : FAIL;
}

/** A reading level as audit evidence: rounded as it shows. */
export function readingEvidence(level) {
  return {
    language: level.language,
    formula: level.formula,
    readingScore: level.score === null ? null : Math.round(level.score),
    wordsPerSentence: round(level.wordsPerSentence, 1),
    syllablesPerWord: level.syllablesPerWord === null ? null : round(level.syllablesPerWord, 1),
    lettersPerWord: round(level.lettersPerWord, 1),
    wordsPerParagraph:
      level.wordsPerParagraph === null ? null : Math.round(level.wordsPerParagraph),
    mobileLinesPerParagraph:
      level.mobileLinesPerParagraph === null ? null : Math.round(level.mobileLinesPerParagraph),
  };
}

/** The formulas by name, as the editor's Quality tab names them. */
const FORMULA_NAMES = {
  flesch: 'Flesch Reading Ease',
  atesman: 'Ateşman',
  amstad: 'Amstad',
  kandelMoles: 'Kandel–Moles',
  fernandezHuerta: 'Fernández-Huerta',
};

/**
 * A reading level's evidence in a line, with the score it aims for: what a
 * recommendation is written toward. Null for evidence without one.
 */
export function readingFinding(evidence) {
  const { formula, readingScore, language, wordsPerSentence } = evidence ?? {};
  if (typeof readingScore === 'number' && FORMULA_NAMES[formula]) {
    const aim =
      formula === 'flesch'
        ? `${FLESCH_BAND.pass[0]}–${FLESCH_BAND.pass[1]}`
        : `${FORMULAS[language]?.target ?? 60} or more`;
    return `${FORMULA_NAMES[formula]} ${readingScore} (language ${language}; aim for ${aim})`;
  }
  if (typeof wordsPerSentence === 'number') {
    return `no reading formula for language ${language}: ${wordsPerSentence} words a sentence, ${evidence.lettersPerWord} letters a word`;
  }
  return null;
}

/** Past this, after its scripts and styles, a page isn't read: its content takes too long to find. */
const MAX_READ_HTML = 2_000_000;
/** What holds no text: most of a page's bytes. */
const NO_TEXT = /<(script|style|svg|noscript|template)\b[\s\S]*?<\/\1\s*>/gi;

const prose = new WeakMap();

/**
 * The page's main content as the Content Editor imports it, its blocks
 * read once for every signal that reads them, and its language: its
 * <html lang>, else a guess from those words (null when neither says). A
 * page too large to read, or whose content can't be found, has no blocks.
 * @param {import('../context.js').AuditContext} ctx
 * @returns {{ blocks: { tag: string, text: string }[], language: string|null, tooLarge: boolean }}
 */
export function pageProse(ctx) {
  const known = prose.get(ctx);
  if (known) return known;
  const html = (ctx.html ?? '').replace(NO_TEXT, ' ');
  const tooLarge = html.length > MAX_READ_HTML;
  let content = '';
  if (!tooLarge) {
    try {
      content = extractPageContent(html, ctx.url).html;
    } catch {
      // No content found: no blocks.
    }
  }
  const blocks = tooLarge ? [] : readingBlocks(content);
  const language =
    langAttribute(ctx.$?.('html').attr('lang')) ??
    guessLanguage(blocks.length ? blocks.map((b) => b.text).join(' ') : ctx.text);
  const read = { blocks, language, tooLarge };
  prose.set(ctx, read);
  return read;
}
