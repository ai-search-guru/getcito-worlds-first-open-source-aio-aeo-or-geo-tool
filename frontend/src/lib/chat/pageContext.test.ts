import { describe, expect, it } from 'vitest';
import {
  contextChips,
  largestMove,
  menuTitleOf,
  rangeChipLabel,
  type ChatPageContext,
} from './pageContext';

/** A page's context as the side panel's chips (CHAT-01 items 20–22). */

const brand = { id: 'brand-1', name: 'Acme Coffee' };
const mentions: ChatPageContext = {
  pageName: 'Mentions & Sentiment',
  dateRange: { from: '30d', to: null, label: 'Last 30 days' },
  filters: [
    { key: 'platform', label: 'All platforms', value: '' },
    { key: 'topic', label: 'Espresso', value: 'topic-1' },
  ],
};

describe('contextChips', () => {
  it('names the page, the brand, the dates and each filter, in that order', () => {
    expect(contextChips(mentions, { pageName: 'Mentions', brand })).toEqual([
      { key: 'page', label: 'Mentions & Sentiment' },
      { key: 'brand', label: 'Acme Coffee', value: 'brand-1' },
      { key: 'dates', label: 'Last 30 days', value: '30d/' },
      { key: 'filter:platform', label: 'All platforms', value: '' },
      { key: 'filter:topic', label: 'Espresso', value: 'topic-1' },
    ]);
  });

  it('falls back to the menu’s name and the brand for a page that says nothing', () => {
    expect(contextChips(null, { pageName: 'Citations', brand })).toEqual([
      { key: 'page', label: 'Citations' },
      { key: 'brand', label: 'Acme Coffee', value: 'brand-1' },
    ]);
    expect(contextChips(null, { pageName: null, brand: null })).toEqual([]);
  });

  it('keeps off the chips the person removed', () => {
    const keys = contextChips(
      mentions,
      { pageName: null, brand },
      new Set(['brand', 'filter:topic']),
    ).map((chip) => chip.key);
    expect(keys).toEqual(['page', 'dates', 'filter:platform']);
  });
});

describe('menuTitleOf', () => {
  it('finds the menu entry a page is under, the longest route first', () => {
    expect(menuTitleOf('/dashboard/mentions')).toBe('Mentions');
    expect(menuTitleOf('/dashboard/prompts/topics/abc')).toBe('Topics');
    expect(menuTitleOf('/dashboard/content/library')).toBe('Library');
    expect(menuTitleOf('/dashboard/settings/team')).toBeNull();
  });
});

describe('rangeChipLabel', () => {
  const t = (key: string, values?: Record<string, string | number>) =>
    `${key}${values ? JSON.stringify(values) : ''}`;

  it('words each preset as the page does', () => {
    expect(rangeChipLabel('24h', {}, t)).toBe('day');
    expect(rangeChipLabel('7d', {}, t)).toBe('days{"days":7}');
    expect(rangeChipLabel('custom', { from: '2026-10-01', to: '2026-10-15' }, t)).toBe(
      'custom{"from":"2026-10-01","to":"2026-10-15"}',
    );
    expect(rangeChipLabel('custom', { from: '2026-10-01' }, t)).toBe('customOpen');
    expect(rangeChipLabel('all', {}, t)).toBe('all');
  });
});

describe('largestMove', () => {
  it('finds the row that moved most, down or up', () => {
    const rows = [
      { name: 'ChatGPT', change: 4 },
      { name: 'Perplexity', change: -9 },
      { name: 'Gemini', change: null },
    ];
    expect(largestMove(rows)?.name).toBe('Perplexity');
    expect(largestMove([{ name: 'Claude', change: 2 }])?.change).toBe(2);
  });

  it('finds nothing when nothing moved', () => {
    expect(largestMove([{ change: 0 }, { change: null }])).toBeNull();
    expect(largestMove(null)).toBeNull();
  });
});
