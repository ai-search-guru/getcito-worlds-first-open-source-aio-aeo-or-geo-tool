import { describe, expect, it } from 'vitest';
import {
  answerFits,
  answerWords,
  askAnswerInput,
  askToolInput,
  composerAnswer,
  recommendedLabel,
  type AskAnswer,
} from './asks';

/**
 * Question cards (CHAT-07 §A, §B): a question has 2–4 options, exactly one
 * Recommended; an answer fits its question or is refused; and the answer in
 * words for its collapsed line.
 */

const ASK = {
  options: [{ label: '/pricing', recommended: true }, { label: '/features' }, { label: '/blog' }],
  allowOther: false,
  multi: false,
};
const answer = (over: Partial<AskAnswer> = {}): AskAnswer => ({
  selected: [],
  other: null,
  skipped: false,
  via: 'card',
  ...over,
});

describe('askToolInput', () => {
  const options = (...recommended: boolean[]) =>
    recommended.map((r, i) => ({ label: `Option ${i + 1}`, ...(r ? { recommended: true } : {}) }));

  it('takes 2–4 options with exactly one Recommended', () => {
    expect(
      askToolInput.safeParse({ question: 'Which?', options: options(true, false) }).success,
    ).toBe(true);
    expect(
      askToolInput.safeParse({ question: 'Which?', options: options(false, true, false, false) })
        .success,
    ).toBe(true);
    for (const bad of [
      options(true),
      options(true, false, false, false, false),
      options(false, false),
      options(true, true),
    ]) {
      expect(askToolInput.safeParse({ question: 'Which?', options: bad }).success).toBe(false);
    }
    expect(askToolInput.safeParse({ question: ' ', options: options(true, false) }).success).toBe(
      false,
    );
  });
});

describe('askAnswerInput', () => {
  it('fills in an answer from the card and refuses an option past the fourth', () => {
    expect(askAnswerInput.parse({ n: 2 })).toEqual({
      n: 2,
      selected: [],
      skipped: false,
      via: 'card',
    });
    expect(askAnswerInput.safeParse({ n: 2, selected: [4] }).success).toBe(false);
    expect(askAnswerInput.safeParse({ n: 0 }).success).toBe(false);
  });
});

describe('answerFits', () => {
  it('takes one option of a single-pick question, and several of a multi one', () => {
    expect(answerFits(ASK, answer({ selected: [1] }))).toBe(true);
    expect(answerFits(ASK, answer({ selected: [0, 1] }))).toBe(false);
    expect(answerFits({ ...ASK, multi: true }, answer({ selected: [0, 2] }))).toBe(true);
    expect(answerFits({ ...ASK, multi: true }, answer({ selected: [0, 0] }))).toBe(false);
  });

  it('refuses nothing picked, an option it hasn’t, and a skip that picks', () => {
    expect(answerFits(ASK, answer())).toBe(false);
    expect(answerFits(ASK, answer({ selected: [3] }))).toBe(false);
    expect(answerFits(ASK, answer({ skipped: true }))).toBe(true);
    expect(answerFits(ASK, answer({ skipped: true, selected: [0] }))).toBe(false);
    expect(answerFits(ASK, answer({ skipped: true, other: 'x' }))).toBe(false);
  });

  it('takes Other only where the card offers it, or from the composer', () => {
    expect(answerFits(ASK, answer({ other: 'The blog' }))).toBe(false);
    expect(answerFits({ ...ASK, allowOther: true }, answer({ other: 'The blog' }))).toBe(true);
    expect(answerFits(ASK, answer({ other: 'The blog', via: 'composer' }))).toBe(true);
    // Single pick: an option and Other are two picks.
    expect(
      answerFits({ ...ASK, allowOther: true }, answer({ selected: [0], other: 'The blog' })),
    ).toBe(false);
  });
});

describe('composerAnswer', () => {
  it('picks the option a message names, and takes any other text as Other', () => {
    expect(composerAnswer(ASK, ' /Features ')).toEqual({
      selected: [1],
      other: null,
      skipped: false,
    });
    // Case, spacing, accents and Turkish dotted and dotless i aside.
    const turkish = {
      options: [{ label: 'İletişim  Sayfası', recommended: true }, { label: 'x' }],
    };
    expect(composerAnswer(turkish, 'iletişim sayfasi').selected).toEqual([0]);
    expect(composerAnswer(turkish, 'ILETIŞIM SAYFASI').selected).toEqual([0]);
    expect(composerAnswer(ASK, 'The blog, under 60 words')).toEqual({
      selected: [],
      other: 'The blog, under 60 words',
      skipped: false,
    });
  });
});

describe('the answer in words', () => {
  it('joins the labels and the text, and names the Recommended option a skip went on with', () => {
    const skipped = (option: string) => `Skipped · used ${option}`;
    expect(answerWords(ASK, answer({ selected: [0, 2], other: 'The blog' }), skipped)).toBe(
      '/pricing, /blog, The blog',
    );
    expect(answerWords(ASK, answer({ skipped: true }), skipped)).toBe('Skipped · used /pricing');
    expect(recommendedLabel({ options: [{ label: 'A' }, { label: 'B', recommended: true }] })).toBe(
      'B',
    );
    expect(recommendedLabel({ options: [{ label: 'A' }, { label: 'B' }] })).toBe('A');
  });
});
