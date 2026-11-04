import { describe, expect, it } from 'vitest';
import { answerProse, highlightSegments, mentionExcerpt } from './mentionMatch';

describe('answerProse', () => {
  it('reads the answer as prose: link labels, no URLs, no markdown marks', () => {
    expect(
      answerProse(
        '## Best picks\n\n- **[Acme](https://acme.com/x)** is great, see https://acme.com\n> `quoted`\n1. #1 pick',
      ),
    ).toBe('Best picks Acme is great, see quoted 1. #1 pick');
  });
});

describe('mentionExcerpt', () => {
  const long = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');

  it('quotes around the first mention, cut on whole words', () => {
    const text = `${long(40)} and then Acme Coffee roasts well. ${long(40)}`;
    const excerpt = mentionExcerpt(text, ['Acme Coffee', 'acme.com']);
    expect(excerpt.startsWith('…word')).toBe(true);
    expect(excerpt.endsWith('…')).toBe(true);
    expect(excerpt).toContain('and then Acme Coffee roasts well.');
    // Whole words only at both ends.
    expect(excerpt).toMatch(/^…word\d+ /);
    expect(excerpt).toMatch(/ word\d+…$/);
  });

  it('matches a whole word only, ignoring case, and not inside a URL', () => {
    expect(mentionExcerpt('Acmeville is not it. Then ACME COFFEE.', ['Acme Coffee'])).toBe(
      'Acmeville is not it. Then ACME COFFEE.',
    );
    const text = `See https://acme.com/acme-coffee for ${long(60)} later acme.com appears`;
    expect(mentionExcerpt(text, ['acme.com'])).toMatch(/later acme\.com appears$/);
  });

  it("opens with the answer's start when no name matches", () => {
    const excerpt = mentionExcerpt(long(80), ['Acme']);
    expect(excerpt.startsWith('word0 word1')).toBe(true);
    expect(excerpt.endsWith('…')).toBe(true);
  });
});

describe('highlightSegments', () => {
  it('marks the brand and competitors, the longer name first', () => {
    expect(
      highlightSegments('Acme Coffee beats Acme Roasters and crema club.', {
        brand: ['Acme Coffee'],
        competitors: ['Crema Club', 'Acme Roasters'],
      }),
    ).toEqual([
      { text: 'Acme Coffee', kind: 'brand' },
      { text: ' beats ' },
      { text: 'Acme Roasters', kind: 'competitor' },
      { text: ' and ' },
      { text: 'crema club', kind: 'competitor' },
      { text: '.' },
    ]);
  });

  it('leaves text without names whole', () => {
    expect(highlightSegments('Nothing here', { brand: ['Acme'], competitors: [] })).toEqual([
      { text: 'Nothing here' },
    ]);
    expect(highlightSegments('Text', { brand: [], competitors: [] })).toEqual([{ text: 'Text' }]);
  });
});
