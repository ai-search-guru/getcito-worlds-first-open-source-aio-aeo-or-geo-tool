import { describe, expect, it } from 'vitest';
import {
  MAX_ROWS,
  buildPlan,
  conversionsShareOf,
  conversionsValue,
  dropSeverity,
  pageValueOf,
  planPriorityLevel,
  rowsFor,
  visitsValue,
  type PlanAnswers,
  type PlanDraft,
  type PlanMark,
  type PlanOpportunity,
  type PlanPage,
} from './plan';

/**
 * The Content plan (CE-014): opportunities and the brand's pages as one
 * ranked list of what to create, optimize or protect, without the same page
 * twice, with the drafts already being written.
 */

const page = (path: string, over: Partial<PlanPage> = {}): PlanPage => ({
  page: `https://acme.example${path}`,
  title: path.slice(1),
  citations: { cur: 2, prev: 2 },
  platformsDown: [],
  aiVisits: 0,
  conversions: null,
  ...over,
});
const opportunity = (id: string, over: Partial<PlanOpportunity> = {}): PlanOpportunity => ({
  id,
  title: `Opportunity ${id}`,
  pageTitle: null,
  decision: 'create',
  score: 70,
  targetPage: null,
  targetTitle: null,
  competitorsCited: [],
  visibility: null,
  prompts: 3,
  assetType: null,
  ...over,
});
const plan = (
  pages: PlanPage[],
  opportunities: PlanOpportunity[] = [],
  drafts: PlanDraft[] = [],
  answers: PlanAnswers = { cur: 100, prev: 100 },
  marks: PlanMark[] = [],
) => buildPlan({ pages, answers, opportunities, drafts, marks, siteType: 'b2b' });

