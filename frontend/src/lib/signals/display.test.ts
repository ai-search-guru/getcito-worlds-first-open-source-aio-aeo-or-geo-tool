import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import messages from '../../../messages/en.json';
import type { Signal } from './map';
import { NO_WHERE } from './where';
import { signalAffected, signalTexts } from './display';

// The real English copy, behind the plain (key, values) shape the display
// helpers take from useTranslations.
function translator(namespace: 'actionCenter.signalTexts' | 'actionCenter.signalsPage') {
  const t = createTranslator({ locale: 'en', messages, namespace });
  return (key: string, values?: Record<string, string | number>) =>
    t(key as Parameters<typeof t>[0], values);
}
const tTexts = translator('actionCenter.signalTexts');
const tPage = translator('actionCenter.signalsPage');

const signal = (over: Partial<Signal>): Signal => ({
  id: 's1',
  category: 'visibility',
  kind: 'platform_drop',
  impact: 'high',
  status: 'new',
  source: ['ai_results'],
  detectedAt: '2026-10-08T10:53:00Z',
  lastDetectedAt: '2026-10-08T10:53:00Z',
  resolvedAt: null,
  previousValue: null,
  currentValue: null,
  changeValue: null,
  payload: {},
  kpiKeys: [],
  actionId: null,
  where: NO_WHERE,
  ...over,
});

describe('signalTexts', () => {
  it("names AI Traffic's alerts: the weekly drop, broken links, unread cited pages and a new platform (AT-013)", () => {
    const pages = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ id: `/p${i}`, label: `/p${i}` }));
    const drop = signal({
      category: 'traffic',
      kind: 'ai_visits_weekly_drop',
      payload: { entity: 'pages', targets: pages(3), pageCount: 3 },
      previousValue: 50,
      currentValue: 28,
    });
    expect(signalTexts(drop, tTexts)).toEqual({
      title: 'AI visits fell from 50 to 28 week over week',
      description: 'AI-referred visits fell 40% or more against the week before, across 3 pages.',
    });
    // Its value is the site's visits; its pages are counted apart.
    expect(signalAffected(drop, tPage)).toEqual({ label: '3 pages', detail: '/p0' });

    const broken = signal({
      category: 'technical',
      kind: 'broken_citation_target',
      payload: { entity: 'pages', targets: pages(2) },
      currentValue: 2,
    });
    expect(signalTexts(broken, tTexts).title).toBe('Broken AI links on 2 pages');
    expect(signalAffected(broken, tPage)).toEqual({ label: '2 pages', detail: '/p0' });

    const unread = signal({
      category: 'technical',
      kind: 'cited_page_uncrawled',
      payload: { entity: 'pages', targets: pages(10) },
      currentValue: 14,
    });
    expect(signalTexts(unread, tTexts).title).toBe(
      "AI search bots haven't read 14 pages that AI answers cite",
    );

    const platform = signal({
      category: 'traffic',
      kind: 'ai_platform_new',
      payload: { aiSource: 'perplexity.ai', firstDay: '2026-10-16' },
      previousValue: 0,
      currentValue: 4,
      changeValue: 4,
    });
    expect(signalTexts(platform, tTexts)).toEqual({
      title: 'Perplexity started sending visitors',
      description: '4 AI visits from Perplexity in the last 7 days, the first it has sent.',
    });
    expect(signalAffected(platform, tPage)).toEqual({ label: 'Platform', detail: 'Perplexity' });
  });

  it('names the platform and says how far its mention rate fell', () => {
    const drop = signal({
      payload: {
        entity: 'platforms',
        platform: 'gemini-web',
        targets: [{ id: 'gemini-web', label: 'gemini-web' }],
      },
      previousValue: 34,
      currentValue: 18,
      changeValue: -16,
    });
    expect(signalTexts(drop, tTexts)).toEqual({
      title: 'Visibility dropped on Gemini',
      description: 'Your mention rate fell from 34% to 18% against the week before.',
    });
    expect(signalAffected(drop, tPage)).toEqual({ label: 'Gemini', detail: null });
  });

  it('names the weak country and the strongest one beside it', () => {
    const gap = signal({
      kind: 'country_gap',
      payload: {
        entity: 'regions',
        region: 'JP',
        bestRegion: 'US',
        targets: [{ id: 'JP', label: 'JP' }],
      },
      previousValue: 22.5,
      currentValue: 3.1,
    });
    expect(signalTexts(gap, tTexts)).toEqual({
      title: 'Weak in Japan',
      description: 'You are mentioned in 3.1% of answers here, against 22.5% in United States.',
    });
  });

  it("spells out a source's answers instead of the unlabeled 0 → 251 +167", () => {
    const source = signal({
      category: 'competitor',
      kind: 'competitor_winning_source',
      payload: {
        entity: 'sources',
        domain: 'yotpo.com',
        prompts: 6,
        results: 251,
        targets: [{ id: 'yotpo.com', label: 'yotpo.com' }],
      },
      previousValue: 0,
      currentValue: 251,
      changeValue: 167,
    });
    expect(signalTexts(source, tTexts).description).toBe(
      'Cited in 251 answers across 6 prompts this week. Competitors alone are named in 167 of them; you in none.',
    );
  });

  it("gives a topic's coverage against its prompt count", () => {
    const topic = signal({
      kind: 'topic_drop',
      payload: {
        entity: 'topics',
        topicName: 'AEO',
        prompts: 12,
        targets: [{ id: 't1', label: 'AEO' }],
      },
      previousValue: 50,
      currentValue: 25,
    });
    expect(signalTexts(topic, tTexts)).toEqual({
      title: 'Coverage dropped in AEO',
      description: 'You now appear on 25% of its 12 prompts, down from 50%.',
    });
  });

  it('names the lost page, and the platform when it was lost on one', () => {
    const lost = (platforms: string[]) =>
      signal({
        category: 'citation',
        kind: 'lost_citations',
        payload: {
          promptId: 'p1',
          promptText: 'Best coffee subscription?',
          platforms,
          lostUrls: [{ url: 'https://coffee.example/guide/' }],
        },
      });
    expect(signalTexts(lost(['chatgpt-web']), tTexts)).toEqual({
      title: 'Citations lost on ChatGPT for “Best coffee subscription?”',
      description: 'coffee.example/guide is no longer cited on ChatGPT.',
    });
    expect(signalTexts(lost(['chatgpt-web', 'gemini-web']), tTexts).title).toBe(
      'Citations lost for “Best coffee subscription?”',
    );
    // A row recorded before the evidence keeps the generic copy.
    expect(
      signalTexts(signal({ kind: 'lost_citations', payload: { promptText: 'x' } }), tTexts)
        .description,
    ).toBe('Your pages are no longer cited in answers to this prompt.');
  });

  it('names both models a platform gap compares', () => {
    const gap = signal({
      kind: 'platform_gap',
      payload: { platform: 'chatgpt-web', bestPlatform: 'gpt-5-6' },
      previousValue: 30,
      currentValue: 3.8,
    });
    expect(signalTexts(gap, tTexts)).toEqual({
      title: 'Weak on ChatGPT',
      description: 'You are visible in 30% of ChatGPT (gpt-5-6) answers, but only 3.8% on ChatGPT.',
    });
  });
});
