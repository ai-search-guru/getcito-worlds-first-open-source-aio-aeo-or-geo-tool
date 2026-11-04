import { describe, expect, it } from 'vitest';
import { PAGE_TYPES } from './drafts';
import { EEAT_WEIGHTS, TRUST_WEIGHTS, eeat, trust, trustBlocks } from './qualityChecks';
import {
  PROFILE_WEIGHTS,
  QUALITY_PROFILES,
  checksOff,
  profileFor,
  weighed,
  waitsForSiteTrust,
  weighedTrust,
} from './qualityProfiles';
import { READABILITY_WEIGHTS, readability } from './readability';

/**
 * Page types (Quality spec §11, CE-052): what the three scores count, and
 * how much, follows the page's type from Phase 3 on.
 */

describe('profileFor', () => {
  it('reads each page type as its profile in Phase 3, an article for the rest', () => {
    expect(profileFor('product_page', 3)).toBe('product');
    expect(profileFor('category_page', 3)).toBe('category');
    expect(profileFor('collection_page', 3)).toBe('category');
    expect(profileFor('feature_page', 3)).toBe('feature');
    expect(profileFor('pricing', 3)).toBe('feature');
    expect(profileFor('comparison', 3)).toBe('comparison');
    expect(profileFor('best_of', 3)).toBe('comparison');
    expect(profileFor('blog_post', 3)).toBe('article');
    expect(profileFor('destination_page', 3)).toBe('article');
    expect(profileFor(null, 3)).toBe('article');
    for (const type of PAGE_TYPES) expect(QUALITY_PROFILES).toContain(profileFor(type, 3));
  });

  it('keeps every page an article before Phase 3', () => {
    expect(profileFor('product_page', 2)).toBe('article');
    expect(profileFor('comparison', 0)).toBe('article');
  });
});

describe('PROFILE_WEIGHTS', () => {
  it('gives each score 100 points in every profile, the article the blog defaults', () => {
    const sum = (weights: Record<string, number>) =>
      Object.values(weights).reduce((a, b) => a + b, 0);
    for (const profile of QUALITY_PROFILES) {
      const w = PROFILE_WEIGHTS[profile];
      expect([sum(w.eeat), sum(w.trust), sum(w.readability)]).toEqual([100, 100, 100]);
    }
    expect(PROFILE_WEIGHTS.article.eeat).toEqual(EEAT_WEIGHTS);
    expect(PROFILE_WEIGHTS.article.trust).toEqual(TRUST_WEIGHTS);
    expect(PROFILE_WEIGHTS.article.readability).toEqual(READABILITY_WEIGHTS);
  });

  it('asks a product page for no author, and a comparison for balance and a disclosure', () => {
    expect(checksOff('product')).toContain('byline');
    expect(checksOff('product')).toContain('authorBio');
    // An article counts every check but the brand's information, the check
    // date, customer cases, shipping, the product feed and the type rules.
    expect([...checksOff('article')].sort()).toEqual([
      'brandInfo',
      'checkDate',
      'customerCase',
      'feedMatch',
      'introFacts',
      'shippingReturns',
      'typeRules',
    ]);
    // A category page without intro facts scores as before CE-054: the other
    // checks are 0.8 of their points (claims 25 → 20, weak 5 → 4, brand facts
    // 30 → 24, links 15 → 12, site 25 → 20).
    const { introFacts: intro, ...rest } = PROFILE_WEIGHTS.category.trust;
    expect(intro).toBe(20);
    expect(rest).toMatchObject({
      claimsSourced: 20,
      noWeakSources: 4,
      brandFacts: 24,
      noBrokenLinks: 12,
      siteTrust: 20,
    });
    // A category page's intro facts weigh in its Trust, and brand facts still weigh as much as claims (CE-054).
    expect(PROFILE_WEIGHTS.category.trust.introFacts).toBeGreaterThan(0);
    expect(PROFILE_WEIGHTS.category.trust.brandFacts).toBeGreaterThanOrEqual(
      PROFILE_WEIGHTS.category.trust.claimsSourced,
    );
    // A product page's price and stock against its feed weigh most in its Trust (CE-053).
    const productTrust = Object.values(PROFILE_WEIGHTS.product.trust);
    expect(PROFILE_WEIGHTS.product.trust.feedMatch).toBe(Math.max(...productTrust));
    expect(PROFILE_WEIGHTS.comparison.trust.balanced).toBeGreaterThan(
      PROFILE_WEIGHTS.article.trust.balanced,
    );
    expect(checksOff('comparison')).not.toContain('disclosure');
  });

  it('waits for the site’s trust where E-E-A-T weighs the brand’s own information (#1491 review)', () => {
    expect(waitsForSiteTrust('category')).toBe(true);
    expect(QUALITY_PROFILES.filter(waitsForSiteTrust)).toEqual(['category']);
  });
});

