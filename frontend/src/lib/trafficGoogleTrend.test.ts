import { describe, expect, it } from 'vitest';
import { GOOGLE_TREND_MAX_DAYS, googleTrend, googleTrendDays } from './trafficGoogleTrend';
import type { TrafficGoogleTrend, TrafficTrendPoint } from '@/lib/actions/traffic';

/** The trend's "vs Google clicks" view (AT-008, spec §3.3). */

const trend: TrafficTrendPoint[] = [
  { date: '2026-10-10', 'chatgpt.com': 0, 'perplexity.ai': 0 },
  { date: '2026-10-11', 'chatgpt.com': 2, 'perplexity.ai': 2 },
  { date: '2026-10-12', 'chatgpt.com': 5, 'perplexity.ai': 1 },
  { date: '2026-10-13', 'chatgpt.com': 0, 'perplexity.ai': 0 },
  { date: '2026-10-14', 'chatgpt.com': 8, 'perplexity.ai': 2 },
];

const google = (over: Partial<TrafficGoogleTrend> = {}): TrafficGoogleTrend => ({
  firstDay: '2026-10-11',
  lastDay: '2026-10-13',
  clicks: [
    { day: '2026-10-11', clicks: 200 },
    { day: '2026-10-12', clicks: 150 },
  ],
  markers: [{ day: '2026-10-12', actions: 2, prompts: 0 }],
  ...over,
});

describe('googleTrendDays', () => {
  it('lists every day from the first to the last, quiet days included', () => {
    expect(
      googleTrendDays([
        { date: '2026-10-10', 'chatgpt.com': 1 },
        { date: '2026-10-13', 'chatgpt.com': 2 },
      ]),
    ).toEqual(['2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13']);
  });

  it('leaves out a first day the range starts in the middle of', () => {
    const week = [
      { date: '2026-10-12', 'chatgpt.com': 1 },
      { date: '2026-10-13', 'chatgpt.com': 4 },
      { date: '2026-10-14', 'chatgpt.com': 5 },
    ];
    expect(googleTrendDays(week, '2026-10-12T09:30:00.000Z')).toEqual(['2026-10-13', '2026-10-14']);
    expect(googleTrendDays(week, '2026-10-12')).toEqual(['2026-10-12', '2026-10-13', '2026-10-14']);
    expect(googleTrendDays(week)).toHaveLength(3);
  });

  it('is null for an hourly trend, and keeps at most a year', () => {
    expect(googleTrendDays([{ date: '2026-10-17T13:00:00.000Z', 'chatgpt.com': 1 }])).toBeNull();
    const days = googleTrendDays([
      { date: '2024-01-01', 'chatgpt.com': 1 },
      { date: '2026-10-13', 'chatgpt.com': 1 },
    ]);
    expect(days).toHaveLength(GOOGLE_TREND_MAX_DAYS);
    expect(days?.at(-1)).toBe('2026-10-13');
    expect(googleTrendDays([])).toEqual([]);
  });
});

describe('googleTrend', () => {
  const days = googleTrendDays(trend)!;

  it('indexes each line to 100 on its first day with any', () => {
    const { points } = googleTrend(trend, google(), days);
    expect(points.map((p) => p.ai)).toEqual([null, 100, 150, 0, 250]);
    expect(points.map((p) => p.visits)).toEqual([0, 4, 6, 0, 10]);
    expect(points.map((p) => p.google)).toEqual([null, 100, 75, 0, null]);
  });

  it('leaves Google blank before its first day and after its latest, 0 between', () => {
    const view = googleTrend(trend, google(), days);
    expect(view.points.map((p) => p.clicks)).toEqual([null, 200, 150, 0, null]);
    expect(view.googleUntil).toBe('2026-10-13');
    expect(view.hasGoogle).toBe(true);
  });

  it('puts the markers on their days', () => {
    const { points } = googleTrend(trend, google(), days);
    expect(points.find((p) => p.date === '2026-10-12')).toMatchObject({ actions: 2, prompts: 0 });
    expect(points.filter((p) => p.actions || p.prompts)).toHaveLength(1);
  });

  it('says when Google has no clicks for the range or reports past it', () => {
    const none = googleTrend(trend, google({ firstDay: null, lastDay: null, clicks: [] }), days);
    expect(none.hasGoogle).toBe(false);
    expect(none.googleUntil).toBeNull();
    expect(none.points.every((p) => p.google === null)).toBe(true);

    const current = googleTrend(trend, google({ lastDay: '2026-10-16' }), days);
    expect(current.googleUntil).toBeNull();
  });
});
