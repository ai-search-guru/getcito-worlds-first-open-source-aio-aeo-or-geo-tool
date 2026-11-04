import { describe, expect, it } from 'vitest';
import {
  attributeShares,
  biggestGap,
  changeOf,
  parseMentionsPerception,
  shareOf,
  type MentionsPerception,
} from './mentionsPerception';

const raw = {
  window: { from: '2026-09-18T00:00:00Z', to: '2026-10-18T00:00:00Z', days: 30 },
  entities: [
    { entity: 'brand', name: 'Acme Coffee', is_brand: true, mentions: 100, prev_mentions: 80 },
    { entity: 'c1', name: 'Crema Club', is_brand: false, mentions: 50, prev_mentions: 40 },
    { entity: 'c2', name: 'Origin Box', is_brand: false, mentions: 0, prev_mentions: 5 },
  ],
  brand_terms: [{ term: 'fresh roast', answers: 75, prev_answers: 60 }],
  attributes: [
    {
      term: 'fast delivery',
      values: [
        { entity: 'brand', answers: 0 },
        { entity: 'c1', answers: 30 },
        { entity: 'c2', answers: 0 },
      ],
    },
    {
      term: 'fresh roast',
      values: [
        { entity: 'brand', answers: 75 },
        { entity: 'c1', answers: 10 },
        { entity: 'c2', answers: 0 },
      ],
    },
  ],
  co_mentions: [{ competitor_id: 'c1', name: 'Crema Club', co_mentions: 40, prev_co_mentions: 30 }],
};

describe('parseMentionsPerception', () => {
  it("maps the function's jsonb to the page's shape", () => {
    const p = parseMentionsPerception(raw)!;
    expect(p.window.days).toBe(30);
    expect(p.entities[0]).toEqual({
      entity: 'brand',
      name: 'Acme Coffee',
      isBrand: true,
      mentions: 100,
      previousMentions: 80,
    });
    expect(p.brandTerms).toEqual([{ term: 'fresh roast', answers: 75, previousAnswers: 60 }]);
    expect(p.attributes[0].values[1]).toEqual({ entity: 'c1', answers: 30 });
    expect(p.coMentions).toEqual([
      { competitorId: 'c1', name: 'Crema Club', coMentions: 40, previousCoMentions: 30 },
    ]);
  });

  it('is null when there is nothing to read, and empty lists stay empty', () => {
    expect(parseMentionsPerception(null)).toBeNull();
    expect(parseMentionsPerception({})).toEqual({
      window: { from: '', to: '', days: 0 },
      entities: [],
      brandTerms: [],
      attributes: [],
      coMentions: [],
    });
  });
});

describe('shares and changes', () => {
  it('takes shares over mentions, and changes over the window before', () => {
    expect(shareOf(7, 50)).toBe(14);
    expect(shareOf(3, 0)).toBeNull();
    expect(changeOf(75, 60)).toBe(25);
    expect(changeOf(5, 0)).toBeNull();
  });

  it("gives each attribute's share per entity, null without mentions", () => {
    expect(attributeShares(parseMentionsPerception(raw)!)).toEqual([
      { term: 'fast delivery', shares: [0, 60, null] },
      { term: 'fresh roast', shares: [75, 20, null] },
    ]);
  });
});

describe('biggestGap', () => {
  it('finds the attribute a competitor leads by the widest margin', () => {
    expect(biggestGap(parseMentionsPerception(raw)!)).toEqual({
      term: 'fast delivery',
      competitor: 'Crema Club',
      competitorShare: 60,
      brandShare: 0,
      brandRank: null,
    });
  });

  it('ranks the brand when AI uses the term for it too', () => {
    const p: MentionsPerception = {
      ...parseMentionsPerception(raw)!,
      attributes: [
        {
          term: 'integrations',
          values: [
            { entity: 'brand', answers: 10 },
            { entity: 'c1', answers: 40 },
          ],
        },
      ],
    };
    expect(biggestGap(p)).toMatchObject({ competitorShare: 80, brandShare: 10, brandRank: 2 });
  });

  it('leaves out shares taken over fewer than 20 mentions', () => {
    const p = parseMentionsPerception(raw)!;
    const few = (brand: number, competitor: number): MentionsPerception => ({
      ...p,
      entities: [
        { ...p.entities[0], mentions: brand },
        { ...p.entities[1], mentions: competitor },
      ],
    });
    // Crema Club's 30 "fast delivery" answers over 19 mentions; then the brand on 19.
    expect(biggestGap(few(100, 19))).toBeNull();
    expect(biggestGap(few(19, 50))).toBeNull();
    expect(biggestGap(few(20, 50))).toMatchObject({
      term: 'fast delivery',
      competitor: 'Crema Club',
    });
  });

  it('is null when no competitor leads by 20 points', () => {
    const p: MentionsPerception = {
      ...parseMentionsPerception(raw)!,
      attributes: [
        {
          term: 'organic',
          values: [
            { entity: 'brand', answers: 40 },
            { entity: 'c1', answers: 25 },
          ],
        },
      ],
    };
    expect(biggestGap(p)).toBeNull();
  });
});