describe('weighed', () => {
  const author = {
    id: 'a1',
    name: 'Ada',
    title: null,
    bio: 'Writes.',
    photoUrl: null,
    sameAs: [],
    userId: null,
    createdBy: null,
    defaultFor: [],
    pages: null,
  };

  it('keeps each check’s share of its points, out of the profile’s weight', () => {
    // Byline 15/15, bio 5/10 (no links): 80 as an article.
    const read = eeat({ author, used: { experience: false, data: true } });
    expect(weighed(read, PROFILE_WEIGHTS.article.eeat).score).toBe(read.score);
    // A product page: no author checks; data 20 of experience 20 + data 20.
    const product = weighed(read, PROFILE_WEIGHTS.product.eeat);
    expect(product.checks.map((c) => c.id)).toEqual(['experience', 'originalData']);
    expect(product.score).toBe(50);
  });

  it('leaves a score not given as it was, and none with every check off', () => {
    expect(weighed({ score: null, checks: [] }, PROFILE_WEIGHTS.product.eeat).score).toBeNull();
    const authorOnly = eeat({ author });
    expect(weighed(authorOnly, PROFILE_WEIGHTS.product.eeat)).toEqual({ score: null, checks: [] });
  });

  it('keeps what else a score carries (Readability’s words)', () => {
    const html = `<h1>Pipeline</h1><p>${'Teams count each deal once a week. '.repeat(12)}</p>`;
    const read = readability(html, 'en');
    expect(weighed(read, PROFILE_WEIGHTS.product.readability)).toMatchObject({
      words: read.words,
    });
  });

  it('weighs a category page’s E-E-A-T with the brand’s own information, not all or nothing', () => {
    const category = (own: number, site: number) =>
      weighed(
        eeat({
          author: null,
          visual: { images: 2, own, openSpots: 0 },
          siteTrust: { score: site },
        }),
        PROFILE_WEIGHTS.category.eeat,
      ).score;
    // Stock images only, the site's trust in full: 40 of 100.
    expect(category(0, 5)).toBe(40);
    expect(category(1, 5)).toBe(100);
    // An article leaves the brand's information out.
    expect(
      weighed(eeat({ author, siteTrust: { score: 0 } }), PROFILE_WEIGHTS.article.eeat).checks.map(
        (c) => c.id,
      ),
    ).toEqual(['byline', 'authorBio']);
  });
});

describe('weighedTrust', () => {
  const now = Date.parse('2026-10-25');
  const read = (html: string) =>
    trust({
      blocks: trustBlocks(html),
      links: new Map([
        [
          'https://example.org/report',
          {
            href: 'https://example.org/report',
            status: 'ok',
            httpStatus: 200,
            date: '2019-01-01T00:00:00.000Z',
          },
        ],
      ]),
      brandDomains: ['acme.com'],
      siteTrust: { score: 5 },
      now,
    });

  it('isn’t scored by links and the site alone on a type that leaves freshness out', () => {
    const dated = read('<p>See <a href="https://example.org/report">the report</a>.</p>');
    // An article reads its stale source: scored.
    expect(weighedTrust(dated, PROFILE_WEIGHTS.article.trust).score).not.toBeNull();
    // A product page doesn't weigh freshness: a working link and the site aren't Trust.
    const product = weighedTrust(dated, PROFILE_WEIGHTS.product.trust);
    expect(product.score).toBeNull();
    expect(product.phase1Points).toBe(25);
    // A figure brings it in.
    const figure = read(
      '<p>It cut costs by 40% (<a href="https://example.org/report">the report</a>).</p>',
    );
    expect(weighedTrust(figure, PROFILE_WEIGHTS.product.trust).score).not.toBeNull();
    // So does its product feed's check (CE-053).
    const fed = trust({
      blocks: trustBlocks('<p>The Ridge 28 costs $129.</p>'),
      links: new Map(),
      brandDomains: [],
      feed: { compared: 1, mismatches: [] },
      now: Date.parse('2026-10-25'),
    });
    expect(weighedTrust(fed, PROFILE_WEIGHTS.product.trust).score).toBe(100);
  });

  it('is scored by a compared price where brand facts weigh as much as sourced claims (#1491 review)', () => {
    // One wrong price, no claim, the site's trust in full.
    const priced = trust({
      blocks: trustBlocks('<p>The Ridge 28 costs $59.</p>'),
      links: new Map(),
      brandDomains: ['acme.com'],
      siteTrust: { score: 5 },
      brandFacts: {
        compared: 1,
        mismatches: [
          {
            kind: 'price',
            page: '$59',
            fact: '$49',
            source: 'pricing',
            sentence: 'The Ridge 28 costs $59.',
          },
        ],
      },
      now,
    });
    expect(priced.score).toBeNull();
    // Brand facts 0 of 30, site trust 15 of 15: 33.
    expect(weighedTrust(priced, PROFILE_WEIGHTS.product.trust).score).toBe(33);
    expect(weighedTrust(priced, PROFILE_WEIGHTS.category.trust).score).not.toBeNull();
    // An article weighs them 10 to its claims' 30: a price alone isn't its Trust.
    expect(weighedTrust(priced, PROFILE_WEIGHTS.article.trust).score).toBeNull();
  });
});