describe('buildPlan', () => {
  it('creates a new page for an opportunity, named by its brief, with its evidence', () => {
    const { rows, counts } = plan(
      [],
      [
        opportunity('o1', {
          title: 'Create a pricing comparison',
          pageTitle: 'Northwind vs HubSpot',
          competitorsCited: ['HubSpot'],
          visibility: 6,
          score: 81.4,
        }),
      ],
    );
    expect(rows).toEqual([
      expect.objectContaining({
        action: 'create',
        title: 'Northwind vs HubSpot',
        page: null,
        pageType: 'comparison',
        why: { kind: 'competitors', names: ['HubSpot'], visibility: 6 },
        source: 'opportunity',
        // 20 a new page + 24.3 the opportunity's 81 + 10 page value (neutral) + 0 citations.
        score: 54.3,
        opportunityId: 'o1',
        draft: null,
      }),
    ]);
    expect(counts).toEqual({ create: 1, optimize: 0, protect: 0, priority: 0 });
  });

  it("types an opportunity's page as the opportunity does, when the site writes that type", () => {
    const { rows } = plan(
      [],
      [
        // An older type, read as this B2B site's page type.
        opportunity('o1', { pageTitle: 'Northwind vs HubSpot', assetType: 'faq_page', score: 90 }),
        opportunity('o2', { pageTitle: 'Northwind vs Pipedrive', assetType: 'alternatives' }),
        // A shop's type, and the older default: the title tells instead.
        opportunity('o3', {
          pageTitle: 'Northwind vs Close',
          assetType: 'sizing_guide',
          score: 50,
        }),
        opportunity('o4', { pageTitle: 'Northwind vs Zoho', assetType: 'blog_post', score: 40 }),
      ],
    );
    expect(rows.map((r) => r.pageType)).toEqual([
      'docs_faq',
      'alternatives',
      'comparison',
      'comparison',
    ]);
  });

  it('types an existing page by its own address first, then by its opportunity', () => {
    const optimize = (id: string, targetPage: string, assetType: string) =>
      opportunity(id, { decision: 'optimize', targetPage, targetTitle: 'Our page', assetType });
    const { rows } = plan(
      [],
      [optimize('o1', '/shipping', 'landing_page'), optimize('o2', '/crm-tips', 'comparison_page')],
    );
    expect(rows.map((r) => [r.page, r.pageType])).toEqual([
      ['/shipping', 'docs_faq'],
      ['/crm-tips', 'comparison'],
    ]);
  });

  it('optimizes a page losing citations, by how much it lost, with the platforms citing it less', () => {
    const { rows } = plan([
      page('/features/forecasting', {
        citations: { cur: 6, prev: 10 },
        platformsDown: ['chatgpt-web', 'perplexity-web'],
      }),
      // Down 10%: not losing ground.
      page('/features/email', { citations: { cur: 9, prev: 10 } }),
      // Too few to tell.
      page('/blog/note', { citations: { cur: 0, prev: 2 } }),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      action: 'optimize',
      page: 'https://acme.example/features/forecasting',
      why: { kind: 'citationsDown', pct: 40, platforms: ['chatgpt-web', 'perplexity-web'] },
      source: 'citations',
      // 30.4 the drop + 12 no opportunity + 10 page value (no traffic data) + 2 citations.
      score: 54.4,
    });
    expect(rows[1]).toMatchObject({ action: 'protect', title: 'features/email' });
  });

  it('compares citations per tracked answer, so fewer runs or prompts move no page', () => {
    const pages = [page('/features/forecasting', { citations: { cur: 5, prev: 10 } })];
    // Half the answers this period (a weekly brand before its run, prompts removed).
    expect(plan(pages, [], [], { cur: 50, prev: 100 }).rows[0]).toMatchObject({
      action: 'protect',
    });
    // The same answers: down 50%, 5 citations lost.
    expect(plan(pages).rows[0]).toMatchObject({
      why: { kind: 'citationsDown', pct: 50 },
      score: 55.7,
    });
    // Twice the answers and the same citations: down 50% per answer, 15 lost.
    expect(plan(pages, [], [], { cur: 200, prev: 100 }).rows[0]).toMatchObject({
      why: { kind: 'citationsDown', pct: 75 },
      score: 59.7,
    });
    // No answers before: nothing to compare with.
    expect(plan(pages, [], [], { cur: 100, prev: 0 }).rows[0]).toMatchObject({
      action: 'protect',
    });
  });

  it('reckons a drop as bad as its share or its citations lost say, whichever says more', () => {
    expect(dropSeverity(20, 2)).toBeCloseTo(0.68);
    expect(dropSeverity(20, 10)).toBeCloseTo(0.8);
    // 82 citations lost is as bad as losing them all.
    expect(dropSeverity(41, 82)).toBe(1);
    expect(dropSeverity(100, 3)).toBe(1);
  });

  it('keeps one row for a page an opportunity targets, with the period’s signal when it is losing', () => {
    const { rows } = plan(
      [page('/guides/espresso/', { citations: { cur: 2, prev: 8 } })],
      [
        opportunity('o1', {
          title: 'Expand the espresso guide',
          decision: 'optimize',
          targetPage: 'https://www.acme.example/guides/espresso',
          targetTitle: 'The home espresso guide',
          score: 50,
        }),
      ],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: 'optimize',
      title: 'The home espresso guide',
      opportunityId: 'o1',
      source: 'citations',
      why: { kind: 'citationsDown', pct: 75 },
      // 36 the drop + 15 the opportunity's 50 + 10 page value + 0.7 citations.
      score: 61.7,
    });
  });

  it('protects the five most cited pages, after the work to do', () => {
    const pages = [5, 6, 7, 8, 9, 30].map((cur, i) =>
      page(`/p${i}`, { citations: { cur, prev: cur }, aiVisits: 10 }),
    );
    const { rows, counts } = plan(pages, [opportunity('o1', { score: 61 })]);
    expect(counts.protect).toBe(5);
    expect(rows.map((r) => r.title)).toEqual(['Opportunity o1', 'p5', 'p4', 'p3', 'p2', 'p1']);
    expect(rows[1]).toMatchObject({
      why: { kind: 'top', citations: 30, aiVisits: 10 },
      // 8 protect + 12 no opportunity + 6.9 for 10 AI visits + 10 for 30 citations.
      score: 36.9,
    });
  });

  it('protects a page an opportunity says to defend', () => {
    const { rows } = plan(
      [],
      [
        opportunity('o1', {
          decision: 'defend',
          targetPage: 'https://acme.example/pricing',
          targetTitle: 'Pricing',
        }),
      ],
    );
    expect(rows[0]).toMatchObject({ action: 'protect', page: 'https://acme.example/pricing' });
  });

  it('leaves a top page past the five protected off the list', () => {
    const pages = [5, 6, 7, 8, 9, 30].map((cur, i) =>
      page(`/p${i}`, { citations: { cur, prev: cur } }),
    );
    const { rows, counts } = plan(pages);
    expect(counts.protect).toBe(5);
    expect(rows.find((r) => r.title === 'p0')).toBeUndefined();
  });

  it('counts every row, and each card lists its own first rows', () => {
    const opportunities = Array.from({ length: 60 }, (_, i) =>
      opportunity(`o${i}`, { score: 99 - (i % 30) }),
    );
    const pages = [
      page('/top', { citations: { cur: 30, prev: 30 } }),
      page('/guides/losing', { citations: { cur: 2, prev: 8 } }),
    ];
    const { rows, counts } = plan(pages, opportunities);
    expect(counts).toEqual({ create: 60, optimize: 1, protect: 1, priority: 0 });
    expect(rowsFor(rows, null)).toHaveLength(MAX_ROWS);
    // Below the 50 opportunities on score, and still shown on their cards.
    expect(rowsFor(rows, 'protect').map((r) => r.title)).toEqual(['top']);
    expect(rowsFor(rows, 'optimize').map((r) => r.title)).toEqual(['guides/losing']);
  });

  it('lists no page only because other pages of the brand are cited for its prompts', () => {
    // A steady page under the top-page bar: nothing to do, whatever else is cited.
    const { rows, counts } = plan([
      page('/blog/espresso-basics'),
      page('/guides/espresso', { citations: { cur: 12, prev: 10 } }),
    ]);
    expect(rows.map((r) => [r.action, r.why.kind])).toEqual([['protect', 'top']]);
    expect(counts).toEqual({ create: 0, optimize: 0, protect: 1, priority: 0 });
  });

  it('finds the draft being written for an opportunity or a page', () => {
    const drafts: PlanDraft[] = [
      {
        id: 'd1',
        author: 'agent',
        isMine: false,
        method: 'create',
        opportunityId: 'o1',
        sourceUrl: null,
        actionId: null,
        assignee: null,
      },
      {
        id: 'd2',
        author: 'user',
        isMine: true,
        method: 'optimize',
        opportunityId: null,
        sourceUrl: 'https://acme.example/features/forecasting/',
        actionId: 'a1',
        assignee: { id: 'u2', name: 'Ada Lovelace' },
      },
    ];
    const { rows } = plan(
      [page('/features/forecasting', { citations: { cur: 1, prev: 9 } })],
      [opportunity('o1')],
      drafts,
    );
    // The page losing ground (1 of 9: 60.5) ranks over the new page (70: 51).
    expect(rows.map((r) => r.draft?.id)).toEqual(['d2', 'd1']);
    expect(rows[0].draft?.assignee).toEqual({ id: 'u2', name: 'Ada Lovelace' });
  });

  it('puts the rows marked as a priority first, and counts them', () => {
    const marks: PlanMark[] = [{ rowKey: 'page:acme.example/top', priority: true, hidden: false }];
    const { rows, counts } = plan(
      [page('/top', { citations: { cur: 30, prev: 30 } })],
      [opportunity('o1', { score: 90 })],
      [],
      undefined,
      marks,
    );
    // The protected page (50) outranks the opportunity (90) once it is a priority.
    expect(rows.map((r) => [r.title, r.priority])).toEqual([
      ['top', true],
      ['Opportunity o1', false],
    ]);
    expect(counts.priority).toBe(1);
    expect(rowsFor(rows, 'priority').map((r) => r.title)).toEqual(['top']);
  });

  it('takes hidden rows off the list and its counts, to show again', () => {
    const marks: PlanMark[] = [
      { rowKey: 'opportunity:o1', priority: true, hidden: true },
      { rowKey: 'page:acme.example/losing', priority: false, hidden: true },
    ];
    const { rows, hidden, counts } = plan(
      [page('/losing', { citations: { cur: 2, prev: 8 } })],
      [opportunity('o1'), opportunity('o2')],
      [],
      undefined,
      marks,
    );
    expect(rows.map((r) => r.key)).toEqual(['opportunity:o2']);
    expect(hidden.map((r) => r.key)).toEqual(['page:acme.example/losing', 'opportunity:o1']);
    expect(counts).toEqual({ create: 1, optimize: 0, protect: 0, priority: 0 });
  });
});

