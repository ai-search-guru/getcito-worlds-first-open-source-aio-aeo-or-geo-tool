import { describe, expect, it } from 'vitest';
import {
  OWN_BRAND_COLOR,
  parseTrendMarkers,
  trendAxisTop,
  trendLines,
  trendMarkers,
} from './insightsTrend';

const entity = (key: string, isOwnBrand = false) => ({ key, name: key.toUpperCase(), isOwnBrand });
const entities = [
  entity('you', true),
  entity('a'),
  entity('b'),
  entity('c'),
  entity('d'),
  entity('e'),
];

const point = (day: string, values: Record<string, number> = {}) => ({
  date: day.slice(5),
  day,
  values,
});

describe('trendLines', () => {
  const points = [
    point('2026-10-01', { a: 10, b: 50, c: 30, d: 20, e: 40 }),
    point('2026-10-02', { a: 60, b: 50, c: 30, d: 20, e: 40 }),
  ];

  it('draws you and the pinned competitors in pin order, whatever the scores', () => {
    const lines = trendLines(entities, points, ['d', 'gone', 'a']);

    expect(lines.map((l) => l.key)).toEqual(['you', 'd', 'a']);
    expect(lines[0].color).toBe(OWN_BRAND_COLOR);
    // A pin keeps its color when the range (and so the ranking) changes.
    expect(trendLines(entities, points.slice(0, 1), ['d', 'a'])[1].color).toBe(lines[1].color);
  });

  it('draws the strongest four at the end of the range without pins', () => {
    expect(trendLines(entities, points, []).map((l) => l.key)).toEqual(['you', 'a', 'b', 'e', 'c']);
  });
});

describe('trendMarkers', () => {
  const points = [point('2026-09-29'), point('2026-10-01'), point('2026-10-04')];

  it('puts each marker on the point of its day, or the next one with a point', () => {
    const markers = trendMarkers(
      {
        promptsAdded: [
          { day: '2026-09-29', count: 509 },
          { day: '2026-10-03', count: 12 },
        ],
        goal: null,
      },
      points,
    );

    expect(markers).toEqual([
      { kind: 'prompts', day: '2026-09-29', date: '09-29', count: 509 },
      { kind: 'prompts', day: '2026-10-03', date: '10-04', count: 12 },
    ]);
  });

  it('keeps the three biggest prompt days', () => {
    const markers = trendMarkers(
      {
        promptsAdded: [
          { day: '2026-09-29', count: 5 },
          { day: '2026-09-30', count: 50 },
          { day: '2026-10-01', count: 2 },
          { day: '2026-10-02', count: 40 },
        ],
        goal: null,
      },
      points,
    );

    expect(markers.map((m) => m.day)).toEqual(['2026-09-29', '2026-09-30', '2026-10-02']);
  });

  it('lists a day after the last point without placing it on the chart', () => {
    expect(
      trendMarkers({ promptsAdded: [{ day: '2026-10-05', count: 3 }], goal: null }, points),
    ).toEqual([{ kind: 'prompts', day: '2026-10-05', date: null, count: 3 }]);
  });
});

describe('parseTrendMarkers', () => {
  it('reads the RPC payload, leaving the actions sent out', () => {
    expect(
      parseTrendMarkers({
        prompts_added: [{ day: '2026-10-12', count: '7' }],
        actions_sent: [{ day: '2026-10-13', action_nos: ['3', 4] }],
      }),
    ).toEqual({ promptsAdded: [{ day: '2026-10-12', count: 7 }] });
    expect(parseTrendMarkers(null)).toEqual({ promptsAdded: [] });
  });
});

describe('trendAxisTop', () => {
  it('keeps the goal on the chart', () => {
    expect(trendAxisTop([12, 17.4], null)).toBe(25);
    expect(trendAxisTop([12, 17.4], 50)).toBe(55);
    expect(trendAxisTop([], null)).toBe(5);
  });
});
