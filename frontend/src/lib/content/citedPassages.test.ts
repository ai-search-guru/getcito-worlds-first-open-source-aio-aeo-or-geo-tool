import { describe, expect, it } from 'vitest';
import { passageKey, passageWords, quotedPassages } from './citedPassages';

const LEAD =
  'Northwind forecasts each deal from real activity: emails, meetings and stage changes.';
const SHORT = 'Spreadsheets only show what reps typed.';

describe('passage words', () => {
  it('compares words without case, punctuation or Markdown', () => {
    expect(passageWords('**Northwind** forecasts — each deal’s “real” activity!')).toEqual([
      'northwind',
      'forecasts',
      'each',
      'deals',
      'real',
      'activity',
    ]);
    expect(passageKey('Spreadsheets  show what\nreps typed.')).toBe(
      'spreadsheets show what reps typed',
    );
  });
});

describe('quotedPassages', () => {
  it('finds a passage an answer quotes eight words in a row, per platform', () => {
    const answers = [
      {
        platform: 'chatgpt-web',
        response: 'Northwind **forecasts each deal from real activity: emails**, and calls.',
      },
      {
        platform: 'chatgpt-web',
        response: '- Northwind forecasts each deal from real activity: emails, meetings…',
      },
      {
        platform: 'perplexity-web',
        response:
          'It reads "each deal from real activity: emails, meetings and stage changes" [1].',
      },
      // Six words in a row is a paraphrase, not the wording kept.
      { platform: 'gemini-web', response: 'It forecasts each deal from real activity.' },
    ];
    expect(
      quotedPassages([LEAD, 'Something else entirely, never quoted anywhere.'], answers),
    ).toEqual([
      {
        key: passageKey(LEAD),
        platforms: [
          { platform: 'chatgpt-web', answers: 2 },
          { platform: 'perplexity-web', answers: 1 },
        ],
      },
    ]);
  });

  it('counts a short passage only when an answer has all of it', () => {
    expect(
      quotedPassages(
        [SHORT],
        [
          {
            platform: 'gemini-web',
            response: 'As they put it: spreadsheets only show what reps typed.',
          },
          { platform: 'gemini-web', response: 'Spreadsheets only show what reps did.' },
        ],
      ),
    ).toEqual([{ key: passageKey(SHORT), platforms: [{ platform: 'gemini-web', answers: 1 }] }]);
  });

  it('leaves out headings and labels too short to call a quote', () => {
    expect(
      quotedPassages(
        ['Pricing plans', 'How it works'],
        [{ platform: 'chatgpt-web', response: 'See pricing plans and how it works.' }],
      ),
    ).toEqual([]);
  });

  it('counts an answer once for a passage it quotes twice, and a passage written twice once', () => {
    const response = `${LEAD} Again: ${LEAD}`;
    expect(quotedPassages([LEAD, LEAD], [{ platform: 'chatgpt-web', response }])).toEqual([
      { key: passageKey(LEAD), platforms: [{ platform: 'chatgpt-web', answers: 1 }] },
    ]);
  });
});
