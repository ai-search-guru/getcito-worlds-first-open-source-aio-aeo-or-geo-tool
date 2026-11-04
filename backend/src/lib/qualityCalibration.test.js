import { describe, expect, it } from 'vitest';
import {
  calibrate,
  calibrationWeights,
  interval,
  parseRows,
  ranks,
  scoreOf,
  spearman,
  suggestWeights,
} from './qualityCalibration.js';

/** Quality's weights against AI citations (Quality spec §11, CE-055). */

/** A seeded random number generator: the same "random" pages every run. */
function seeded(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

describe('ranks, spearman and interval', () => {
  it('ranks ties by their average, and correlates by rank', () => {
    expect(ranks([10, 20, 20, 5])).toEqual([2, 3.5, 3.5, 1]);
    expect(spearman([1, 2, 3, 4], [10, 20, 30, 400])).toBe(1);
    expect(spearman([1, 2, 3, 4], [4, 3, 2, 1])).toBe(-1);
    // Too few pairs, or a list of one value: nothing to say.
    expect(spearman([1, 2], [1, 2])).toBeNull();
    expect(spearman([1, 1, 1], [1, 2, 3])).toBeNull();
    expect(spearman([1, 2, 3], [1, 2])).toBeNull();
  });

  it('reads a correlation only where its 95% interval leaves 0 out', () => {
    // 30 pages: about 0.36 is where noise ends.
    expect(interval(0.156, 30)).toMatchObject({ read: false });
    expect(interval(0.5, 30)).toMatchObject({ read: true });
    expect(interval(-0.5, 30)).toMatchObject({ read: true });
    const { low, high } = interval(0.5, 30);
    expect(low).toBeLessThan(0.5);
    expect(high).toBeGreaterThan(0.5);
    expect(interval(null, 30)).toBeNull();
    expect(interval(0.9, 3)).toBeNull();
  });
});

describe('parseRows', () => {
  it('keeps the rows as their profile, checks, citations and group, and counts the lines that aren’t rows', () => {
    const text = [
      // A byte-order mark before the first row doesn't cost it.
      `\uFEFF${JSON.stringify({
        url: 'https://acme.com/blog/x',
        brand: 'Acme',
        profile: 'article',
        checks: { trust: { claimsSourced: 0.5 } },
        citations: 3,
        group: 'g1',
      })}`,
      '',
      'not json',
      JSON.stringify({ profile: 'blog', checks: {}, citations: 1 }),
      JSON.stringify({ profile: 'article', checks: { eeat: { byline: 2 } }, citations: 1 }),
      // A check named like a URL isn't one.
      JSON.stringify({ profile: 'article', checks: { eeat: { 'acme.com/x': 1 } }, citations: 1 }),
      // Citations per day are as good as counts: only their ranks count.
      JSON.stringify({ profile: 'article', checks: {}, citations: 0.25 }),
    ].join('\r\n');
    const { rows, invalid } = parseRows(text);
    expect(rows).toEqual([
      { profile: 'article', checks: { trust: { claimsSourced: 0.5 } }, citations: 3, group: 'g1' },
      { profile: 'article', checks: {}, citations: 0.25 },
    ]);
    expect(invalid).toBe(4);
  });
});

describe('calibrate', () => {
  // Pages whose sourced claims go with their citations, and whose links don't.
  const pages = Array.from({ length: 40 }, (_, i) => ({
    profile: 'article',
    checks: {
      trust: { claimsSourced: i / 39, noBrokenLinks: 1 - i / 39, expertQuote: 1 },
      eeat: { byline: i < 20 ? 0 : 1 },
    },
    citations: i,
  }));
  const weights = {
    article: {
      trust: { claimsSourced: 30, noBrokenLinks: 10, expertQuote: 8, brandFacts: 12 },
      eeat: { byline: 50, authorBio: 50 },
      readability: {},
    },
  };

  it('gives each check’s correlation and interval, from enough pages only, and nothing of a page', () => {
    const text = pages
      .map((page, i) =>
        JSON.stringify({ ...page, url: `https://acme.com/p/${i}`, brand: 'Acme', group: 'acme' }),
      )
      .join('\n');
    const report = calibrate(parseRows(text).rows);
    expect(report.pages).toBe(40);
    const trust = report.profiles.article.scores.trust.checks;
    expect(trust.claimsSourced).toMatchObject({ pages: 40, rho: 1, interval: { read: true } });
    expect(trust.noBrokenLinks).toMatchObject({ rho: -1, interval: { read: true } });
    // One value on every page: no correlation.
    expect(trust.expertQuote.rho).toBeNull();
    // Fewer pages than the minimum: none read.
    expect(
      calibrate(pages, { minPages: 50 }).profiles.article.scores.trust.checks.claimsSourced,
    ).toEqual({ pages: 40, rho: null, interval: null });
    // No page, brand or group in what it gives back.
    expect(JSON.stringify(report)).not.toMatch(/acme|https?:/i);
  });

  it('answers the spec’s question: how each score goes with the citations', () => {
    const { trust } = calibrate(pages, { weights }).profiles.article.scores;
    expect(trust.rho).toBeGreaterThan(0.8);
    expect(trust.rhoSuggestedInSample).toBeGreaterThan(0.8);
    expect(
      scoreOf(
        { claimsSourced: 0.5, noBrokenLinks: 1 },
        { claimsSourced: 30, noBrokenLinks: 10, x: 0 },
      ),
    ).toBe(63);
    expect(scoreOf({}, { claimsSourced: 30 })).toBeNull();
  });

  it('compares citations within a page’s group: a big brand’s pages aren’t a good score', () => {
    // Within each brand, more sourced claims go with more citations; across
    // them, the big brand's pages have fewer sourced claims and far more citations.
    const rows = [
      ...Array.from({ length: 20 }, (_, i) => ({
        profile: 'article',
        checks: { trust: { claimsSourced: i / 40 } },
        citations: 1000 + i,
        group: 'big',
      })),
      ...Array.from({ length: 20 }, (_, i) => ({
        profile: 'article',
        checks: { trust: { claimsSourced: 0.5 + i / 40 } },
        citations: i,
        group: 'small',
      })),
    ];
    const rho = (list) => calibrate(list).profiles.article.scores.trust.checks.claimsSourced.rho;
    expect(rho(rows)).toBeGreaterThan(0.9);
    expect(rho(rows.map(({ group: _group, ...row }) => row))).toBeLessThan(0);
  });

  it('suggests weights from the weights in use, the score’s total kept', () => {
    const { suggested } = calibrate(pages, { weights }).profiles.article.scores.trust;
    // Sourced claims take half of what working links had; brand facts, not
    // read, and the expert quote, of one value, keep theirs; none goes to 0.
    expect(suggested).toEqual({
      claimsSourced: 35,
      noBrokenLinks: 5,
      expertQuote: 8,
      brandFacts: 12,
    });
    expect(Object.values(suggested).every((points) => points > 0)).toBe(true);
    expect(Object.values(suggested).reduce((a, b) => a + b, 0)).toBe(60);
    // No weights given: no suggestion.
    expect(calibrate(pages).profiles.article.scores.trust).not.toHaveProperty('suggested');
  });

  it('leaves the weights as they are on pages whose checks have nothing to do with their citations', () => {
    const random = seeded(7);
    const noise = Array.from({ length: 30 }, () => ({
      profile: 'product',
      checks: {
        eeat: { experience: random(), originalData: random(), visualProof: random() },
      },
      citations: Math.floor(random() * 20),
    }));
    const current = { experience: 20, originalData: 20, visualProof: 60 };
    const report = calibrate(noise, {
      weights: { product: { eeat: current, trust: {}, readability: {} } },
    });
    expect(report.profiles.product.scores.eeat.suggested).toEqual(current);
  });
});

describe('suggestWeights', () => {
  const read = (rho) => ({ pages: 40, rho, interval: interval(rho, 40) });

  it('keeps half the weights in use and shares half by positive correlation, none under 1', () => {
    expect(
      suggestWeights(
        { a: 20, b: 20, c: 10 },
        { a: read(0.6), b: read(0.4), c: { pages: 5, rho: null } },
      ),
    ).toEqual({ a: 22, b: 18, c: 10 });
    // A check that goes with fewer citations keeps a point at least: dropping it is the maintainer's call.
    expect(suggestWeights({ a: 20, b: 20 }, { a: read(0.5), b: read(-0.5) })).toEqual({
      a: 30,
      b: 10,
    });
    expect(suggestWeights({ a: 2, b: 1 }, { a: read(0.9), b: read(-0.9) })).toEqual({ a: 2, b: 1 });
    // No positive read check: as they are.
    expect(suggestWeights({ a: 20, b: 20 }, { a: read(-0.5), b: read(0.1) })).toEqual({
      a: 20,
      b: 20,
    });
    // A check weighed 0 stays out.
    expect(suggestWeights({ a: 0, b: 30 }, { a: read(0.9), b: read(0.5) })).toEqual({
      a: 0,
      b: 30,
    });
  });

  it('rounds to whole points, the total exact', () => {
    const out = suggestWeights({ a: 4, b: 3, c: 3 }, { a: read(0.5), b: read(0.5), c: read(0.5) });
    expect(Object.values(out).reduce((x, y) => x + y, 0)).toBe(10);
    expect(Object.values(out).every(Number.isInteger)).toBe(true);
  });
});

describe('calibrationWeights', () => {
  it('reads PROFILE_WEIGHTS, and not points written as text or a wrapped export', () => {
    const scores = { eeat: { byline: 100 }, trust: { claimsSourced: 100 }, readability: {} };
    expect(calibrationWeights.safeParse({ article: scores }).success).toBe(true);
    expect(
      calibrationWeights.safeParse({ article: { ...scores, eeat: { byline: '100' } } }).success,
    ).toBe(false);
    expect(calibrationWeights.safeParse({ PROFILE_WEIGHTS: { article: scores } }).success).toBe(
      false,
    );
  });
});
