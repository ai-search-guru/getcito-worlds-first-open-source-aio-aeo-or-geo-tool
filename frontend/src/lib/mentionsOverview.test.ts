import { describe, expect, it } from 'vitest';
import {
  averagePosition,
  changeBasis,
  isLowSample,
  mentionRate,
  mentionTrend,
  netSentiment,
  parseMentionsOverview,
  relativeChange,
  sentimentSplit,
} from './mentionsOverview';

const raw = {
  window: {
    from: '2026-09-17T06:00:00Z',
    to: '2026-10-17T06:00:00Z',
    days: 30,
    source: 'days',
    day_from: '2026-09-18',
    day_to: '2026-10-17',
  },
  current: {
    answers: 107,
    mentions: 107,
    occurrences: 320,
    positive: 43,
    negative: 21,
    position_sum: 188,
    position_count: 107,
    prompts: 5,
    prompts_with_mentions: 5,
    last_answer_at: '2026-10-16T11:28:06Z',
  },
  previous: null,
  platforms: [
    {
      platform: 'gemini-web',
      answers: 7,
      mentions: 7,
      occurrences: 15,
      positive: 2,
      negative: 2,
      prev_answers: 7,
      prev_mentions: 7,
      prev_positive: 2,
      prev_negative: 2,
      // On the prompts both windows answered (00195).
      same_answers: 5,
      same_mentions: 5,
      same_positive: 2,
      same_negative: 1,
      same_prev_answers: 6,
      same_prev_mentions: 6,
      same_prev_positive: 1,
      same_prev_negative: 2,
    },
  ],
  same: {
    prompts: 4,
    new_prompts: 1,
    dropped_prompts: 2,
    current: { answers: 90, mentions: 90, occurrences: 250, positive: 40, negative: 20 },
    previous: { answers: 80, mentions: 80, occurrences: 200, positive: 30, negative: 30 },
  },
  daily: [{ day: '2026-10-16', answers: 4, mentions: 4, occurrences: 9, positive: 2, negative: 1 }],
  competitors: [
    {
      competitor_id: 'c1',
      name: 'Crema Club',
      mentions: 80,
      co_mentions: 80,
      prev_mentions: 27,
    },
  ],
};

describe('parseMentionsOverview', () => {
  it("maps the function's jsonb to the page's shape", () => {
    const o = parseMentionsOverview(raw)!;
    expect(o.window).toEqual({
      from: '2026-09-17T06:00:00Z',
      to: '2026-10-17T06:00:00Z',
      days: 30,
      source: 'days',
      dayFrom: '2026-09-18',
      dayTo: '2026-10-17',
    });
    expect(o.current).toMatchObject({
      answers: 107,
      mentions: 107,
      occurrences: 320,
      positionSum: 188,
      promptsWithMentions: 5,
      lastAnswerAt: '2026-10-16T11:28:06Z',
    });
    expect(o.platforms[0]).toEqual({
      platform: 'gemini-web',
      answers: 7,
      mentions: 7,
      occurrences: 15,
      positive: 2,
      negative: 2,
      previous: { answers: 7, mentions: 7, positive: 2, negative: 2 },
      same: {
        current: { answers: 5, mentions: 5, positive: 2, negative: 1 },
        previous: { answers: 6, mentions: 6, positive: 1, negative: 2 },
      },
    });
    expect(o.same).toMatchObject({
      prompts: 4,
      newPrompts: 1,
      droppedPrompts: 2,
      current: { occurrences: 250, positive: 40 },
      previous: { occurrences: 200, negative: 30 },
    });
    expect(o.daily).toEqual([
      { day: '2026-10-16', answers: 4, mentions: 4, occurrences: 9, positive: 2, negative: 1 },
    ]);
    expect(o.competitors).toEqual([
      {
        competitorId: 'c1',
        name: 'Crema Club',
        mentions: 80,
        coMentions: 80,
        previousMentions: 27,
      },
    ]);
  });

  it('reads an empty window as zeros, not missing figures', () => {
    const o = parseMentionsOverview(raw)!;
    expect(o.previous).toMatchObject({ answers: 0, mentions: 0, prompts: 0, lastAnswerAt: null });
  });

  it('is null when there is nothing to read', () => {
    expect(parseMentionsOverview(null)).toBeNull();
  });
});

