import { describe, expect, it } from 'vitest';
import {
  conversionCards,
  conversionSources,
  journeyPages,
  type ContentConversions,
} from './conversions';

const read = (over: Partial<ContentConversions> = {}): ContentConversions => ({
  page: '/pricing',
  enabled: true,
  goals: [],
  revenue: [],
  sources: [],
  journeys: [],
  ...over,
});

describe('conversionCards', () => {
  it('shows each kind of site its own goals, at 0 when there are none', () => {
    expect(conversionCards(read(), 'b2b')).toEqual([
      { key: 'signup', value: 0 },
      { key: 'demo', value: 0 },
    ]);
    expect(conversionCards(read(), 'b2c').map((card) => card.key)).toEqual([
      'booking',
      'revenue',
      'newsletter',
    ]);
    expect(conversionCards(read(), 'app')).toEqual([
      { key: 'signup', value: 0 },
      { key: 'newsletter', value: 0 },
    ]);
  });

  it('reads a shop’s units from its orders, and gives each goal its site leaves out a card of its own', () => {
    const conversions = read({
      goals: [
        { goal: 'order', count: 3, units: 7 },
        { goal: 'signup', count: 2, units: 0 },
        { goal: 'custom', count: 1, units: 0 },
      ],
      revenue: [{ currency: 'USD', value: 120 }],
    });
    expect(conversionCards(conversions, 'ecommerce')).toEqual([
      { key: 'order', value: 3 },
      { key: 'revenue', value: [{ currency: 'USD', value: 120 }] },
      { key: 'units', value: 7 },
      // A shop's newsletter form counts as a signup: it shows as one.
      { key: 'signup', value: 2 },
      { key: 'custom', value: 1 },
    ]);
  });
});

describe('conversionSources', () => {
  it('names each source, ChatGPT’s old host as ChatGPT, keys it can’t name as Other, last', () => {
    expect(
      conversionSources(
        read({
          sources: [
            { platform: 'unknown-ai.example', conversions: 9 },
            { platform: 'chatgpt.com', conversions: 2 },
            { platform: 'chat.openai.com', conversions: 1 },
            { platform: 'perplexity.ai', conversions: 4 },
          ],
        }),
      ),
    ).toEqual([
      { name: 'Perplexity', conversions: 4 },
      { name: 'ChatGPT', conversions: 3 },
      { name: null, conversions: 9 },
    ]);
  });
});

describe('journeyPages', () => {
  it('keeps up to five pages, or the first, a gap and the last three', () => {
    expect(journeyPages(['/a', '/b'])).toEqual(['/a', '/b']);
    expect(journeyPages(['/a', '/b', '/c', '/d', '/e', '/f'])).toEqual([
      '/a',
      null,
      '/d',
      '/e',
      '/f',
    ]);
  });

  it('keeps the page the tab is about in view when it would fall in the gap', () => {
    const pages = ['/a', '/b', '/pricing', '/c', '/d', '/e', '/f'];
    expect(journeyPages(pages, '/pricing')).toEqual(['/a', null, '/pricing', null, '/f']);
    // Shown already, or not in the journey: as without it.
    expect(journeyPages(pages, '/a')).toEqual(['/a', null, '/d', '/e', '/f']);
    expect(journeyPages(pages, '/e')).toEqual(['/a', null, '/d', '/e', '/f']);
    expect(journeyPages(pages, '/other')).toEqual(['/a', null, '/d', '/e', '/f']);
    expect(journeyPages(['/a', '/pricing'], '/pricing')).toEqual(['/a', '/pricing']);
    // Right after the first page: no gap between them.
    expect(journeyPages(['/a', '/pricing', '/b', '/c', '/d', '/e', '/f'], '/pricing')).toEqual([
      '/a',
      '/pricing',
      null,
      '/f',
    ]);
  });
});
