import { describe, expect, it } from 'vitest';
import {
  PRIORITY_WEIGHTS,
  rankOpportunities,
  scorePriority,
  scoreTemplate,
  sessionsRanker,
} from './priority.js';

const row = (over = {}) => ({
  path: '/page',
  pinned: false,
  reasons: [],
  sessions: null,
  aiVisits: null,
  lastAudit: null,
  ...over,
});
const noRank = () => null;

describe('sessionsRanker', () => {
  it("ranks a page's sessions among the site's, from 0 to 1", () => {
    const rank = sessionsRanker([10, 40, null, 0, 90, 250]);
    expect(rank(250)).toBe(1);
    expect(rank(10)).toBe(0);
    expect(rank(90)).toBeCloseTo(2 / 3);
    // A page between two site pages beats the ones below it.
    expect(rank(50)).toBeCloseTo(2 / 3);
    // Above every site page it is still 1, and equal pages share a rank.
    expect(rank(400)).toBe(1);
    expect(sessionsRanker([10, 50, 50])(50)).toBe(0.5);
    expect(rank(0)).toBeNull();
    expect(rank(null)).toBeNull();
    expect(sessionsRanker([])(30)).toBeNull();
    expect(sessionsRanker([30])(30)).toBe(1);
  });
});

describe('scorePriority', () => {
  it("scores the spec's top example at 88: value 0.96 × opportunity 0.9 × ease 0.8", () => {
    const score = scorePriority(
      row({
        reasons: [
          {
            type: 'no_ai_traffic',
            signal: 'revenue',
            percentile: 96,
            citationState: 'targeted_not_cited',
          },
          { type: 'never_audited' },
        ],
      }),
      noRank,
    );
    expect(score).toEqual({ priority: 88, value: 0.96, opportunity: 0.9, ease: 0.8 });
  });

  it('weighs revenue above key events above engagement', () => {
    const value = (signal) =>
      scorePriority(
        row({ reasons: [{ type: 'no_ai_traffic', signal, percentile: 90, citationState: null }] }),
        noRank,
      ).value;
    expect(value('revenue')).toBe(0.9);
    expect(value('transactions')).toBe(0.9);
    expect(value('key_events')).toBe(0.81);
    expect(value('engagement')).toBe(0.68);
  });

  it("values a page without GA by its sessions' rank, and never below the floor", () => {
    const rank = sessionsRanker([5, 20, 80]);
    expect(scorePriority(row({ sessions: 80 }), rank).value).toBe(PRIORITY_WEIGHTS.value.sessions);
    expect(scorePriority(row({ sessions: 20 }), rank).value).toBe(0.3);
    expect(scorePriority(row({ sessions: null }), rank).value).toBe(PRIORITY_WEIGHTS.value.min);
  });

  it('adds up the opportunity, caps the competitor share and the total', () => {
    // An audited page, so "never audited" doesn't add to these.
    const audited = { lastAudit: { score: 0.5 } };
    const opportunity = (reasons, extra = {}) =>
      scorePriority(row({ reasons, ...audited, ...extra }), noRank).opportunity;
    expect(opportunity([{ type: 'competitor_cited', prompts: 1, competitors: ['A'] }])).toBe(0.3);
    expect(opportunity([{ type: 'competitor_cited', prompts: 3, competitors: ['A'] }])).toBe(0.4);
    expect(opportunity([{ type: 'competitor_cited', prompts: 20, competitors: ['A'] }])).toBe(0.45);
    expect(opportunity([{ type: 'stale_audit', days: 120 }])).toBe(0.2);
    // Never audited counts from the page's audits, whichever source listed it.
    expect(opportunity([], { lastAudit: null })).toBe(0.3);
    // No AI visits counts once: GA's reason already says so.
    expect(opportunity([{ type: 'never_audited' }], { aiVisits: 0, lastAudit: null })).toBe(0.4);
    expect(
      opportunity(
        [
          { type: 'no_ai_traffic', signal: 'revenue', percentile: 99, citationState: null },
          { type: 'competitor_cited', prompts: 10, competitors: ['A'] },
        ],
        { aiVisits: 0, lastAudit: null },
      ),
    ).toBe(1);
    // A pinned, audited page with nothing to fix still has the floor.
    expect(opportunity([])).toBe(PRIORITY_WEIGHTS.opportunity.min);
  });

  it('makes a page close to passing easier than one far from it', () => {
    const ease = (score) =>
      scorePriority(row({ lastAudit: score === null ? null : { score } }), noRank).ease;
    expect(ease(0.65)).toBe(1);
    expect(ease(0.5)).toBe(0.75);
    expect(ease(0.2)).toBe(0.55);
    expect(ease(null)).toBe(0.8);
  });

  it('makes a page whose template shares its gaps easier, up to 1 (SA-007)', () => {
    const shared = new Set(['/blog/*']);
    const ease = (path, score) =>
      scorePriority(row({ path, lastAudit: score === null ? null : { score } }), noRank, shared)
        .ease;
    expect(ease('/blog/milk-drinks', null)).toBe(0.9);
    expect(ease('/blog/milk-drinks', 0.5)).toBe(0.85);
    expect(ease('/blog/milk-drinks', 0.65)).toBe(1);
    expect(ease('/guides/espresso', null)).toBe(0.8);
    expect(ease('/pricing', null)).toBe(0.8);
  });
});

