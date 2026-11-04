import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * One page's content suggestion (AT-006 part B3): the clusters it is written
 * from — those holding prompts that target the page, else those sharing its
 * words — and the page as the generator knows it.
 */

let db;

function table(name) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    order: () => chain,
    limit: () => chain,
    then: (resolve, reject) =>
      Promise.resolve({ data: db[name] ?? [], error: null }).then(resolve, reject),
  };
  return chain;
}

vi.mock('../config/supabase.js', () => ({ default: { from: (name) => table(name) } }));

const { focusClusters, loadPageFocus, pageFocusInstruction, pagePathKey, pickPageCluster } =
  await import('./opportunityPageFocus.js');

const cluster = (id, over = {}) => ({
  id,
  label: '',
  primary_intent: '',
  prompt_ids: [],
  promptTexts: [],
  ...over,
});

const gifts = {
  url: 'https://acme-coffee.example.com/gifts',
  title: 'Coffee gifts and gift boxes',
  h1: 'Coffee gifts for every coffee lover',
  description: 'Specialty coffee gift boxes and sampler sets for every budget.',
};

describe('focusClusters', () => {
  const clusters = [
    cluster('espresso', {
      label: 'Home espresso machines',
      prompt_ids: ['p1'],
      promptTexts: ['Best espresso machines under $500?'],
    }),
    cluster('gift-sets', {
      label: 'Coffee gift sets',
      primary_intent: 'Find a coffee gift box',
      prompt_ids: ['p2', 'p3'],
      promptTexts: ['What coffee gift box should I buy?'],
    }),
    cluster('sampler', {
      label: 'Coffee samplers',
      prompt_ids: ['p4'],
      promptTexts: ['Which coffee sampler set is best for beginners?'],
    }),
  ];

  it('takes the clusters of prompts that target the page, most of them first', () => {
    expect(focusClusters(clusters, gifts, ['p4', 'p2', 'p3', 'p9'])).toEqual([
      'gift-sets',
      'sampler',
    ]);
  });

  it('falls back to the clusters sharing the most words with the page', () => {
    expect(focusClusters(clusters, gifts, [])).toEqual(['gift-sets', 'sampler']);
  });

  it('finds none when nothing tracked is about the page', () => {
    const about = { url: 'https://acme-coffee.example.com/careers', title: 'Careers at Acme' };
    expect(focusClusters(clusters, about, [])).toEqual([]);
  });

  it('keeps at most five word-matched clusters', () => {
    const many = Array.from({ length: 7 }, (_, i) =>
      cluster(`c${i}`, { label: 'Coffee gift boxes', promptTexts: ['coffee gift sets'] }),
    );
    expect(focusClusters(many, gifts, [])).toHaveLength(5);
  });
});

describe('pickPageCluster', () => {
  const state = (openIds, covered) => ({ openIds: new Set(openIds), covered: new Set(covered) });

  it("points at the best match's open opportunity rather than writing another", () => {
    // c1 is covered; c2 could be written, but c1 matches the page better.
    expect(pickPageCluster(['c1', 'c2'], state(['c2'], ['c1']))).toEqual({ existing: 'c1' });
  });

  it('writes for the best match with answers, passing over clusters with neither', () => {
    expect(pickPageCluster(['c0', 'c2', 'c3'], state(['c2', 'c3'], []))).toEqual({ write: 'c2' });
  });

  it('finds nothing when no cluster has answers or an opportunity', () => {
    expect(pickPageCluster(['c0'], state([], []))).toBeNull();
  });
});

describe('pageFocusInstruction', () => {
  it('names the page and asks to work on it before creating another', () => {
    const text = pageFocusInstruction(gifts);
    expect(text).toContain('https://acme-coffee.example.com/gifts ("Coffee gifts and gift boxes")');
    expect(text).toContain('[P0]');
    expect(text).toMatch(/optimize, expand or refresh it/);
    expect(pageFocusInstruction({ url: 'https://acme.example/about' })).toContain(
      'https://acme.example/about. It is listed first',
    );
  });
});

describe('loadPageFocus', () => {
  beforeEach(() => {
    db = {
      site_pages: [
        { url: 'https://acme-coffee.example.com/gifts/', title: 'Coffee gifts', ai_citations: 6 },
        { url: 'https://acme-coffee.example.com/menu', title: 'Menu' },
      ],
      brand_domains: [{ domain: 'https://www.acme-coffee.example.com/' }],
      prompt_target_urls: [
        { prompt_id: 'p2', url: 'https://acme-coffee.example.com/Gifts' },
        { prompt_id: 'p2', url: 'https://www.acme-coffee.example.com/gifts/' },
        { prompt_id: 'p5', url: 'https://acme-coffee.example.com/menu' },
      ],
    };
  });

  it("reads the page's sitemap entry and the prompts targeting it, in any spelling", async () => {
    const focus = await loadPageFocus('b1', '/gifts', ['p2', 'p5']);
    expect(focus.page).toMatchObject({ title: 'Coffee gifts', ai_citations: 6 });
    expect(focus.targetedPromptIds).toEqual(['p2']);
  });

  it('builds the URL on the primary domain for a page the sitemap lacks', async () => {
    const focus = await loadPageFocus('b1', '/about', []);
    expect(focus.page).toEqual({
      url: 'https://www.acme-coffee.example.com/about',
      title: null,
      h1: null,
      description: null,
      lastmod: null,
      ai_citations: 0,
      ga_sessions: 0,
    });
    expect(focus.targetedPromptIds).toEqual([]);
  });

  it('keys paths without case or a trailing slash', () => {
    expect(pagePathKey('/Gifts/')).toBe('/gifts');
    expect(pagePathKey('')).toBe('/');
  });
});
