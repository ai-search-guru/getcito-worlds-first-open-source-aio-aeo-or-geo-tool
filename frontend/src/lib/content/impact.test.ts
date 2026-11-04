import { describe, expect, it } from 'vitest';
import {
  gscCoverage,
  impactChange,
  impactWindows,
  isLost,
  platformNames,
  resultSources,
  resultTotals,
  type ImpactPrompt,
  type ResultSource,
} from './impact';

const TODAY = new Date('2026-10-20T22:30:00Z');

const prompt = (over: Partial<ImpactPrompt>): ImpactPrompt => ({
  id: 'p',
  text: 'best crm',
  cur: 0,
  prev: 0,
  curPlatforms: [],
  prevPlatforms: [],
  ...over,
});

describe('impactWindows', () => {
  it('counts whole UTC days, ending yesterday', () => {
    expect(impactWindows(7, TODAY)).toEqual({ cur: '2026-10-13', prev: '2026-10-06' });
    expect(impactWindows(1, TODAY)).toEqual({ cur: '2026-10-19', prev: '2026-10-18' });
    expect(impactWindows(365, TODAY)).toEqual({ cur: '2025-10-20', prev: '2024-10-20' });
  });
});

describe('gscCoverage', () => {
  it('says how far Search Console covers both windows', () => {
    expect(gscCoverage(null, 30, TODAY)).toBe('none');
    // 190 days of page data: 30 and 90 days are whole, twice over.
    expect(gscCoverage('2026-04-14', 30, TODAY)).toBe('both');
    expect(gscCoverage('2026-04-14', 90, TODAY)).toBe('both');
    // 1y: even this window starts before the first day.
    expect(gscCoverage('2026-04-14', 365, TODAY)).toBe('partial');
    // Data since last month: this window is whole, the one before isn't.
    expect(gscCoverage('2026-09-01', 30, TODAY)).toBe('current');
    expect(gscCoverage('2026-09-20', 30, TODAY)).toBe('current');
    expect(gscCoverage('2026-09-21', 30, TODAY)).toBe('partial');
  });
});

describe('impactChange', () => {
  it('reads a change as the AI Traffic page does', () => {
    expect(impactChange({ cur: 0, prev: 0 })).toEqual({ kind: 'none' });
    expect(impactChange({ cur: 3, prev: 0 })).toEqual({ kind: 'new' });
    expect(impactChange({ cur: 4, prev: 2 })).toEqual({ kind: 'low' });
    expect(impactChange({ cur: 45, prev: 30 })).toEqual({ kind: 'pct', pct: 50 });
  });

  it('shows none when the previous window isn’t whole', () => {
    expect(impactChange({ cur: 45, prev: 30 }, false)).toEqual({ kind: 'none' });
  });
});

describe('prompts', () => {
  const prompts = [
    prompt({ id: 'a', cur: 3, prev: 1 }),
    prompt({ id: 'b', cur: 1 }),
    prompt({ id: 'c', prev: 2 }),
  ];

  it('marks a prompt cited before but not now as lost', () => {
    expect(prompts.map(isLost)).toEqual([false, false, true]);
  });

  it('names the platforms once each', () => {
    expect(platformNames(['chatgpt', 'chatgpt-web', 'perplexity', 'google-ai-overviews'])).toEqual([
      'ChatGPT',
      'Perplexity',
      'Google AI Overviews',
    ]);
    expect(platformNames(['new-engine'])).toEqual(['new-engine']);
  });
});

describe('results from AI visits', () => {
  const source = (platform: string, over: Partial<ResultSource> = {}): ResultSource => ({
    platform,
    visits: 0,
    sessions: 0,
    keyEvents: 0,
    keyEventSessions: 0,
    transactions: 0,
    revenue: 0,
    ...over,
  });
  const sources = [
    source('perplexity.ai', { visits: 4, sessions: 2, keyEvents: 1, keyEventSessions: 1 }),
    source('chatgpt.com', {
      visits: 9,
      sessions: 12,
      keyEvents: 5,
      keyEventSessions: 4,
      transactions: 1,
      revenue: 40,
    }),
    source('chat.openai.com', { visits: 1, sessions: 1 }),
    source('unknown', { visits: 20 }),
    source('made-up.example', { visits: 2, keyEvents: 1 }),
    source('gemini.google.com', { sessions: 4, keyEvents: 1, keyEventSessions: 1 }),
    // Sessions on a snippet day, with nothing else: no row.
    source('claude.ai', { sessions: 3 }),
  ];

  it('adds every source up for the cards', () => {
    expect(resultTotals(sources)).toEqual({
      visits: 36,
      sessions: 22,
      keyEvents: 8,
      keyEventSessions: 6,
      transactions: 1,
      revenue: 40,
    });
    expect(resultTotals([])).toEqual({
      visits: 0,
      sessions: 0,
      keyEvents: 0,
      keyEventSessions: 0,
      transactions: 0,
      revenue: 0,
    });
  });

  it('lists one row per platform name, the most visits first, and the rest as Other', () => {
    expect(resultSources(sources).map((row) => [row.name, row.visits, row.keyEvents])).toEqual([
      ['ChatGPT', 10, 5],
      ['Perplexity', 4, 1],
      ['Gemini', 0, 1],
      [null, 22, 1],
    ]);
  });
});