describe('scoreTemplate', () => {
  const template = (over = {}) => ({
    path: '/blog/*',
    pinned: false,
    reasons: [{ type: 'template_gaps', gaps: [{ key: 'author-byline' }] }],
    sessions: 900,
    aiVisits: 112,
    template: { pages: 38, audited: 12, toAudit: [] },
    ...over,
  });

  it('scores a template from its sessions, shared gaps, unaudited share and the template fix', () => {
    // Above every site page: the top of the sessions value.
    const rank = sessionsRanker([10, 40, 90]);
    expect(scoreTemplate(template(), rank)).toEqual({
      priority: 65,
      value: 0.6,
      // 0.3 for the gap + 0.3 × 26 of 38 not audited.
      opportunity: 0.51,
      ease: 0.9,
    });
    const more = scoreTemplate(
      template({
        aiVisits: 0,
        reasons: [
          {
            type: 'template_gaps',
            gaps: [{ key: 'a' }, { key: 'b' }, { key: 'c' }, { key: 'd' }, { key: 'e' }],
          },
        ],
        template: { pages: 10, audited: 10, toAudit: [] },
      }),
      rank,
    );
    // Gaps capped at 0.45, plus no AI visits; all audited.
    expect(more.opportunity).toBe(0.55);
  });

  it('ranks template rows with the pages', () => {
    const ranked = rankOpportunities([row({ path: '/pricing' }), template()], [10, 40, 90]);
    expect(ranked.map((r) => r.path)).toEqual(['/blog/*', '/pricing']);
    expect(ranked[0].priorityParts.ease).toBe(0.9);
  });
});

describe('rankOpportunities', () => {
  it('orders pinned pages first, then by priority, then by path, and adds the parts', () => {
    const ranked = rankOpportunities(
      [
        row({ path: '/never-b', reasons: [{ type: 'never_audited' }] }),
        row({ path: '/never-a', reasons: [{ type: 'never_audited' }] }),
        row({ path: '/pinned', pinned: true }),
        row({
          path: '/ga',
          reasons: [
            { type: 'no_ai_traffic', signal: 'revenue', percentile: 95, citationState: null },
          ],
        }),
      ],
      [],
    );
    expect(ranked.map((r) => [r.path, r.priority])).toEqual([
      ['/pinned', 33],
      ['/ga', 83],
      ['/never-a', 33],
      ['/never-b', 33],
    ]);
    expect(ranked[1].priorityParts).toEqual({ value: 0.95, opportunity: 0.75, ease: 0.8 });
  });
});