// The Priority Score column shows each row's score and what it is made of:
// 40 severity, 30 opportunity, 20 page value, 10 citation strength.
describe("a row's score breakdown", () => {
  it('gives a new page its opportunity, a neutral page value and no citations', () => {
    const { rows } = plan([], [opportunity('o1', { score: 81.4 })]);
    expect(rows[0].scoreParts).toEqual([
      { kind: 'severity', reason: 'create', value: 0.5, points: 20, max: 40 },
      { kind: 'opportunity', score: 81, value: 0.81, points: 24.3, max: 30 },
      { kind: 'pageValue', reason: 'newPage', value: 0.5, points: 10, max: 20 },
      { kind: 'citations', citations: 0, value: 0, points: 0, max: 10 },
    ]);
    expect(rows[0].score).toBe(54.3);
  });

  it("reckons a drop's severity, and a page with no opportunity as neutral", () => {
    const { rows } = plan([page('/features/forecasting', { citations: { cur: 6, prev: 10 } })]);
    expect(rows[0].scoreParts).toEqual([
      { kind: 'severity', reason: 'drop', pct: 40, lost: 4, value: 0.76, points: 30.4, max: 40 },
      { kind: 'opportunity', score: null, value: 0.4, points: 12, max: 30 },
      // No page with AI visits: the brand has no traffic data, so value is unknown.
      { kind: 'pageValue', reason: 'unknown', value: 0.5, points: 10, max: 20 },
      { kind: 'citations', citations: 6, value: 0.2, points: 2, max: 10 },
    ]);
    expect(rows[0].score).toBe(54.4);
  });

  it('values a page by its AI visits once the brand has traffic data, 1,000 counting in full', () => {
    const { rows } = plan([
      page('/a', { citations: { cur: 18, prev: 18 }, aiVisits: 1000 }),
      page('/b', { citations: { cur: 55, prev: 55 }, aiVisits: 0 }),
    ]);
    expect(rows.map((r) => [r.title, r.scoreParts[2], r.score])).toEqual([
      [
        'a',
        {
          kind: 'pageValue',
          reason: 'visits',
          visits: 1000,
          conversions: null,
          value: 1,
          points: 20,
          max: 20,
        },
        46,
      ],
      [
        'b',
        {
          kind: 'pageValue',
          reason: 'visits',
          visits: 0,
          conversions: null,
          value: 0,
          points: 0,
          max: 20,
        },
        30,
      ],
    ]);
  });

  it('weighs the conversions a page took part in, with conversions on: 60% visits, 40% conversions once the pages have 20', () => {
    const { rows } = plan([
      page('/a', { citations: { cur: 18, prev: 18 }, aiVisits: 1000, conversions: 20 }),
      page('/b', { citations: { cur: 18, prev: 18 }, aiVisits: 1000, conversions: 0 }),
      page('/c', { citations: { cur: 18, prev: 18 }, aiVisits: 10, conversions: 20 }),
    ]);
    const parts = Object.fromEntries(rows.map((r) => [r.title, r.scoreParts[2]]));
    // Visits and 20 conversions in full: the whole 20 points.
    expect(parts.a).toEqual({
      kind: 'pageValue',
      reason: 'visits',
      visits: 1000,
      conversions: 20,
      value: 1,
      points: 20,
      max: 20,
    });
    // The same visits, none converting: 60% of the value.
    expect(parts.b).toMatchObject({ conversions: 0, value: 0.6, points: 12 });
    // Few visits, many conversions: the conversions lift it.
    expect(parts.c.points).toBe(12.2);
    expect(pageValueOf(10, null)).toBeCloseTo(visitsValue(10));
    expect(conversionsValue(20)).toBe(1);
    expect(conversionsValue(0)).toBe(0);
  });

  it('weighs conversions only once some page has any, and reads them as traffic data', () => {
    // Turned on, none yet in the window: visits alone, as before.
    const none = plan([
      page('/a', { citations: { cur: 18, prev: 18 }, aiVisits: 1000, conversions: 0 }),
    ]);
    expect(none.rows[0].scoreParts[2]).toMatchObject({ conversions: null, value: 1, points: 20 });
    // Conversions but no AI visit on any page: still data, not unknown.
    const converting = plan([
      page('/a', { citations: { cur: 18, prev: 18 }, aiVisits: 0, conversions: 5 }),
    ]);
    expect(converting.rows[0].scoreParts[2]).toMatchObject({
      reason: 'visits',
      visits: 0,
      conversions: 5,
    });
  });

  it('weighs conversions more as the listed pages have more, in full at 20', () => {
    // One conversion: a 2% share, so no row moves by more than 0.4 points.
    const one = plan([
      page('/a', { citations: { cur: 18, prev: 18 }, aiVisits: 1000, conversions: 0 }),
      page('/b', { citations: { cur: 18, prev: 18 }, aiVisits: 1000, conversions: 1 }),
    ]);
    const parts = Object.fromEntries(one.rows.map((r) => [r.title, r.scoreParts[2]]));
    expect(parts.a).toMatchObject({ conversions: 0, points: 19.6 });
    expect(parts.b).toMatchObject({ conversions: 1, points: 19.7 });
    expect(conversionsShareOf([page('/a')])).toBe(0);
    expect(conversionsShareOf([page('/a', { conversions: 1 })])).toBeCloseTo(0.02);
    expect(
      conversionsShareOf([page('/a', { conversions: 4 }), page('/b', { conversions: 6 })]),
    ).toBeCloseTo(0.2);
    expect(conversionsShareOf([page('/a', { conversions: 40 })])).toBe(0.4);
  });

  it('gives an opportunity on a page losing ground the drop and the opportunity both', () => {
    const { rows } = plan(
      [page('/guides/espresso', { citations: { cur: 2, prev: 8 } })],
      [
        opportunity('o1', {
          decision: 'optimize',
          targetPage: 'https://acme.example/guides/espresso',
          score: 50,
        }),
      ],
    );
    expect(rows[0].scoreParts.map((p) => [p.kind, p.points])).toEqual([
      ['severity', 36],
      ['opportunity', 15],
      ['pageValue', 10],
      ['citations', 0.7],
    ]);
    expect(rows[0].score).toBe(61.7);
  });

  it('ranks a drop first, then new and existing pages, protecting last', () => {
    const { rows } = plan(
      [
        page('/losing', { citations: { cur: 2, prev: 8 } }),
        page('/top', { citations: { cur: 30, prev: 30 } }),
        page('/existing', { citations: { cur: 3, prev: 3 } }),
      ],
      [
        opportunity('new', { score: 80 }),
        opportunity('improve', {
          decision: 'optimize',
          targetPage: 'https://acme.example/existing',
          score: 70,
        }),
      ],
    );
    expect(rows.map((r) => [r.action, r.title])).toEqual([
      ['optimize', 'losing'],
      ['create', 'Opportunity new'],
      ['optimize', 'Opportunity improve'],
      ['protect', 'top'],
    ]);
  });

  it('caps a drop at full severity', () => {
    const { rows } = plan([page('/x', { citations: { cur: 0, prev: 90 } })]);
    expect(rows[0].scoreParts[0]).toEqual(
      expect.objectContaining({ pct: 100, lost: 90, value: 1, points: 40 }),
    );
  });
});

describe("the Plan badge's level", () => {
  it("uses the Plan's own cut-offs, so each kind of row can read above Low", () => {
    // An existing page with no drop tops out at 74, a top page with no opportunity at 50.
    expect(planPriorityLevel(74)).toBe('high');
    expect(planPriorityLevel(50)).toBe('medium');
    expect(planPriorityLevel(39.9)).toBe('low');
    // Only a page losing citations reaches Critical.
    expect(planPriorityLevel(75)).toBe('critical');
  });

  it('reads a strong new page High, a middling one Medium', () => {
    const levelOf = (score: number) => {
      const [row] = plan([], [opportunity('o1', { score })]).rows;
      return planPriorityLevel(Math.round(row.score));
    };
    // 20 a new page + 25.5 the opportunity's 85 + 10 page value (neutral): 55.5.
    expect(levelOf(85)).toBe('high');
    // The fixture's 70: 20 + 21 + 10 = 51.
    expect(levelOf(70)).toBe('medium');
  });
});
