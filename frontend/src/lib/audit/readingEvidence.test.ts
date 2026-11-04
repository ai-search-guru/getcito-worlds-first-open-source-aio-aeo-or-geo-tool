import { describe, expect, it } from 'vitest';
import { firstPersonEvidence, languageName, readingEvidence } from './readingEvidence';

describe('Site Audit’s reading evidence', () => {
  it('reads readability’s parts, and none from an older audit’s Flesch score', () => {
    expect(
      readingEvidence({
        language: 'tr',
        formula: 'atesman',
        readingScore: 81,
        wordsPerSentence: 5.6,
        syllablesPerWord: 2.6,
        lettersPerWord: 6,
        wordsPerParagraph: 33,
        mobileLinesPerParagraph: 6,
      }),
    ).toEqual({
      language: 'tr',
      formula: 'atesman',
      readingScore: 81,
      wordsPerSentence: 5.6,
      syllablesPerWord: 2.6,
      lettersPerWord: 6,
      wordsPerParagraph: 33,
      mobileLinesPerParagraph: 6,
    });
    expect(readingEvidence({ fleschReadingEase: 27 })).toBeNull();
    expect(readingEvidence({ reason: 'not enough text' })).toBeNull();
  });

  it('drops a score and syllables without a formula it knows', () => {
    expect(
      readingEvidence({
        language: 'it',
        formula: 'gulpease',
        readingScore: 60,
        wordsPerSentence: 9,
        syllablesPerWord: 2.2,
        lettersPerWord: 5.1,
      }),
    ).toMatchObject({ formula: null, readingScore: null, syllablesPerWord: null });
  });

  it('reads first person’s count', () => {
    expect(firstPersonEvidence({ language: 'en', firstPersonSentences: 2, sentences: 9 })).toEqual({
      language: 'en',
      firstPersonSentences: 2,
      sentences: 9,
    });
    expect(firstPersonEvidence({ evidencePhrases: 0 })).toBeNull();
  });

  it('names a language in English, else keeps its code', () => {
    expect(languageName('tr')).toBe('Turkish');
    expect(languageName('de')).toBe('German');
    expect(languageName('')).toBe('');
  });
});
