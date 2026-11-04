import { describe, expect, it } from 'vitest';
import {
  aiUsageFromApi,
  aiUsageToastDue,
  aiUsageToastMark,
  aiUsageTone,
  type AiUsage,
} from './aiUsage';

/** The AI usage toast (AI usage spec §4): once a period in a browser, on reaching 80%. */

const usage = (over: Partial<AiUsage> = {}): AiUsage => ({
  plan: 'growth',
  planName: 'Growth',
  periodStart: '2026-10-20T09:00:00.000Z',
  periodEnd: '2026-11-20T09:00:00.000Z',
  unlimited: false,
  percentUsed: 84,
  features: [],
  ...over,
});
const shown = '2026-10-20T09:00:00.000Z:growth';

describe('aiUsageToastDue', () => {
  it('marks the period and the plan it warned about', () => {
    expect(aiUsageToastMark(usage())).toBe(shown);
  });

  it('is due once a period from 80%', () => {
    expect(aiUsageToastDue(usage({ percentUsed: 80 }), null)).toBe(true);
    expect(aiUsageToastDue(usage({ percentUsed: 91 }), shown)).toBe(false);
  });

  it('marks the free trial apart, so a plan started within its period warns again', () => {
    expect(aiUsageToastMark(usage({ trial: true }))).toBe(`${shown}:trial`);
    expect(aiUsageToastDue(usage(), `${shown}:trial`)).toBe(true);
  });

  it('starts over in a new period, or on a plan changed within one', () => {
    expect(aiUsageToastDue(usage({ periodStart: '2026-11-20T09:00:00.000Z' }), shown)).toBe(true);
    expect(aiUsageToastDue(usage({ plan: 'enterprise' }), shown)).toBe(true);
  });

  it('is not due below 80%, once used up (the red banner says it), or unmetered', () => {
    expect(aiUsageToastDue(usage({ percentUsed: 79.9 }), null)).toBe(false);
    expect(aiUsageToastDue(usage({ percentUsed: 100 }), null)).toBe(false);
    expect(aiUsageToastDue(usage({ unlimited: true, percentUsed: null }), null)).toBe(false);
  });
});

describe('aiUsageFromApi', () => {
  /** An API from before the quality checks joined the Content Editor's row. */
  const old = (improve: number, content: number, action: number, quality: number) =>
    usage({
      features: [
        { feature: 'improve', percent: improve },
        { feature: 'content', percent: content },
        { feature: 'action_center', percent: action },
        { feature: 'quality' as AiUsage['features'][number]['feature'], percent: quality },
      ],
    });

  it('drops an older API’s unused rows: nothing used reads as no usage', () => {
    expect(aiUsageFromApi(old(0, 0, 0, 0)).features).toEqual([]);
  });

  it('adds an older API’s quality checks into the Content Editor, once rounded', () => {
    expect(aiUsageFromApi(old(0, 1.2, 0, 0.1)).features).toEqual([
      { feature: 'content', percent: 1.3 },
    ]);
    expect(aiUsageFromApi(old(4.5, 0, 0.2, 0.3)).features).toEqual([
      { feature: 'improve', percent: 4.5 },
      { feature: 'content', percent: 0.3 },
      { feature: 'action_center', percent: 0.2 },
    ]);
  });

  it('keeps a new API’s answer as it is, a listed 0 and all', () => {
    const now = usage({ features: [{ feature: 'content', percent: 0 }] });
    expect(aiUsageFromApi(now)).toBe(now);
  });
});

describe('aiUsageTone with purchased AI credits (CHAT-18)', () => {
  it('is used up at 100% only when no credits are left: calls run on them past it', () => {
    expect(aiUsageTone(usage({ percentUsed: 100 }))).toBe('exhausted');
    expect(aiUsageTone(usage({ percentUsed: 100, creditsLeft: false }))).toBe('exhausted');
    expect(aiUsageTone(usage({ percentUsed: 100, creditsLeft: true }))).toBe('warning');
    expect(aiUsageTone(usage({ percentUsed: 50, creditsLeft: true }))).toBe('normal');
  });
});
