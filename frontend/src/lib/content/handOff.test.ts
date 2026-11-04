import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HANDOFF_KEYS, handOffItems } from './handOff';

/** Hand off (CE-051): what of Quality's suggestions the agent fixes in one run. */

const suggestion = (
  key: string,
  over: Partial<{ gain: number; show: string | null; handOff: false }> = {},
) => ({
  key,
  gain: 5,
  line: `${key} line`,
  detail: `${key} detail`,
  show: null as string | null,
  ...over,
});

describe('handOffItems', () => {
  it('sends each fixable suggestion with a gain once, with its line, detail and passage', () => {
    expect(
      handOffItems([
        suggestion('readability:longSentences', { show: 'A very long sentence.' }),
        suggestion('trust:claimsSourced'),
        suggestion('readability:longSentences'),
        // Nothing to gain, or a key it doesn't fix (a to-do's): left out.
        suggestion('readability:avgSentence', { gain: 0 }),
        suggestion('eeat:experience'),
        // One that asks the other way to its check (sentences too short): the person's.
        suggestion('readability:readingLevel', { handOff: false }),
      ]),
    ).toEqual([
      {
        key: 'readability:longSentences',
        detail:
          'readability:longSentences line · readability:longSentences detail · Where: "A very long sentence."',
      },
      {
        key: 'trust:claimsSourced',
        detail: 'trust:claimsSourced line · trust:claimsSourced detail',
      },
    ]);
  });

  it('sends the disclosure only with its line in the page’s language, and keeps each detail short', () => {
    const disclosure = suggestion('trust:disclosure');
    expect(handOffItems([disclosure])).toEqual([]);
    expect(handOffItems([disclosure], { disclosureLine: 'Disclosure: offered by Acme.' })).toEqual([
      {
        key: 'trust:disclosure',
        detail:
          'trust:disclosure line · trust:disclosure detail · The line: "Disclosure: offered by Acme."',
      },
    ]);
    const long = suggestion('trust:claimsSourced', { show: 'x'.repeat(900) });
    const [cut] = handOffItems([long]);
    expect(cut.detail).toHaveLength(500);
    expect(cut.detail).toMatch(
      /^trust:claimsSourced line · trust:claimsSourced detail · Where: "x+…"$/,
    );
  });

  it('cuts the passage, never the disclosure line the agent writes as given', () => {
    const line = `Disclosure: the product this page recommends is offered by ${'Acme '.repeat(30)}.`;
    const [item] = handOffItems([suggestion('trust:disclosure', { show: 'y'.repeat(400) })], {
      disclosureLine: line,
    });
    expect(item.detail.length).toBeLessThanOrEqual(500);
    expect(item.detail).toContain(`The line: "${line}"`);
    expect(item.detail).toMatch(/Where: "y+…"$/);
  });

  it('knows the checks the API fixes, as the API names them', () => {
    const server = readFileSync(
      join(__dirname, '../../../../backend/src/lib/contentHandoff.js'),
      'utf8',
    );
    const block = server.slice(server.indexOf('HANDOFF_CHECKS = {'), server.indexOf('};'));
    const keys = [...block.matchAll(/^\s*'([a-z]+:[A-Za-z]+)':/gm)].map((m) => m[1]);
    expect(keys).toHaveLength(16);
    expect([...HANDOFF_KEYS].sort()).toEqual(keys.sort());
  });
});
