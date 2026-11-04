import { LANGUAGES } from '@/config/promptOptions';
import { parseHtml } from './dom';

/**
 * Readability, one of the Quality scores (Content Editor Quality spec §2.3,
 * CE-036): seven checks read from the draft as written, in the browser, with
 * no AI cost. Each gives points up to its weight; a check the draft's
 * language can't be read for is left out and the score rescaled to 100, so
 * no points are made up. An GetCito estimate, not a Google score.
 */

export const READABILITY_CHECKS = [
  'avgSentence',
  'longSentences',
  'readingLevel',
  'answerFirst',
  'shortParagraphs',
  'headingSpacing',
  'passiveJargon',
  // Phase 3 (CE-052): the page type's own rules, as the Rules tab reads them.
  'typeRules',
] as const;
export type ReadabilityCheckId = (typeof READABILITY_CHECKS)[number];

/**
 * Each check's weight (spec §2.3): 100 in all. The page type's rules count
 * only on the types that weigh them (qualityProfiles.ts).
 */
export const READABILITY_WEIGHTS: Record<ReadabilityCheckId, number> = {
  avgSentence: 25,
  longSentences: 15,
  readingLevel: 20,
  answerFirst: 15,
  shortParagraphs: 10,
  headingSpacing: 10,
  passiveJargon: 5,
  typeRules: 0,
};

/** A sentence longer than this is long (spec: "No sentence over 35 words"). */
export const LONG_SENTENCE_WORDS = 35;
/** The average a sentence aims for. */
export const SENTENCE_WORDS = { min: 15, max: 20 } as const;
/** A paragraph longer than this many sentences is long. */
export const PARAGRAPH_SENTENCES = 4;
/** The most words under one heading before the next one is due. */
export const SECTION_WORDS = 300;
/** A page shorter than this gets no Readability score yet: too little to read. */
export const MIN_WORDS = 50;
/**
 * A paragraph under the H1 this short and not a sentence (no full stop at
 * its end) is a byline, a date or a note: answer first reads past it.
 */
