import { describe, expect, it } from 'vitest';
import { bestConvertingPlatform, summaryLine, type SummaryLineInput } from './trafficSummaryLine';

/** The summary line's facts (AT-007): each kept only when the page would state it. */

const ga = (sessions: number, keyEvents: number, keyEventSessions = keyEvents) => ({
  sessions,
  engagedSessions: sessions,
  keyEvents,
  keyEventSessions,
});

const input = (over: Partial<SummaryLineInput> = {}): SummaryLineInput => ({
  totalVisits: 64,
  totalVisitsPrev: 57,
  hasPreviousPeriod: true,
  platforms: [
    { platform: 'chatgpt.com', visits: 38, analytics: ga(40, 5, 4) },
    { platform: 'perplexity.ai', visits: 20, analytics: ga(31, 6, 5) },
    { platform: 'gemini.google.com', visits: 6, analytics: ga(6, 3) },
  ],
  gaSessions: 8000,
  citedNotClicked: 2,
  ...over,
});

describe('summaryLine', () => {
  it('states the visits, share, change, top and best platforms, and cited pages', () => {
    expect(summaryLine(input())).toEqual({
      visits: 64,
      share: '0.8%',
      change: 12,
      top: { platform: 'chatgpt.com', visits: 38 },
      best: { platform: 'perplexity.ai', rate: 16.1 },
      citedNotClicked: 2,
      untrackedQueries: 0,
    });
    expect(summaryLine(input({ untrackedQueries: 7 })).untrackedQueries).toBe(7);
  });

  it('leaves out what needs Google Analytics without it (§3.8b rule 5)', () => {
    const line = summaryLine(input({ gaSessions: null }));
    expect(line.share).toBeNull();
    expect(line.best).toBeNull();
    expect(line.top).toEqual({ platform: 'chatgpt.com', visits: 38 });
  });

  it('states no change below 30 visits in either period, or without a previous one', () => {
    expect(summaryLine(input({ totalVisitsPrev: 29 })).change).toBeNull();
    expect(summaryLine(input({ hasPreviousPeriod: false })).change).toBeNull();
    expect(summaryLine(input({ totalVisits: 50, totalVisitsPrev: 100 })).change).toBe(-50);
  });

  // gkhngyk on #1229: the e-mail's "X sent the most" skips keys it can't name.
  it('names the top platform among those it can name, as the weekly e-mail does', () => {
    const line = summaryLine(
      input({
        platforms: [
          { platform: 'made-up.example', visits: 90, analytics: null },
          { platform: 'unknown', visits: 60, analytics: null },
          { platform: 'perplexity.ai', visits: 20, analytics: null },
        ],
      }),
    );
    expect(line.top).toEqual({ platform: 'perplexity.ai', visits: 20 });
    expect(
      summaryLine(input({ platforms: [{ platform: 'unknown', visits: 9, analytics: null }] })).top,
    ).toBeNull();
  });

  it('says nothing about cited pages while their count is unknown or zero', () => {
    expect(summaryLine(input({ citedNotClicked: null })).citedNotClicked).toBe(0);
    expect(summaryLine(input({ platforms: [] })).top).toBeNull();
  });
});

describe('bestConvertingPlatform', () => {
  it('compares only platforms with 30 visits and 5 key events, two or more (§5.4)', () => {
    expect(
      bestConvertingPlatform([
        { platform: 'chatgpt.com', visits: 38, analytics: ga(40, 5, 4) },
        { platform: 'gemini.google.com', visits: 6, analytics: ga(6, 6) },
      ]),
    ).toBeNull();
    expect(
      bestConvertingPlatform([
        { platform: 'chatgpt.com', visits: 38, analytics: ga(40, 5, 4) },
        { platform: 'perplexity.ai', visits: 20, analytics: ga(31, 4, 4) },
      ]),
    ).toBeNull();
  });

  it('skips platforms without a session rate or Analytics figures', () => {
    expect(
      bestConvertingPlatform([
        { platform: 'chatgpt.com', visits: 38, analytics: ga(40, 5, 4) },
        { platform: 'perplexity.ai', visits: 20, analytics: ga(31, 9, 0) },
        { platform: 'claude.ai', visits: 9, analytics: null },
      ]),
    ).toBeNull();
  });
});
