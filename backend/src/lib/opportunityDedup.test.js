import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DUPLICATE_THRESHOLD,
  DISMISSED_BLOCK_DAYS,
  basket,
  basketSimilarity,
  duplicateThreshold,
  findDuplicate,
  normalize,
  overlap,
  storedBasket,
} from './opportunityDedup.js';

// CONTENT-004: duplicates are decided by the prompt and fan-out baskets
// behind an opportunity, not by its title. The pairs below are the offline
// test set the threshold is tuned against.

const AI_SEO_PROMPTS = [
  'What are the best AI SEO tools in 2026?',
  'Which AI SEO tool should I use for content?',
  'Best AI SEO software for small teams',
];
const AI_SEO_QUERIES = [
  'best ai seo tools 2026',
  'ai seo tools comparison',
  'ai seo software pricing',
];

const stored = (sourceData, over = {}) => ({
  id: 'o1',
  status: 'new',
  updated_at: '2026-10-01T00:00:00.000Z',
  basket: storedBasket(sourceData),
  ...over,
});

describe('normalize and overlap', () => {
  it('ignores case, punctuation and accents', () => {
    expect(normalize('  Best AI-SEO tools?! ')).toBe('best ai seo tools');
    expect(normalize('Café crème')).toBe('cafe creme');
  });

  it('is the Dice overlap of two sets', () => {
    expect(overlap(new Set(['a', 'b', 'c']), new Set(['a', 'b', 'c', 'd', 'e']))).toBe(0.75);
    expect(overlap(new Set(['a']), new Set('abcdefghij'))).toBeCloseTo(0.18, 2);
    expect(overlap(new Set(), new Set(['a']))).toBe(0);
  });
});

describe('known duplicate pairs', () => {
  it('the same prompts and searches, worded differently, are one opportunity', () => {
    // "Comprehensive Guide to the Best AI SEO Tools" vs "Definitive Listicle…":
    // the titles differ, the baskets don't.
    const candidate = basket({ prompts: AI_SEO_PROMPTS, queries: AI_SEO_QUERIES });
    const existing = storedBasket({
      prompts: AI_SEO_PROMPTS.map((p) => p.toUpperCase()),
      queries: { top: AI_SEO_QUERIES.map((query) => ({ query, timesSearched: 3 })) },
    });
    expect(basketSimilarity(candidate, existing)).toBe(1);
  });

  it('a re-clustered basket that kept most of its prompts is still the same work', () => {
    const candidate = basket({
      prompts: [...AI_SEO_PROMPTS, 'Top AI tools for SEO audits'],
      queries: AI_SEO_QUERIES,
    });
    const existing = storedBasket({
      prompts: AI_SEO_PROMPTS,
      queries: { top: AI_SEO_QUERIES.slice(0, 2).map((query) => ({ query })) },
    });
    expect(basketSimilarity(candidate, existing)).toBeGreaterThanOrEqual(
      DEFAULT_DUPLICATE_THRESHOLD,
    );
  });

  it('half the prompts plus the same searches cross the line', () => {
    const candidate = basket({
      prompts: ['AEO vs SEO', 'Is AEO replacing SEO?'],
      queries: ['aeo vs seo', 'answer engine optimization vs seo', 'aeo seo difference'],
    });
    const existing = storedBasket({
      prompts: ['AEO vs SEO', 'How is AEO different from search marketing?'],
      queries: {
        top: [
          { query: 'aeo vs seo' },
          { query: 'answer engine optimization vs seo' },
          { query: 'aeo seo difference' },
        ],
      },
    });
    expect(basketSimilarity(candidate, existing)).toBeGreaterThanOrEqual(
      DEFAULT_DUPLICATE_THRESHOLD,
    );
  });

  it('an old single-prompt opportunity matches a small cluster built around its prompt', () => {
    const candidate = basket({ prompts: ['GEO best practices', 'GEO checklist'], queries: [] });
    const existing = storedBasket({ promptText: 'GEO best practices' });
    expect(basketSimilarity(candidate, existing)).toBeGreaterThanOrEqual(
      DEFAULT_DUPLICATE_THRESHOLD,
    );
  });
});