describe('the Overview metrics', () => {
  // The spec's acceptance fixture (§16): one prompt over 2 days on 4
  // platforms is 8 answers; 6 of them name the brand.
  it('counts mentions per answer and the rate over the answers', () => {
    const fixture = { answers: 8, mentions: 6 };
    expect(fixture.mentions).toBe(6);
    expect(mentionRate(fixture)).toBe(75);
    expect(mentionRate({ answers: 0, mentions: 0 })).toBeNull();
  });

  it('splits the tone into shares that add up to 100, neutral kept', () => {
    const split = sentimentSplit({ mentions: 50, positive: 24, negative: 7 })!;
    expect(split).toEqual({ positive: 48, neutral: 38, negative: 14, n: 50 });
    expect(split.positive + split.neutral + split.negative).toBeCloseTo(100, 10);
    expect(sentimentSplit({ mentions: 0, positive: 0, negative: 0 })).toBeNull();
  });

  it('nets positive against negative, −100 to +100', () => {
    expect(netSentiment({ mentions: 50, positive: 24, negative: 7 })).toBe(34);
    expect(netSentiment({ mentions: 4, positive: 0, negative: 4 })).toBe(-100);
    expect(netSentiment({ mentions: 0, positive: 0, negative: 0 })).toBeNull();
  });

  it('marks fewer than 20 mentions as a low sample', () => {
    expect(isLowSample({ mentions: 19 })).toBe(true);
    expect(isLowSample({ mentions: 20 })).toBe(false);
  });

  it('averages the position over the answers that placed the brand', () => {
    expect(averagePosition({ positionSum: 188, positionCount: 107 })).toBeCloseTo(1.757, 3);
    expect(averagePosition({ positionSum: 0, positionCount: 0 })).toBeNull();
  });
});

describe('relativeChange', () => {
  it('is the change in percent, and null with nothing before', () => {
    expect(relativeChange(112, 100)).toBe(12);
    expect(relativeChange(90, 120)).toBe(-25);
    expect(relativeChange(5, 0)).toBeNull();
  });
});

describe('mentionTrend', () => {
  it('lists every day of the window, a day without answers as zero', () => {
    const trend = mentionTrend({
      window: {
        from: '',
        to: '',
        days: 3,
        source: 'days',
        dayFrom: '2026-10-15',
        dayTo: '2026-10-17',
      },
      daily: [
        { day: '2026-10-15', answers: 10, mentions: 4, occurrences: 7, positive: 2, negative: 1 },
        { day: '2026-10-17', answers: 5, mentions: 0, occurrences: 0, positive: 0, negative: 0 },
      ],
    });
    expect(trend).toEqual([
      { day: '2026-10-15', answers: 10, mentions: 4, occurrences: 7, rate: 40, net: 25 },
      { day: '2026-10-16', answers: 0, mentions: 0, occurrences: 0, rate: null, net: null },
      { day: '2026-10-17', answers: 5, mentions: 0, occurrences: 0, rate: 0, net: null },
    ]);
  });
});

describe('changeBasis', () => {
  it('takes the changes on the prompts both windows answered, or on all before 00195', () => {
    const all = { answers: 10, mentions: 5, occurrences: 9 } as never;
    const prevAll = { answers: 12, mentions: 8, occurrences: 20 } as never;
    const shared = { answers: 6, mentions: 4, occurrences: 8 } as never;
    const prevShared = { answers: 6, mentions: 3, occurrences: 5 } as never;
    expect(
      changeBasis({
        current: all,
        previous: prevAll,
        same: {
          prompts: 3,
          newPrompts: 1,
          droppedPrompts: 2,
          current: shared,
          previous: prevShared,
        },
      }),
    ).toEqual({ current: shared, previous: prevShared });
    expect(changeBasis({ current: all, previous: prevAll, same: null })).toEqual({
      current: all,
      previous: prevAll,
    });
  });
});
