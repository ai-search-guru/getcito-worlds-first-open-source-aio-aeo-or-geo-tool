import { describe, expect, it } from 'vitest';
import {
  mentionPlatformLabel,
  mentionsHeadline,
  platformDisagreement,
  platformNetChange,
} from './mentionsHeadline';
import type { MentionPlatformRow, MentionsOverview, MentionTotals } from './mentionsOverview';

const totals = (over: Partial<MentionTotals>): MentionTotals => ({
  answers: 0,
  mentions: 0,
  occurrences: 0,
  positive: 0,
  negative: 0,
  positionSum: 0,
  positionCount: 0,
  prompts: 0,
  promptsWithMentions: 0,
  lastAnswerAt: null,
  ...over,
});

const platform = (
  id: string,
  now: [number, number, number],
  before: [number, number, number] = [0, 0, 0],
): MentionPlatformRow => ({
  platform: id,
  answers: now[0],
  mentions: now[0],
  occurrences: now[0],
  positive: now[1],
  negative: now[2],
  previous: { answers: before[0], mentions: before[0], positive: before[1], negative: before[2] },
});

const overview = (over: Partial<MentionsOverview>): MentionsOverview => ({
  window: { from: '', to: '', days: 30, source: 'days', dayFrom: '', dayTo: '' },
  current: totals({}),
  previous: totals({}),
  platforms: [],
  daily: [],
  competitors: [],
  ...over,
});

describe('mentionsHeadline', () => {
  it('states the net sentiment, its change, the platform behind it and the usual companions', () => {
    const h = mentionsHeadline(
      overview({
        // Net +34 now (48% − 14%), +40 before: down 6.
        current: totals({ mentions: 100, positive: 48, negative: 14 }),
        previous: totals({ mentions: 100, positive: 50, negative: 10 }),
        platforms: [
          // ChatGPT: +60 → +60. Gemini: +12 → −6, down 18. Claude: up.
          platform('chatgpt-web', [40, 26, 2], [40, 26, 2]),
          platform('gemini-web', [50, 15, 18], [50, 16, 10]),
          platform('claude', [30, 20, 2], [30, 15, 3]),
        ],
        competitors: [
          {
            competitorId: 'p',
            name: 'Profound',
            mentions: 900,
            coMentions: 412,
            previousMentions: 0,
          },
          {
            competitorId: 'o',
            name: 'Otterly AI',
            mentions: 400,
            coMentions: 131,
            previousMentions: 0,
          },
          {
            competitorId: 'e',
            name: 'Peec AI',
            mentions: 500,
            coMentions: 286,
            previousMentions: 0,
          },
        ],
      }),
    );
    expect(h.net).toBe(34);
    expect(h.netChange).toBe(-6);
    expect(h.mover).toEqual({ platform: 'gemini-web', change: -18 });
    expect(h.companions).toEqual(['Profound', 'Peec AI']);
  });

  it('names no mover when the change is flat or no platform has enough mentions', () => {
    const flat = mentionsHeadline(
      overview({
        current: totals({ mentions: 20, positive: 10, negative: 2 }),
        previous: totals({ mentions: 20, positive: 10, negative: 2 }),
        platforms: [platform('gemini-web', [10, 1, 5], [10, 5, 1])],
      }),
    );
    expect(flat.netChange).toBe(0);
    expect(flat.mover).toBeNull();
  });

  it('has no figures for a window without mentions', () => {
    const h = mentionsHeadline(overview({}));
    expect(h).toEqual({
      net: null,
      lowSample: true,
      netChange: null,
      mover: null,
      companions: [],
    });
  });

  it('takes the net change on the prompts both windows answered (00195)', () => {
    const h = mentionsHeadline(
      overview({
        current: totals({ answers: 100, mentions: 100, positive: 50, negative: 10 }),
        previous: totals({ answers: 100, mentions: 100, positive: 20, negative: 10 }),
        same: {
          prompts: 8,
          newPrompts: 2,
          droppedPrompts: 0,
          current: totals({ answers: 60, mentions: 60, positive: 30, negative: 6 }),
          previous: totals({ answers: 60, mentions: 60, positive: 24, negative: 6 }),
        },
      }),
    );
    // Net +40 now; on the shared prompts +40 vs +30, not +40 vs +10 on all.
    expect(h.net).toBe(40);
    expect(h.netChange).toBe(10);
  });

  it('gives no change from or to a low sample', () => {
    const h = mentionsHeadline(
      overview({
        current: totals({ mentions: 2, positive: 0, negative: 1 }),
        previous: totals({ mentions: 40, positive: 20, negative: 0 }),
      }),
    );
    expect(h).toMatchObject({ net: -50, lowSample: true, netChange: null, mover: null });
    expect(
      mentionsHeadline(
        overview({
          current: totals({ mentions: 40, positive: 20, negative: 0 }),
          previous: totals({ mentions: 2, positive: 0, negative: 1 }),
        }),
      ),
    ).toMatchObject({ net: 50, lowSample: false, netChange: null });
  });
});

describe('platformNetChange', () => {
  it('takes the change on the prompts both windows answered (00195)', () => {
    const row = {
      ...platform('claude', [40, 20, 0], [40, 10, 0]),
      same: {
        current: { answers: 30, mentions: 30, positive: 15, negative: 0 },
        previous: { answers: 30, mentions: 30, positive: 12, negative: 0 },
      },
    };
    // On all prompts +50 vs +25; on the shared ones +50 vs +40.
    expect(platformNetChange(row)).toBe(10);
  });

  it('needs 20 mentions in both windows', () => {
    expect(platformNetChange(platform('claude', [20, 10, 0], [20, 5, 0]))).toBe(25);
    expect(platformNetChange(platform('claude', [19, 10, 0], [20, 5, 0]))).toBeNull();
  });
});

describe('platformDisagreement', () => {
  it('flags platforms 40 points apart or more', () => {
    expect(
      platformDisagreement([
        platform('chatgpt-web', [50, 30, 3]), // +54
        platform('gemini-web', [50, 15, 18]), // −6
        platform('claude', [10, 0, 10]), // low sample: left out
      ]),
    ).toEqual({
      high: { platform: 'chatgpt-web', net: 54 },
      low: { platform: 'gemini-web', net: -6 },
    });
  });

  it('stays quiet when they roughly agree or only one can be compared', () => {
    expect(
      platformDisagreement([platform('chatgpt-web', [50, 30, 3]), platform('claude', [50, 25, 5])]),
    ).toBeNull();
    expect(platformDisagreement([platform('chatgpt-web', [50, 30, 3])])).toBeNull();
  });
});

describe('mentionPlatformLabel', () => {
  it('names the tracked platforms and keeps any other id', () => {
    expect(mentionPlatformLabel('gemini-web')).toBe('Gemini');
    expect(mentionPlatformLabel('new-engine')).toBe('new-engine');
  });
});