describe('known distinct pairs', () => {
  it('similar wording over different prompts is different work', () => {
    const candidate = basket({
      prompts: ['Best AI SEO tools for agencies', 'AI SEO reporting for clients'],
      queries: ['ai seo agency tools', 'ai seo client reporting'],
    });
    const existing = storedBasket({
      prompts: AI_SEO_PROMPTS,
      queries: { top: AI_SEO_QUERIES.map((query) => ({ query })) },
    });
    expect(basketSimilarity(candidate, existing)).toBeLessThan(DEFAULT_DUPLICATE_THRESHOLD);
  });

  it('shared searches alone, over different prompts, are not enough', () => {
    const candidate = basket({ prompts: ['How do I rank in ChatGPT?'], queries: AI_SEO_QUERIES });
    const existing = storedBasket({
      prompts: AI_SEO_PROMPTS,
      queries: { top: AI_SEO_QUERIES.map((query) => ({ query })) },
    });
    expect(basketSimilarity(candidate, existing)).toBeLessThan(DEFAULT_DUPLICATE_THRESHOLD);
  });

  it('one shared prompt in a large cluster is not a copy of an old single-prompt row', () => {
    const prompts = Array.from({ length: 10 }, (_, i) => `coffee prompt ${i}`);
    const candidate = basket({ prompts, queries: [] });
    const existing = storedBasket({ promptText: 'coffee prompt 0' });
    expect(basketSimilarity(candidate, existing)).toBeLessThan(DEFAULT_DUPLICATE_THRESHOLD);
  });
});

describe('findDuplicate', () => {
  const NOW = Date.parse('2026-10-13T00:00:00.000Z');
  const candidate = basket({ prompts: AI_SEO_PROMPTS, queries: AI_SEO_QUERIES });
  const same = { prompts: AI_SEO_PROMPTS };

  it('finds an open or sent opportunity on the same baskets', () => {
    expect(findDuplicate(candidate, [stored(same)], { now: NOW })?.row.id).toBe('o1');
    expect(findDuplicate(candidate, [stored(same, { status: 'sent' })], { now: NOW })?.row.id).toBe(
      'o1',
    );
  });

  it(`keeps a dismissed basket out for ${DISMISSED_BLOCK_DAYS} days, then lets it back`, () => {
    const recent = stored(same, { status: 'dismissed', updated_at: '2026-09-01T00:00:00.000Z' });
    const old = stored(same, { status: 'dismissed', updated_at: '2026-06-01T00:00:00.000Z' });
    expect(findDuplicate(candidate, [recent], { now: NOW })).not.toBeNull();
    expect(findDuplicate(candidate, [old], { now: NOW })).toBeNull();
  });

  it('ignores archived rows and returns the closest match', () => {
    const archived = stored(same, { id: 'a', status: 'archived' });
    const partial = stored({ prompts: AI_SEO_PROMPTS.slice(0, 2) }, { id: 'p' });
    const exact = stored(same, { id: 'e' });
    expect(findDuplicate(candidate, [archived], { now: NOW })).toBeNull();
    expect(findDuplicate(candidate, [partial, exact], { now: NOW })?.row.id).toBe('e');
  });
});

describe('duplicateThreshold', () => {
  it('reads OPPORTUNITY_DUPLICATE_THRESHOLD, falling back on bad values', () => {
    expect(duplicateThreshold({ OPPORTUNITY_DUPLICATE_THRESHOLD: '0.75' })).toBe(0.75);
    expect(duplicateThreshold({ OPPORTUNITY_DUPLICATE_THRESHOLD: 'abc' })).toBe(0.6);
    expect(duplicateThreshold({ OPPORTUNITY_DUPLICATE_THRESHOLD: '2' })).toBe(0.6);
    expect(duplicateThreshold({})).toBe(0.6);
  });
});
