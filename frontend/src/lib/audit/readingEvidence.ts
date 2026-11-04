import type { ReadingFormula } from '@/lib/content/readability';

/**
 * Readability's and first person's evidence as Site Audit writes it
 * (server signals/readability.js readingEvidence, signals/eeat.js
 * firstPerson), read for the Finding line. Null for evidence that isn't
 * theirs: a reason, or an older audit's Flesch score alone.
 */

export interface ReadingEvidence {
  language: string;
  /** Null for a language without a formula yet: read by sentence and word length. */
  formula: ReadingFormula | null;
  readingScore: number | null;
  wordsPerSentence: number;
  /** Counted for a formula only. */
  syllablesPerWord: number | null;
  lettersPerWord: number;
  /** Null for a page without paragraphs (lists only). */
  wordsPerParagraph: number | null;
  mobileLinesPerParagraph: number | null;
}

export interface FirstPersonEvidence {
  language: string;
  firstPersonSentences: number;
  sentences: number;
}

const FORMULAS: readonly ReadingFormula[] = [
  'flesch',
  'atesman',
  'amstad',
  'kandelMoles',
  'fernandezHuerta',
];

const num = (value: unknown) => (typeof value === 'number' ? value : null);

export function readingEvidence(evidence: Record<string, unknown>): ReadingEvidence | null {
  const { language, formula, wordsPerSentence, lettersPerWord } = evidence;
  if (typeof language !== 'string' || num(wordsPerSentence) === null) return null;
  if (num(lettersPerWord) === null) return null;
  const known = FORMULAS.find((f) => f === formula) ?? null;
  return {
    language,
    formula: known,
    readingScore: known ? num(evidence.readingScore) : null,
    wordsPerSentence: wordsPerSentence as number,
    syllablesPerWord: known ? num(evidence.syllablesPerWord) : null,
    lettersPerWord: lettersPerWord as number,
    wordsPerParagraph: num(evidence.wordsPerParagraph),
    mobileLinesPerParagraph: num(evidence.mobileLinesPerParagraph),
  };
}

export function firstPersonEvidence(evidence: Record<string, unknown>): FirstPersonEvidence | null {
  const { language, firstPersonSentences, sentences } = evidence;
  if (typeof language !== 'string') return null;
  const found = num(firstPersonSentences);
  const total = num(sentences);
  return found === null || total === null
    ? null
    : { language, firstPersonSentences: found, sentences: total };
}

let names: Intl.DisplayNames | null = null;
/** A two-letter language code by its English name ("tr" → "Turkish"), else the code. */
export function languageName(code: string): string {
  // Node 20's Intl names an empty code "root" instead of throwing.
  if (!code) return '';
  try {
    names ??= new Intl.DisplayNames(['en'], { type: 'language' });
    return names.of(code) ?? code;
  } catch {
    return code;
  }
}
