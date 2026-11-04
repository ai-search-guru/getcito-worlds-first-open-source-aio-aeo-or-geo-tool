import { describe, expect, it } from 'vitest';
import { computeAiVisibilityScore } from './visibilityScore';
import {
  heatShade,
  parseTopicCompetitors,
  topicHeatmap,
  type TopicCompetitors,
} from './insightsTopics';

const comps = (mentions: number) => ({
  mentionAnswers: mentions,
  citationAnswers: 0,
  sumInvPosition: 0,
  positionCount: 0,
});

const topic = (
  topicId: string,
  answers: number,
  you: number,
  competitors: Record<string, number>,
): TopicCompetitors => ({
  topicId,
  name: topicId.toUpperCase(),
  prompts: 3,
  answers,
  brand: comps(you),
  competitors: Object.fromEntries(Object.entries(competitors).map(([id, m]) => [id, comps(m)])),
});

const score = (answers: number, mentions: number) =>
  Math.round(
    computeAiVisibilityScore({
      answers,
      mentionAnswers: mentions,
      citationAnswers: 0,
      positionFactor: null,
    })! * 10,
  ) / 10;

describe('topicHeatmap', () => {
  it('scores every column over your answers in the topic', () => {
    const [row] = topicHeatmap([topic('crm', 100, 20, { a: 60 })], ['you', 'a', 'b']);

    // A competitor never named in the topic scores 0 there.
    expect(row.scores).toEqual([score(100, 20), score(100, 60), score(100, 0)]);
    expect(row).toMatchObject({
      status: 'behind',
      leader: 'a',
      gap: Math.round((score(100, 20) - score(100, 60)) * 10) / 10,
    });
  });

  it('puts the topics you lead first, then the biggest gaps, then low samples', () => {
    const rows = topicHeatmap(
      [
        topic('small-gap', 100, 40, { a: 50 }),
        topic('lead', 100, 80, { a: 50 }),
        topic('few', 10, 1, { a: 9 }),
        topic('big-gap', 100, 10, { a: 70 }),
      ],
      ['you', 'a'],
    );

    expect(rows.map((r) => [r.topicId, r.status])).toEqual([
      ['lead', 'lead'],
      ['big-gap', 'behind'],
      ['small-gap', 'behind'],
      ['few', 'lowSample'],
    ]);
    expect(rows[0]).toMatchObject({ gap: null, leader: 'you' });
    expect(rows[3].gap).toBeNull();
  });

  it('reads a tie at the top as a lead', () => {
    expect(topicHeatmap([topic('tie', 100, 50, { a: 50 })], ['you', 'a'])[0].status).toBe('lead');
  });
});

describe('heatShade', () => {
  it('spreads the tones over the scores in view', () => {
    // A table of 50s to 80s still reads in steps.
    // Quarters of the range: 50–57.5, 57.5–65, 65–72.5, 72.5–80.
    expect([50, 56, 62, 70, 80].map((v) => heatShade(v, 50, 80))).toEqual([1, 1, 2, 3, 4]);
    expect([12, 48.6].map((v) => heatShade(v, 12, 48.6))).toEqual([1, 4]);
  });

  it('keeps a score of 0 the lightest, and one score the middle', () => {
    expect(heatShade(0, 50, 80)).toBe(0);
    expect(heatShade(60, 60, 60)).toBe(2);
  });
});

describe('parseTopicCompetitors', () => {
  it("hides the map when the caller can't read the brand: the RPC returns null (00152)", () => {
    expect(parseTopicCompetitors(null)).toBeNull();
  });

  it('reads the RPC payload and refuses rollups not yet backfilled', () => {
    const [parsed] = parseTopicCompetitors({
      complete: true,
      topics: [
        {
          topic_id: 't1',
          name: 'CRM',
          prompts: '3',
          answers: '59',
          mention_answers: 59,
          competitors: [{ competitor_id: 'c1', mention_answers: '39', position_count: 2 }],
        },
      ],
    })!;

    expect(parsed).toMatchObject({ topicId: 't1', name: 'CRM', prompts: 3, answers: 59 });
    expect(parsed.brand.mentionAnswers).toBe(59);
    expect(parsed.competitors.c1).toEqual({
      mentionAnswers: 39,
      citationAnswers: 0,
      sumInvPosition: 0,
      positionCount: 2,
    });
    expect(parseTopicCompetitors({ complete: false, topics: [] })).toBeNull();
  });
});
