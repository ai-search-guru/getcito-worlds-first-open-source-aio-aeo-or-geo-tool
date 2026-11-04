import { describe, expect, it } from 'vitest';
import {
  eventWeeks,
  parseTimelineEvents,
  timelineSince,
  weekStart,
  weeklyMentions,
} from './competitorTimeline';

/** A competitor's pages over time (learning C3), as the Competitors page reads them. */

// A Wednesday.
const NOW = new Date('2026-10-29T10:00:00Z');

describe('weeks', () => {
  it('start on Monday, and the chart reads twelve of them, this one last', () => {
    expect(weekStart('2026-10-29')).toBe('2026-10-26');
    expect(weekStart('2026-10-26T23:00:00Z')).toBe('2026-10-26');
    expect(weekStart('2026-11-01')).toBe('2026-10-26');
    expect(timelineSince(NOW)).toBe('2026-08-10');
  });

  it("sum each week's mentioning answers, a week with none at 0", () => {
    const weeks = weeklyMentions(
      [
        { day: '2026-10-27', mention_answers: 3 },
        { day: '2026-10-28', mention_answers: 2 },
        { day: '2026-08-01', mention_answers: 9 },
      ],
      [
        { day: '2026-10-29', mention_answers: 7 },
        { day: '2026-10-20', mention_answers: null },
      ],
      NOW,
    );
    expect(weeks).toHaveLength(12);
    expect(weeks[0]).toEqual({ week: '2026-08-10', brand: 0, competitor: 0 });
    expect(weeks.at(-1)).toEqual({ week: '2026-10-26', brand: 5, competitor: 7 });
    expect(weeks.at(-2)).toEqual({ week: '2026-10-19', brand: 0, competitor: 0 });
  });
});

describe('parseTimelineEvents', () => {
  it('reads the events, newest first, and nothing it does not know', () => {
    expect(
      parseTimelineEvents([
        {
          kind: 'first_cited',
          at: '2026-10-03T00:00:00Z',
          url: 'https://rival.com/kettles',
          domain: 'rival.com',
          detail: { answers: 4 },
        },
        {
          kind: 'changed',
          at: '2026-10-21T03:00:00Z',
          url: 'https://rival.com/kettles',
          domain: 'rival.com',
          detail: {
            similarity: 0.6,
            gained: [{ key: 'faq-schema', label: 'FAQ schema' }, { key: 'tables' }, 'x'],
            lost: [],
          },
        },
        { kind: 'other', at: '2026-10-21T03:00:00Z', url: 'https://rival.com/x' },
        { kind: 'changed', at: 'yesterday', url: 'https://rival.com/x' },
        { kind: 'changed', at: '2026-10-21T03:00:00Z', url: 'javascript:alert(1)' },
      ]),
    ).toEqual([
      {
        kind: 'changed',
        at: '2026-10-21T03:00:00Z',
        url: 'https://rival.com/kettles',
        domain: 'rival.com',
        answers: null,
        gained: [
          { key: 'faq-schema', label: 'FAQ schema' },
          { key: 'tables', label: 'tables' },
        ],
        lost: [],
      },
      {
        kind: 'first_cited',
        at: '2026-10-03T00:00:00Z',
        url: 'https://rival.com/kettles',
        domain: 'rival.com',
        answers: 4,
        gained: [],
        lost: [],
      },
    ]);
  });
});

describe('eventWeeks', () => {
  it("marks the chart's weeks with events, by kind, and none outside it", () => {
    const weeks = weeklyMentions([], [], NOW);
    const event = (kind: 'first_cited' | 'changed', at: string) => ({
      kind,
      at,
      url: 'https://rival.com/a',
      domain: 'rival.com',
      answers: null,
      gained: [],
      lost: [],
    });
    expect(
      eventWeeks(
        [
          event('changed', '2026-10-28T03:00:00Z'),
          event('first_cited', '2026-10-27T00:00:00Z'),
          event('first_cited', '2026-10-06T00:00:00Z'),
          event('first_cited', '2026-01-01T00:00:00Z'),
        ],
        weeks,
      ),
    ).toEqual([
      { week: '2026-10-05', firstCited: 1, changed: 0 },
      { week: '2026-10-26', firstCited: 1, changed: 1 },
    ]);
  });
});
