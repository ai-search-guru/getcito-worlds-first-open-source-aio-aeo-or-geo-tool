import { describe, expect, it } from 'vitest';
import { matchPagePrompts, pageHeadingWords } from './pagePrompts';

/** The prompts a page brought in answers: its title's and headings' words. */
describe('matchPagePrompts', () => {
  const prompts = [
    { id: 'guide', text: 'What is a coffee subscription?' },
    { id: 'price', text: 'How much does a coffee subscription cost?' },
    { id: 'beans', text: 'Best single origin beans for espresso' },
    { id: 'one', text: 'Coffee gifts' },
  ];

  it('keeps the prompts most of whose words the page uses, the most in common first', () => {
    const html =
      '<h1>How to choose a coffee subscription</h1><p>Body text about espresso beans.</p>' +
      '<h2>What does a subscription cost?</h2>';
    expect(matchPagePrompts('Coffee subscriptions', html, prompts)).toEqual(['price', 'guide']);
  });

  it('reads only the title and headings, not the body', () => {
    expect(pageHeadingWords('Guide', '<h3>Fresh &amp; local</h3><p>espresso</p>')).toEqual(
      new Set(['guide', 'fresh', 'local']),
    );
  });

  it('keeps none for one shared word, and at most the cap', () => {
    expect(matchPagePrompts('Coffee', '<h1>Coffee</h1>', prompts)).toEqual([]);
    const many = Array.from({ length: 12 }, (_, i) => ({
      id: `p${i}`,
      text: 'coffee subscription',
    }));
    expect(matchPagePrompts('Coffee subscription', '', many)).toHaveLength(10);
  });
});