export const MIN_ANSWER_WORDS = 8;
const ENDS_A_SENTENCE = /[.!?…。！？]["”’')\]]*$/u;
/**
 * A byline, a date or a note: short, and not a sentence ("By Jane Doe ·
 * October 2026"), its words counted as the API's page read counts them
 * (a number isn't one), so both read the same first paragraph.
 */
export const isByline = (text: string) =>
  (text.match(/\p{L}[\p{L}\p{N}'’-]*/gu) ?? []).length < MIN_ANSWER_WORDS &&
  !ENDS_A_SENTENCE.test(text.trim());

export type ReadingFormula = 'flesch' | 'atesman' | 'amstad' | 'kandelMoles' | 'fernandezHuerta';

/** What one check found: its points out of its weight, and what it counted. */
export interface ReadabilityCheck {
  id: ReadabilityCheckId;
  points: number;
  max: number;
  /** What it counted: words, sentences, a formula's score… */
  value: number;
  /** How many of what it looks for fall short (long sentences, long sections…). */
  count: number;
  /** The reading-level formula used, for readingLevel, and the score that reads as easy. */
  formula?: ReadingFormula | null;
  target?: number;
  /** English's band instead of a target: the score that reads right for most readers. */
  band?: { min: number; max: number };
  /** Read by the model, not by rules: its suggestion says so ("AI check", CE-050). */
  ai?: boolean;
  /** The first block that falls short, to show it in the draft. */
  at?: string | null;
  /** The page type's rules not met yet, by name, each with its aim and how the page reads now (typeRules). */
  rules?: { name: string; detail: string }[];
}

export interface Readability {
  /** 0–100 over the checks that could be read; null for a page it can't score. */
  score: number | null;
  /**
   * Why there is no score: a page too short to read, or a language written
   * without spaces between words (Japanese, Chinese, Thai), whose words and
   * sentences aren't counted yet.
   */
  unscored?: 'tooShort' | 'language';
  checks: ReadabilityCheck[];
  words: number;
}

/** A block as Readability reads it: its tag and its own words. */
export interface ReadBlock {
  tag: 'h1' | 'h2' | 'h3' | 'p' | 'li' | 'blockquote';
  text: string;
  words: number;
}

/**
 * Words as Readability and the rules count them: letters or digits, with
 * inner apostrophes and hyphens, a vowel sign or other mark kept inside its
 * word (Hindi's are marks, not letters, and would break each word in two or
 * three).
 */
const WORD = /[\p{L}\p{N}][\p{L}\p{M}\p{N}'’-]*/gu;
export const countWords = (text: string) => text.match(WORD)?.length ?? 0;

/**
 * Text joined as a reader sees it: a space between paragraphs and at a line
 * break (the editor's HTML has none between tags), a list item's own words
 * without the list nested in it.
 */
export function ownText(el: Element): string {
  let out = '';
  for (const node of el.childNodes) {
    if (node.nodeType === 3) out += node.textContent ?? '';
    else if (node.nodeType === 1) {
      const child = node as Element;
      const tag = child.tagName.toLowerCase();
      if (tag === 'ul' || tag === 'ol') continue;
      if (tag === 'br') out += ' ';
      else out += ` ${ownText(child)} `;
    }
  }
  return out;
}

/** The page's headings and prose, in order: a quote once, each list item on its own. */
export function readBlocks(html: string): ReadBlock[] {
  const doc = parseHtml(html);
  const blocks: ReadBlock[] = [];
  for (const el of doc.body.querySelectorAll('h1, h2, h3, p, li, blockquote')) {
    const tag = el.tagName.toLowerCase() as ReadBlock['tag'];
    // A paragraph in a list item, a quote or a cell is read with it, or not at all.
    if (tag === 'p' && el.closest('li, blockquote, td, th')) continue;
    if (tag === 'li' && el.closest('td, th')) continue;
    const text = ownText(el).replace(/\s+/g, ' ').trim();
    if (text) blocks.push({ tag, text, words: countWords(text) });
  }
  return blocks;
}

const isHeading = (b: ReadBlock) => b.tag === 'h1' || b.tag === 'h2' || b.tag === 'h3';
const isProse = (b: ReadBlock) => !isHeading(b);
/** Running text: a list item is a point, not a sentence to measure. */
const isRunning = (b: ReadBlock) => b.tag === 'p' || b.tag === 'blockquote';

/**
 * Abbreviations whose dot ends no sentence, by language; English's are read
 * in all. A dot inside one may take a space ("z. B."), and one starting in
 * lower case may open a sentence in upper case ("Vgl.").
 */
const ABBREVIATIONS: Record<string, string[]> = {
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
const BEFORE_NUMBER: Record<string, string[]> = {
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

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A list as one alternation, each with its upper-case opening and a space allowed after an inner dot. */
function alternation(list: string[], lang: string): string {
  return list
    .flatMap((a) => {
      const upper = a[0].toLocaleUpperCase(lang) + a.slice(1);
      return upper !== a && a.replace(/\P{L}/gu, '').length > 1 ? [a, upper] : [a];
    })
    .map((a) => escapeRe(a).replace(/\\\./g, '\\.\\s?').replace(/ /g, '\\s'))
    .join('|');
}

const abbreviationsRe = new Map<string, RegExp>();
/** The dots that end no sentence in a language: its abbreviations', and its ordinals'. */
function protectedDots(lang: string): RegExp {
  let re = abbreviationsRe.get(lang);
  if (!re) {
    const own = (table: Record<string, string[]>) =>
      alternation([...table.en, ...(lang === 'en' ? [] : (table[lang] ?? []))], lang);
    const parts = [
      `(?:${own(ABBREVIATIONS)})\\.(?=\\s)`,
      `(?:${own(BEFORE_NUMBER)})\\.(?=\\s*\\p{N})`,
      ...(DOT_ORDINALS.has(lang) ? ['\\p{N}+\\.(?=\\s+\\p{L})'] : []),
    ];
    re = new RegExp(`(?<![\\p{L}\\p{N}])(?:${parts.join('|')})`, 'gu');
    abbreviationsRe.set(lang, re);
  }
  return re;
}

/** What may close a sentence after its mark: a quote or a bracket. */
const CLOSE = `["'”’»)\\]」』]`;
/**
 * A sentence ends after . ! ? or … and a space, unless the next word starts
 * in lower case, and right after 。！？ (Japanese, Chinese), । (Hindi) or ؟
 * (Arabic), which need no space; a closing quote or bracket may come between.
 */
const SENTENCE_END = new RegExp(
  `(?<=[.!?…]${CLOSE}?)\\s+(?![\\s(\\["'“‘«¿¡]*\\p{Ll})|(?<=[。！？।؟]${CLOSE}?)(?!${CLOSE})\\s*`,
  'u',
);

/**
 * A block's sentences: split after . ! ? … 。！？ । or ؟, an abbreviation's
 * or an ordinal's dot aside. `language` is a two-letter code; null reads
 * English's abbreviations only.
 */
export function sentencesOf(text: string, language: string | null = 'en'): string[] {
  return text
    .replace(protectedDots(language ?? 'en'), (m) => m.replace(/\./g, '\u2024'))
    .split(SENTENCE_END)
    .map((s) => s.replace(/\u2024/g, '.').trim())
    .filter((s) => countWords(s) > 0);
}

const VOWELS: Record<string, RegExp> = {
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
export function syllablesOf(word: string, language: string): number {
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

/**
 * English's reading level, as Site Audit's readability signal reads it
 * (backend/src/lib/audit/signals/readability.js; rubric.json: 50–70 for
 * general audiences), so a page scores the same in both: full points inside
 * the pass band, half from 30 up, none under it. Over 70 is half too: a
 * plain page is never failed for reading easily. Keep the two in step.
 */
const FLESCH_BAND = { pass: [50, 70], warnFrom: 30 } as const;

/** Points for a Flesch score in its band, as it shows (rounded), and which side of it the score is on. */
function fleschPoints(score: number, max: number): { points: number; count: number } {
  const shown = Math.round(score);
  const [passFrom, passTo] = FLESCH_BAND.pass;
  // Under the band (-1: harder than most readers want), in it (0), over it (1: simpler).
  const count = shown < passFrom ? -1 : shown > passTo ? 1 : 0;
  if (count === 0) return { points: max, count };
  return { points: shown >= FLESCH_BAND.warnFrom ? max / 2 : 0, count };
}

/**
 * The formula each language's reading level is read with, and the score that
 * reads as easy; Site Audit reads a page in its language by the same table
 * (server signals/readability.js FORMULAS). Keep the two in step.
 */
const FORMULAS: Record<string, { formula: ReadingFormula; target: number }> = {
  // Read by its band (FLESCH_BAND); the target is the band's start.
  en: { formula: 'flesch', target: FLESCH_BAND.pass[0] },
  // Ateşman's "medium" band starts at 50; Turkish words run longer.
  tr: { formula: 'atesman', target: 50 },
  de: { formula: 'amstad', target: 60 },
  fr: { formula: 'kandelMoles', target: 60 },
  es: { formula: 'fernandezHuerta', target: 60 },
};

/**
 * Language names as a Language rule or a brand says them: each brand
 * language's (LANGUAGES), in English and in its own, and Chinese and Thai,
 * written without spaces between words as Japanese is.
 */
const LANGUAGE_NAMES = new Map<string, string>([
  ...LANGUAGES.map((l) => [l.label.replace(/\s*\(.*$/, '').toLowerCase(), l.code] as const),
  ...Object.entries({
    deutsch: 'de',
    français: 'fr',
    español: 'es',
    türkçe: 'tr',
    日本語: 'ja',
    português: 'pt',
    हिन्दी: 'hi',
    हिंदी: 'hi',
    한국어: 'ko',
    italiano: 'it',
    nederlands: 'nl',
    svenska: 'sv',
    العربية: 'ar',
    chinese: 'zh',
    mandarin: 'zh',
    中文: 'zh',
    thai: 'th',
    ไทย: 'th',
  }),
]);

/**
 * The language as a two-letter code: a name anywhere in it ("English (US)",
 * "Brazilian Portuguese"), else a code first ("en-US", "pt_BR"); English
 * when unset, null when unknown.
 */
export function languageCode(language: string | null | undefined): string | null {
  const value = (language ?? '').trim().toLowerCase();
  if (!value) return 'en';
  const words = value.split(/[^\p{L}\p{M}]+/u).filter(Boolean);
  const named = words.find((w) => LANGUAGE_NAMES.has(w));
  if (named) return LANGUAGE_NAMES.get(named)!;
  return /^[a-z]{2}$/.test(words[0] ?? '') ? words[0] : null;
}

/** Languages written without spaces between words: their words and sentences can't be counted yet. */
const UNSPACED = new Set(['ja', 'zh', 'th']);

/** A formula's score from the average sentence length and syllables per word. */
function formulaScore(formula: ReadingFormula, asl: number, asw: number): number {
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
      // Syllables per 100 words, and words per sentence: the corrected form
      // (the published one subtracts sentences per 100 words, which rewards
      // long sentences).
      return 206.84 - 0.6 * (asw * 100) - 1.02 * asl;
  }
}

/** Points on a line: full at `full`, none `span` away, in between in proportion. */
const toward = (value: number, full: number, span: number, max: number) =>
  Math.max(0, Math.min(1, 1 - (full - value) / span)) * max;

const PASSIVE =
  /\b(?:am|is|are|was|were|be|been|being)(?:n['’]t)?\s+(?:(?:not|never)\s+)?(?:\w+ly\s+)?(?:(?!(?:indeed|need|speed|seed|feed|bleed|breed|proceed|exceed|succeed)\b)\w+ed|been|born|bought|brought|broken|built|caught|chosen|done|drawn|driven|found|given|grown|heard|held|hidden|kept|known|led|left|lost|made|meant|paid|put|said|seen|sent|set|shown|sold|spent|spoken|taken|taught|thought|told|won|written)\b/i;
/** Words that say little in English business writing, in each of their forms. */
const JARGON =
  /\b(?:leverag\w*|synerg\w*|utili[sz]\w*|paradigm\w*|best-in-class|cutting-edge|world-class|next-generation|game-chang\w*|seamless\w*|holistic\w*|robust\w*|streamlin\w*|empower\w*|disruptive\w*)\b/gi;

/** Question words and the commonest words, in the languages read: no H1's subject. */
const COMMON = new Set([
  ...['what', 'how', 'why', 'when', 'where', 'which', 'who', 'is', 'are', 'was', 'were'],
  ...['do', 'does', 'can', 'the', 'and', 'for', 'with', 'your', 'you', 'best', 'to', 'of'],
  ...['nedir', 'nasıl', 'neden', 'hangi', 'için', 'ile', 'mi', 'mı', 'mu', 'mü', 've', 'en'],
  ...['wie', 'warum', 'wann', 'welche', 'ist', 'sind', 'der', 'die', 'das', 'und', 'für'],
  ...['quoi', 'comment', 'pourquoi', 'quand', 'quel', 'quelle', 'est', 'les', 'des', 'pour'],
  ...['qué', 'cómo', 'por', 'cuándo', 'cuál', 'es', 'son', 'los', 'las', 'para', 'con'],
]);

/**
 * The draft's Readability: its checks and the score over the ones that could
 * be read. `language` is the one the draft is written in (its Language rule,
 * else the brand's), English when unset.
 */
export function readability(
  html: string,
  language: string | null | undefined,
  /**
   * Phase 2 (CE-050): the model's verdict on the paragraph after the H1,
   * with that paragraph's words; it stands while the paragraph is still
   * the first, else the rule reads it.
   */
  aiAnswer: { answers: boolean; block: string; held?: boolean } | null = null,
): Readability {
  const blocks = readBlocks(html);
  const lang = languageCode(language);
  const prose = blocks.filter(isProse);
  const sentences = prose.flatMap((b) => sentencesOf(b.text, lang).map((s) => ({ s, block: b })));
  const sentenceWords = sentences.map(({ s }) => countWords(s));
  const words = sentenceWords.reduce((a, b) => a + b, 0);
  // A Japanese clause reads as one word: no score rather than a made-up one.
  if (lang && UNSPACED.has(lang)) return { score: null, unscored: 'language', checks: [], words };
  if (words < MIN_WORDS || sentences.length === 0) {
    return { score: null, unscored: 'tooShort', checks: [], words };
  }

  const checks: ReadabilityCheck[] = [];
  const check = (c: Omit<ReadabilityCheck, 'max'>) =>
    checks.push({ ...c, max: READABILITY_WEIGHTS[c.id] });

  // Average sentence, 15–20 words, over running text: a list's points are no
  // sentences. Full inside, none 10 words outside.
  const running = sentences.filter(({ block }) => isRunning(block));
  const measured = running.length > 0 ? running : sentences;
  const runningWords = measured.reduce((sum, { s }) => sum + countWords(s), 0);
  const asl = runningWords / measured.length;
  const off =
    asl < SENTENCE_WORDS.min ? SENTENCE_WORDS.min - asl : Math.max(0, asl - SENTENCE_WORDS.max);
  check({
    id: 'avgSentence',
    points: toward(-off, 0, 10, READABILITY_WEIGHTS.avgSentence),
    value: Math.round(asl * 10) / 10,
    // Under the range (-1), in it (0) or over it (1): what the detail says to do.
    count: asl < SENTENCE_WORDS.min ? -1 : asl > SENTENCE_WORDS.max ? 1 : 0,
  });

  // No sentence over 35 words, a list item's too: 3 points off for each.
  const long = sentences.filter((_, i) => sentenceWords[i] > LONG_SENTENCE_WORDS);
  check({
    id: 'longSentences',
    points: Math.max(0, READABILITY_WEIGHTS.longSentences - 3 * long.length),
    value: Math.max(...sentenceWords),
    count: long.length,
    at: long[0]?.s ?? null,
  });

  // Reading level, by the language's formula; else sentence and word length only.
  const allAsl = words / sentences.length;
  const known = lang ? FORMULAS[lang] : undefined;
  if (known && lang) {
    const syllables = sentences
      .flatMap(({ s }) => s.match(WORD) ?? [])
      .reduce((sum, w) => sum + syllablesOf(w, lang), 0);
    const score = formulaScore(known.formula, allAsl, syllables / words);
    const max = READABILITY_WEIGHTS.readingLevel;
    check({
      id: 'readingLevel',
      ...(known.formula === 'flesch'
        ? {
            ...fleschPoints(score, max),
            band: { min: FLESCH_BAND.pass[0], max: FLESCH_BAND.pass[1] },
          }
        : { points: toward(score, known.target, 30, max), count: 0 }),
      value: Math.round(score),
      formula: known.formula,
      target: known.target,
    });
  } else {
    const letters = sentences
      .flatMap(({ s }) => s.match(/[\p{L}\p{M}]+/gu) ?? [])
      .reduce((sum, w) => sum + w.length, 0);
    const awl = letters / words;
    const short = (allAsl <= SENTENCE_WORDS.max ? 0.5 : 0) + (awl <= 6.5 ? 0.5 : 0);
    check({
      id: 'readingLevel',
      points: short * READABILITY_WEIGHTS.readingLevel,
      value: Math.round(awl * 10) / 10,
      count: 0,
      formula: null,
    });
  }

  // Answer first: the first block under the H1 (past a byline, a date or a
  // note) is a short paragraph that names what the H1 asks (a heuristic;
  // Phase 2 reads it with a model, as the API's page read finds the same
  // paragraph). A page without an H1 has nothing to answer, and doesn't pass.
  const h1 = blocks.findIndex((b) => b.tag === 'h1');
  let at = h1 === -1 ? -1 : h1 + 1;
  while (at !== -1 && blocks[at]?.tag === 'p' && isByline(blocks[at].text)) {
    at += 1;
  }
  const first = at === -1 ? undefined : blocks[at];
  const wordsOf = (text: string) => text.toLocaleLowerCase(lang ?? 'en').match(/\p{L}{2,}/gu) ?? [];
  // The H1's subject: its words but the question words and the commonest
  // ones, the longer ones when it has any ("What is AI?" is about "ai").
  const h1Words = (h1 === -1 ? [] : wordsOf(blocks[h1].text)).filter((w) => !COMMON.has(w));
  const subject = new Set(
    h1Words.some((w) => w.length >= 4) ? h1Words.filter((w) => w.length >= 4) : h1Words,
  );
  const read =
    !!first &&
    !!aiAnswer &&
    // Held while the edited page is read again (aiChecksOnPage).
    (!!aiAnswer.held || first.text.replace(/\s+/g, '') === aiAnswer.block.replace(/\s+/g, ''));
  // The model reads whether it answers; it is still a short paragraph to pass.
  const answers = read
    ? aiAnswer!.answers && first.words <= 60
    : !!first &&
      first.tag === 'p' &&
      first.words <= 60 &&
      wordsOf(first.text).some((w) => subject.has(w));
  check({
    id: 'answerFirst',
    points: answers ? READABILITY_WEIGHTS.answerFirst : 0,
    value: first?.words ?? 0,
    count: answers ? 0 : 1,
    at: answers ? null : (first?.text ?? (h1 === -1 ? null : blocks[h1].text)),
    ...(read ? { ai: true } : {}),
  });

  // Short paragraphs: the share with at most 4 sentences.
  const paragraphs = blocks.filter((b) => b.tag === 'p');
  if (paragraphs.length > 0) {
    const longParagraphs = paragraphs.filter(
      (b) => sentencesOf(b.text, lang).length > PARAGRAPH_SENTENCES,
    );
    check({
      id: 'shortParagraphs',
      points:
        READABILITY_WEIGHTS.shortParagraphs *
        ((paragraphs.length - longParagraphs.length) / paragraphs.length),
      value: paragraphs.length,
      count: longParagraphs.length,
      at: longParagraphs[0]?.text ?? null,
    });
  }

  // A heading every 200–300 words: the share of sections within 300.
  const sections: { words: number; first: string | null }[] = [{ words: 0, first: null }];
  for (const b of blocks) {
    if (isHeading(b) && b.tag !== 'h1') sections.push({ words: 0, first: null });
    else if (isProse(b)) {
      const last = sections[sections.length - 1];
      last.words += b.words;
      last.first ??= b.text;
    }
  }
  const filled = sections.filter((s) => s.words > 0);
  const longSections = filled.filter((s) => s.words > SECTION_WORDS);
  check({
    id: 'headingSpacing',
    points:
      READABILITY_WEIGHTS.headingSpacing *
      (filled.length ? (filled.length - longSections.length) / filled.length : 1),
    value: filled.length,
    count: longSections.length,
    at: longSections[0]?.first ?? null,
  });

  // Passive voice and jargon: English only; left out for other languages.
  if (lang === 'en') {
    const passive = sentences.filter(({ s }) => PASSIVE.test(s));
    const jargonIn = sentences.filter(({ s }) => (s.match(JARGON)?.length ?? 0) > 0);
    const jargon = sentences.reduce((n, { s }) => n + (s.match(JARGON)?.length ?? 0), 0);
    const passiveOk = passive.length <= sentences.length * 0.1;
    const jargonOk = jargon <= 2;
    check({
      id: 'passiveJargon',
      points: (READABILITY_WEIGHTS.passiveJargon * ((passiveOk ? 1 : 0) + (jargonOk ? 1 : 0))) / 2,
      value: jargon,
      count: passive.length,
      // Show goes to what falls short: a passive sentence, else one with jargon.
      at: !passiveOk ? (passive[0]?.s ?? null) : !jargonOk ? (jargonIn[0]?.s ?? null) : null,
    });
  }

  const max = checks.reduce((sum, c) => sum + c.max, 0);
  const points = checks.reduce((sum, c) => sum + c.points, 0);
  return { score: Math.round((points / max) * 100), checks, words };
}

/** The type rules check's points before a page type weighs it (weighed keeps its share). */
const TYPE_RULES_POINTS = 10;

/**
 * The page type's own rules as one Readability check (Phase 3, CE-052): the
 * Rules tab's, read from the page (a specs table, a side-by-side table, an
 * intro, a buying FAQ), their share met; the ones turned off there aren't
 * counted. A page too short to read, or a type with none, has none.
 */
export function withTypeRules(
  read: Readability,
  rules: readonly { name: string; met: boolean; detail?: string }[],
): Readability {
  if (read.score === null || rules.length === 0) return read;
  const met = rules.filter((r) => r.met).length;
  const checks: ReadabilityCheck[] = [
    ...read.checks,
    {
      id: 'typeRules',
      points: (TYPE_RULES_POINTS * met) / rules.length,
      max: TYPE_RULES_POINTS,
      value: rules.length,
      count: rules.length - met,
      rules: rules.filter((r) => !r.met).map((r) => ({ name: r.name, detail: r.detail ?? '' })),
    },
  ];
  const max = checks.reduce((sum, c) => sum + c.max, 0);
  const points = checks.reduce((sum, c) => sum + c.points, 0);
  return { ...read, checks, score: Math.round((points / max) * 100) };
}

/** How much a check would add to the score if it were met, rescaled as the score is. */
export function readabilityGain(result: Readability, id: ReadabilityCheckId): number {
  const c = result.checks.find((x) => x.id === id);
  if (!c) return 0;
  const max = result.checks.reduce((sum, x) => sum + x.max, 0);
  return Math.round(((c.max - c.points) / max) * 100);
}
