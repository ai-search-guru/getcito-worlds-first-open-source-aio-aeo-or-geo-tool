import { describe, expect, it } from 'vitest';
import {
  assetTypes,
  buildAssets,
  candidatePages,
  resolveDecision,
  tokens,
} from './pageMatching.js';

describe('tokens', () => {
  it('keeps meaningful words, folds plain plurals and handles any script', () => {
    expect(tokens('The BEST AI rank trackers for 2026')).toEqual(['rank', 'tracker']);
    expect(tokens('Yapay zekâ görünürlüğü araçları')).toEqual([
      'yapay',
      'zekâ',
      'görünürlüğü',
      'araçları',
    ]);
    expect(tokens('class process')).toEqual(['class', 'process']);
  });
});

describe('candidatePages', () => {
  const pages = [
    {
      url: 'https://example.com/blog/best-ai-rank-tracker-tools',
      title: 'Best AI Rank Tracker Tools',
      description: 'Compare rank trackers for AI search.',
    },
    {
      url: 'https://example.com/blog/google-ai-overviews-tracking',
      title: 'How to Track Google AI Overviews',
      description: 'Monitor rankings in AI Overviews.',
    },
    { url: 'https://example.com/pricing', title: 'Pricing', description: 'Plans for every team.' },
    {
      url: 'https://example.com/blog/rank',
      title: 'Rank',
      description: 'A page that shares one word.',
    },
  ];

  it('ranks pages by the rarer words they share with the need', () => {
    const found = candidatePages('Which AI rank tracker tools are most accurate?', pages);
    expect(found.map((p) => p.url)).toEqual([
      'https://example.com/blog/best-ai-rank-tracker-tools',
    ]);
  });

  it('needs two shared words, so one common word does not pull a page in', () => {
    expect(candidatePages('pricing', pages)).toEqual([]);
  });

  it('keeps at most the limit', () => {
    expect(candidatePages('track rank google overviews tracker tools', pages, 1)).toHaveLength(1);
  });
});

describe('resolveDecision', () => {
  const candidates = [{ url: 'a' }, { url: 'b' }];

  it('keeps a decision its pages support', () => {
    expect(resolveDecision('expand', [1, 1, 9], candidates)).toEqual({
      decision: 'expand',
      pages: [{ url: 'b' }],
    });
    expect(resolveDecision('consolidate', [0, 1], candidates).decision).toBe('consolidate');
  });

  it('falls back when the pages are missing', () => {
    expect(resolveDecision('optimize', [], candidates)).toEqual({ decision: 'create', pages: [] });
    expect(resolveDecision('consolidate', [0], candidates).decision).toBe('optimize');
    expect(resolveDecision('create', [0], candidates)).toEqual({ decision: 'create', pages: [] });
    expect(resolveDecision('rewrite', [0], candidates).decision).toBe('create');
  });
});

describe('assetTypes', () => {
  it("offers the site's page types, then the earned ones", () => {
    expect(assetTypes('ecommerce')).toContain('product_page');
    expect(assetTypes('ecommerce')).not.toContain('feature_page');
    expect(assetTypes('b2b')).toContain('feature_page');
    expect(assetTypes('b2b')).not.toContain('product_page');
    expect(assetTypes('b2c').slice(-2)).toEqual(['third_party_article', 'backlink']);
    expect(assetTypes('app')).toContain('feature_page');
    expect(assetTypes('app')).not.toContain('product_page');
  });
});

describe('buildAssets', () => {
  const types = assetTypes('b2b');
  const candidates = [
    { url: 'https://example.com/list', title: 'Tool list', ai_citations: 3, ga_sessions: 9 },
    { url: 'https://example.com/vs', title: 'A vs B', ai_citations: 0, ga_sessions: 1 },
  ];

  it('keeps the primary first and resolves each asset on its own', () => {
    const assets = buildAssets(
      { type: 'blog_post', channel: 'owned', decision: 'expand', pageIndexes: [0], title: 'Main' },
      [
        {
          type: 'comparison',
          channel: 'owned',
          decision: 'optimize',
          pageIndexes: [1],
          title: 'Cmp',
        },
        { type: 'backlink', channel: 'earned', decision: 'optimize', pageIndexes: [0], title: 'L' },
      ],
      candidates,
      types,
    );
    expect(
      assets.map((a) => [a.key, a.type, a.channel, a.decision, a.pages.map((p) => p.url)]),
    ).toEqual([
      ['a1', 'blog_post', 'owned', 'expand', ['https://example.com/list']],
      ['a2', 'comparison', 'owned', 'optimize', ['https://example.com/vs']],
      // Earned work lives on other sites: always new, no page of ours.
      ['a3', 'backlink', 'earned', 'create', []],
    ]);
    expect(assets[0].pages[0]).toEqual({
      url: 'https://example.com/list',
      title: 'Tool list',
      aiCitations: 3,
      gaSessions: 9,
      lastmod: undefined,
    });
  });

  it("drops types the site doesn't write, repeats of the same work and anything past the cap", () => {
    const extra = (type) => ({
      type,
      channel: 'owned',
      decision: 'create',
      pageIndexes: [],
      title: type,
    });
    const assets = buildAssets(
      { type: 'docs_faq', channel: 'owned', decision: 'create', pageIndexes: [], title: 'FAQ' },
      [extra('product_page'), extra('docs_faq'), extra('definition'), extra('pricing')],
      candidates,
      types,
    );
    // A shop's product page isn't a B2B page type, and pricing is past the cap.
    expect(assets.map((a) => a.type)).toEqual(['docs_faq', 'definition']);
  });

  it("makes a primary of a type the site doesn't write a blog post", () => {
    const [primary] = buildAssets(
      { type: 'feature_page', channel: 'owned', decision: 'create', pageIndexes: [], title: 'X' },
      [],
      candidates,
      assetTypes('ecommerce'),
    );
    expect(primary.type).toBe('blog_post');
  });
});
