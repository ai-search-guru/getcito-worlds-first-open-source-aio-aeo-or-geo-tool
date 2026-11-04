import { describe, expect, it } from 'vitest';
import { recountRow } from './mentionRecount.js';

const brandInfo = { brandName: 'Acme', domains: ['acme.example'] };
const competitors = [
  { id: 'c1', name: 'Rival', domain: 'rival.example' },
  { id: 'c2', name: 'Other', domain: '' },
];

/** A stored answer as the backfill reads it, its counts as they were saved. */
const stored = (response, over = {}) => ({
  response,
  citations: [],
  sentiment: 'neutral',
  mention_count: 0,
  visibility_score: 0,
  mention_position: null,
  mentioned_entity_count: 0,
  competitor_mentions: [
    {
      competitor_id: 'c1',
      name: 'Rival',
      mention_count: 0,
      visibility_score: 0,
      mention_position: null,
    },
    {
      competitor_id: 'c2',
      name: 'Other',
      mention_count: 0,
      visibility_score: 0,
      mention_position: null,
    },
  ],
  ...over,
});

/** The row as it reads once `next` is written. */
const written = (row, next) => ({ ...row, ...next });

describe('recountRow', () => {
  // ChatGPT's tag for Acme, whose disambig names Rival: saved before #1097,
  // Rival counted as named first and Acme second.
  const tagged =
    'Pick <Entity category="software" value="Acme" disambig="Rival alternative"/> for teams. Other is fine too.';

  it('cleans the tags out of the text and counts what the answer reads', () => {
    const row = stored(tagged, {
      mention_count: 1,
      mention_position: 2,
      mentioned_entity_count: 3,
      competitor_mentions: [
        {
          competitor_id: 'c1',
          name: 'Rival',
          mention_count: 1,
          visibility_score: 30,
          mention_position: 1,
        },
        {
          competitor_id: 'c2',
          name: 'Other',
          mention_count: 1,
          visibility_score: 30,
          mention_position: 3,
        },
      ],
    });
    const next = recountRow(row, brandInfo, competitors, { cleanMarkup: true });

    expect(next.response).toBe('Pick Acme for teams. Other is fine too.');
    expect(next.mention_count).toBe(1);
    expect(next.mention_position).toBe(1);
    expect(next.mentioned_entity_count).toBe(2);
    // Rival was only in the tag's disambig.
    expect(next.competitor_mentions[0]).toMatchObject({
      competitor_id: 'c1',
      mention_count: 0,
      mention_position: null,
    });
    expect(next.competitor_mentions[1]).toMatchObject({
      competitor_id: 'c2',
      mention_count: 1,
      mention_position: 2,
    });
    // Run again over what it wrote: nothing left to change.
    expect(
      recountRow(written(row, next), brandInfo, competitors, { cleanMarkup: true }),
    ).toBeNull();
  });

  it('keeps the text as it is without cleanMarkup, and counts as the parser reads it', () => {
    const next = recountRow(stored(tagged), brandInfo, competitors);
    // The parser reads the answer without its tags either way.
    expect(next.response).toBeUndefined();
    expect(next.mention_count).toBe(1);
    expect(next.competitor_mentions[0].mention_count).toBe(0);
  });

  it('writes nothing for an answer already counted as it reads', () => {
    const row = stored('Acme leads.', {});
    const next = recountRow(row, brandInfo, competitors, { cleanMarkup: true });
    expect(next.response).toBeUndefined();
    expect(
      recountRow(written(row, next), brandInfo, competitors, { cleanMarkup: true }),
    ).toBeNull();
  });

  it('leaves a tag without a value in the text, and writes nothing more for it', () => {
    const text = 'See <Entity category="software"/> and Acme.';
    const row = stored(text);
    const next = recountRow(row, brandInfo, competitors, { cleanMarkup: true });
    expect(next.response).toBeUndefined();
    expect(
      recountRow(written(row, next), brandInfo, competitors, { cleanMarkup: true }),
    ).toBeNull();
  });

  it('reads an answer that no longer names the brand as neutral, as one is saved', () => {
    // The brand only in the tag's disambig: its sentiment was read as if named.
    const row = stored(
      'Try <Entity category="software" value="Rival" disambig="Acme alternative"/> today.',
      { sentiment: 'positive', mention_count: 1, visibility_score: 55, mention_position: 2 },
    );
    const next = recountRow(row, brandInfo, competitors, { cleanMarkup: true });
    expect(next).toMatchObject({
      response: 'Try Rival today.',
      sentiment: 'neutral',
      mention_count: 0,
      mention_position: null,
    });
    // Positive no longer lifts the score of an answer that doesn't name it.
    expect(next.visibility_score).toBe(
      recountRow(stored('Try Rival today.'), brandInfo, competitors)?.visibility_score ?? 0,
    );
    expect(
      recountRow(written(row, next), brandInfo, competitors, { cleanMarkup: true }),
    ).toBeNull();
    // Still named: its sentiment stays as it was read.
    const named = stored('Acme leads.', { sentiment: 'positive' });
    expect(recountRow(named, brandInfo, competitors)?.sentiment).toBeUndefined();
  });

  it('keeps an entry whose competitor is gone as it was', () => {
    const gone = {
      competitor_id: 'c9',
      name: 'Gone',
      mention_count: 4,
      visibility_score: 50,
      mention_position: 1,
    };
    const row = stored('Acme and Rival.', { competitor_mentions: [gone] });
    const next = recountRow(row, brandInfo, competitors, { cleanMarkup: true });
    expect(next.competitor_mentions).toEqual([gone]);
  });
});
