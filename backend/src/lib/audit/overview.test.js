import { describe, expect, it } from 'vitest';
import { buildOverview, primaryPages, OVERVIEW_GAPS } from './overview.js';

const page = (auditId, score, previousScore = null, host = 'acme.com') => ({
  auditId,
  host,
  score,
  previousScore,
});

describe('primaryPages', () => {
  it('keeps the audited pages of the primary domain and counts the other sites', () => {
    const { own, otherPages } = primaryPages(
      [
        page('a', 0.6),
        page('b', 0.7, null, 'other.com'),
        page('c', null), // never completed
        page('d', 0.8),
      ],
      'acme.com',
    );
    expect(own.map((p) => p.auditId)).toEqual(['a', 'd']);
    expect(otherPages).toBe(1);
  });

  it('has no own pages without a primary domain', () => {
    expect(primaryPages([page('a', 0.6)], null)).toEqual({ own: [], otherPages: 1 });
  });
});

describe('buildOverview', () => {
  const scores = new Map([
    ['a', { authority: { score: 0.4 }, eeat: { score: 0.3 } }],
    ['b', { authority: { score: 0.36 }, eeat: { score: null } }],
    ['c', {}],
  ]);

  it("averages each page's latest audit, and compares with each page's previous one", () => {
    const overview = buildOverview(
      [page('a', 0.7, 0.6), page('b', 0.6), page('c', 0.74, 0.7)],
      scores,
      [],
    );
    expect(overview.pages).toBe(3);
    expect(overview.siteScore).toBeCloseTo(0.68);
    // Now 68; before, 63 (60, 60 unchanged and 70: 63.3 rounds to 63) → +5.
    expect(overview.siteScoreChange).toBe(68 - 63);
    // Pages without a category score are left out of its average.
    expect(overview.authority).toBeCloseTo(0.38);
    expect(overview.eeat).toBeCloseTo(0.3);
    // The summary strip's weakest category (SA-019).
    expect(overview.lowestCategory).toEqual({ key: 'eeat', score: 0.3 });
  });

  it('finds the lowest category among all five, a tie going to the rubric order', () => {
    const all = new Map([
      [
        'a',
        {
          structure: { score: 0.8 },
          content: { score: 0.5 },
          authority: { score: 0.5 },
          eeat: { score: 0.6 },
          trust: { score: 0.9 },
        },
      ],
    ]);
    // The rubric lists authority before content.
    expect(buildOverview([page('a', 0.6)], all, []).lowestCategory).toEqual({
      key: 'authority',
      score: 0.5,
    });
  });

  it('has no change when no page was audited twice, and nothing without pages', () => {
    expect(buildOverview([page('a', 0.7)], scores, []).siteScoreChange).toBeNull();
    expect(buildOverview([], scores, [])).toEqual({
      pages: 0,
      siteScore: null,
      siteScoreChange: null,
      authority: null,
      eeat: null,
      lowestCategory: null,
      gaps: [],
    });
  });

  it('lists the signals failing on the most pages, each page once', () => {
    const rows = [
      { audit_id: 'a', signal_key: 'author-byline' },
      { audit_id: 'b', signal_key: 'author-byline' },
      { audit_id: 'c', signal_key: 'author-byline' },
      { audit_id: 'a', signal_key: 'press-mentions' },
      { audit_id: 'b', signal_key: 'press-mentions' },
      { audit_id: 'a', signal_key: 'quotations' },
      { audit_id: 'b', signal_key: 'case-study-evidence' },
      { audit_id: 'a', signal_key: 'byline-depth' },
      // Another site's audit doesn't count.
      { audit_id: 'z', signal_key: 'quotations' },
    ];
    const { gaps } = buildOverview([page('a', 0.7), page('b', 0.6), page('c', 0.5)], scores, rows);
    expect(gaps).toHaveLength(OVERVIEW_GAPS);
    expect(gaps).toEqual([
      { key: 'author-byline', label: 'Author byline', category: 'authority', pages: 3 },
      { key: 'press-mentions', label: 'Press mentions', category: 'eeat', pages: 2 },
      // Ties read in key order.
      { key: 'byline-depth', label: 'Byline depth', category: 'eeat', pages: 1 },
    ]);
  });
});
