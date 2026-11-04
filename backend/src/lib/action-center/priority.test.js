import { describe, expect, it } from 'vitest';
import {
  pastSuccessOf,
  priorityColumns,
  priorityLevel,
  promptIdsOf,
  scorePriority,
} from './priority.js';

/**
 * The priority score (AC-006): how soon to work on an action, 0–100, from
 * impact, demand, severity, business value, independent confirmation,
 * recoverability and recency — and never from how many signals repeat.
 */

const NOW = new Date('2026-10-15T00:00:00Z');
const daysAgo = (n) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

const action = (over = {}) => ({
  kind: 'recover_lost_citations',
  category: 'recover',
  impact: 'high',
  payload: {},
  ...over,
});
const signal = (over = {}) => ({
  kind: 'lost_citations',
  impact: 'high',
  source: ['ai_results'],
  detected_at: daysAgo(1),
  payload: {},
  ...over,
});
const demand = (entries) =>
  new Map(entries.map(([id, volume, intent]) => [id, { volume, intent }]));

describe('priorityLevel', () => {
  it('maps a score to the spec’s levels', () => {
    expect([100, 90, 89, 75, 74, 50, 49, 0].map(priorityLevel)).toEqual([
      'critical',
      'critical',
      'high',
      'high',
      'medium',
      'medium',
      'low',
      'low',
    ]);
  });
});

describe('scorePriority', () => {
  it('scores a recent loss on high-demand commercial prompts as critical', () => {
    const { score, level, reason } = scorePriority(
      {
        action: action({ payload: { targetEntity: 'prompts', targetCount: 7 } }),
        signals: [signal({ payload: { promptId: 'p1' } })],
        prompts: demand([['p1', 25_000, 'comparison']]),
      },
      NOW,
    );
    expect(score).toBeGreaterThanOrEqual(90);
    expect(level).toBe('critical');
    expect(reason).toMatchObject({
      change: 'lost',
      subject: { entity: 'prompts', count: 7 },
      demand: 'high',
      searches: 25_000,
      commercial: true,
      heldBefore: true,
      days: 1,
    });
  });

  /** The spec's fixture: quantity is not priority. */
  it('puts one high-demand commercial loss before forty-seven low-demand findings', () => {
    const tail = Array.from({ length: 47 }, (_, i) => [`t${i}`, 5, 'what-is']);
    const many = scorePriority(
      {
        action: action({ kind: 'create_content_for_demand', category: 'growth' }),
        signals: tail.map(([id]) =>
          signal({
            kind: 'uncovered_demand',
            payload: { entity: 'prompts', targets: [{ id, volume: 5 }] },
          }),
        ),
        prompts: demand(tail),
      },
      NOW,
    );
    const one = scorePriority(
      {
        action: action(),
        signals: [signal({ payload: { promptId: 'hot' } })],
        prompts: demand([['hot', 2000, 'comparison']]),
      },
      NOW,
    );
    expect(one.score).toBeGreaterThan(many.score);
  });

  it('counts the most demanded few targets, not all of them', () => {
    const fifty = Array.from({ length: 50 }, (_, i) => [`p${i}`, 100, 'other']);
    const five = Array.from({ length: 5 }, (_, i) => [`q${i}`, 1000, 'other']);
    const score = (list) =>
      scorePriority(
        {
          action: action({
            kind: 'expand_prompt_visibility',
            category: 'growth',
            impact: 'medium',
          }),
          signals: [
            signal({
              kind: 'prompt_visibility_gap',
              payload: { entity: 'prompts', targets: list.map(([id]) => ({ id })) },
            }),
          ],
          prompts: demand(list),
        },
        NOW,
      ).reason.factors.demand;
    expect(score(five)).toBeGreaterThan(score(fifty));
  });

  /** Impact is one factor of seven, not the whole answer. */
  it('can put a medium-impact loss on high demand before a high-impact gap nobody searches', () => {
    const loss = scorePriority(
      {
        action: action({ impact: 'medium' }),
        signals: [signal({ impact: 'medium', payload: { promptId: 'hot' } })],
        prompts: demand([['hot', 5000, 'best-top']]),
      },
      NOW,
    );
    const gap = scorePriority(
      {
        action: action({ kind: 'close_competitor_gap', category: 'compete' }),
        signals: [
          signal({
            kind: 'competitor_leads',
            payload: { promptId: 'cold' },
            detected_at: daysAgo(20),
          }),
        ],
        prompts: demand([['cold', 0, 'other']]),
      },
      NOW,
    );
    expect(loss.score).toBeGreaterThan(gap.score);
  });

  it('weighs independent kinds and sources, not repeats of one signal', () => {
    const once = scorePriority({ action: action(), signals: [signal()] }, NOW);
    const repeated = scorePriority(
      { action: action(), signals: Array.from({ length: 30 }, () => signal()) },
      NOW,
    );
    const confirmed = scorePriority(
      {
        action: action(),
        signals: [signal(), signal({ kind: 'lost_mentions', source: ['gsc'] })],
      },
      NOW,
    );
    expect(repeated.score).toBe(once.score);
    expect(confirmed.reason).toMatchObject({ kinds: 2, sources: 2 });
    expect(confirmed.score).toBeGreaterThan(once.score);
  });

  it('lets old evidence fade', () => {
    const fresh = scorePriority({ action: action(), signals: [signal()] }, NOW);
    const old = scorePriority(
      { action: action(), signals: [signal({ detected_at: daysAgo(30) })] },
      NOW,
    );
    expect(old.score).toBeLessThan(fresh.score);
    expect(old.reason.days).toBe(30);
  });

  it('ranks ground the brand held and lost above ground it never had', () => {
    const lost = scorePriority(
      {
        action: action({ impact: 'medium' }),
        signals: [signal({ kind: 'topic_drop', impact: 'medium' })],
      },
      NOW,
    ).reason;
    const never = scorePriority(
      {
        action: action({ category: 'growth', impact: 'medium' }),
        signals: [signal({ kind: 'topic_uncovered', impact: 'medium' })],
      },
      NOW,
    ).reason;
    expect(lost.heldBefore).toBe(true);
    expect(lost.factors.recoverability).toBeGreaterThan(never.factors.recoverability);
    expect(lost.factors.severity).toBeGreaterThan(never.factors.severity);
  });

  it('calls ground never held a gap, whatever its impact', () => {
    const { reason } = scorePriority(
      {
        action: action({ kind: 'create_content_for_demand', category: 'growth' }),
        signals: [signal({ kind: 'uncovered_demand' }), signal({ kind: 'competitor_leads' })],
      },
      NOW,
    );
    expect(reason).toMatchObject({ change: 'gap', heldBefore: false });
    expect(reason.factors.severity).toBe(0.5);
  });

  it("does not read an owned page's citations as its visits", () => {
    const { reason } = scorePriority(
      {
        action: action({ kind: 'recover_page_citations' }),
        signals: [
          signal({
            kind: 'owned_page_citation_lost',
            payload: { entity: 'pages', targets: [{ id: '/pricing', before: 6, now: 0 }] },
          }),
        ],
      },
      NOW,
    );
    expect(reason.demand).toBeNull();
  });

  it('weighs an action whose findings all resolved as having nothing open', () => {
    const { reason } = scorePriority({ action: action(), signals: [] }, NOW);
    expect(reason.change).toBeNull();
    expect(reason.factors.severity).toBe(0.3);
  });

  it('does not call unmeasured demand low', () => {
    const { reason } = scorePriority({ action: action(), signals: [signal()] }, NOW);
    expect(reason.demand).toBeNull();
    expect(reason.searches).toBeNull();
  });

  it('reads demand from search impressions and page sessions too', () => {
    const queries = scorePriority(
      {
        action: action({ kind: 'recover_search_demand', category: 'protect' }),
        signals: [
          signal({
            kind: 'gsc_decline',
            payload: { entity: 'queries', targets: [{ id: 'coffee', impressions: 4000 }] },
          }),
        ],
      },
      NOW,
    );
    const pages = scorePriority(
      {
        action: action({ kind: 'capture_ai_traffic', category: 'growth', impact: 'medium' }),
        signals: [
          signal({
            kind: 'page_opportunity',
            current_value: 900,
            payload: { landingPage: '/pricing', valueSignal: 'revenue' },
          }),
        ],
      },
      NOW,
    );
    expect(queries.reason.demand).toBe('high');
    expect(pages.reason).toMatchObject({ demand: 'high', commercial: true, change: 'opportunity' });
  });

  it('scores an action a person sent, from its own payload', () => {
    const improve = scorePriority(
      {
        action: action({
          kind: 'prompt_improve',
          category: 'compete',
          impact: 'medium',
          created_at: daysAgo(0),
          payload: {
            promptIds: ['p1'],
            platforms: [
              { id: 'gemini-web', state: 'not_mentioned' },
              { id: 'chatgpt-web', state: 'not_cited' },
            ],
          },
        }),
        prompts: demand([['p1', 300, 'recommendation']]),
      },
      NOW,
    );
    expect(improve.reason).toMatchObject({
      change: 'gap',
      subject: { entity: 'platforms', count: 2 },
      demand: 'medium',
      commercial: true,
      days: null,
    });
    const content = scorePriority(
      {
        action: action({
          kind: 'content_opportunity',
          category: 'growth',
          impact: 'high',
          created_at: daysAgo(0),
          payload: { promptIds: ['p1'], targetEntity: 'prompts', targetCount: 4 },
        }),
        prompts: demand([['p1', 300, 'how-to']]),
      },
      NOW,
    );
    expect(content.reason.subject).toEqual({ entity: 'prompts', count: 4 });
    expect(content.score).toBeGreaterThan(0);
    // A draft sent from the Content Editor's Start (CE-015) is the same work.
    const draft = scorePriority(
      {
        action: action({
          kind: 'content_draft',
          category: 'growth',
          impact: 'medium',
          created_at: daysAgo(0),
          payload: { promptIds: ['p1'], targetEntity: 'prompts', targetCount: 3 },
        }),
        prompts: demand([['p1', 300, 'how-to']]),
      },
      NOW,
    );
    expect(draft.reason).toMatchObject({ change: 'gap', subject: { entity: 'prompts', count: 3 } });
    expect(draft.score).toBeGreaterThan(0);
  });

  it('scores pages sent from AI Traffic on their list, sessions and value (AT-006)', () => {
    const sent = (reason, payload = {}) =>
      scorePriority(
        {
          action: action({
            kind: 'traffic_pages',
            category: reason === 'cited_not_clicked' ? 'fix' : 'growth',
            impact: 'medium',
            created_at: daysAgo(0),
            payload: {
              source: 'traffic_pages',
              reason,
              targetEntity: 'pages',
              targetCount: 2,
              targets: [
                { id: '/shop/beans', sessions: 240 },
                { id: '/guides/espresso', sessions: 0 },
              ],
              ...payload,
            },
          }),
        },
        NOW,
      );
    const cited = sent('cited_not_clicked');
    expect(cited.reason).toMatchObject({
      change: 'gap',
      subject: { entity: 'pages', count: 2 },
      // The pages' sessions are its demand.
      demand: expect.any(String),
    });
    expect(cited.reason.factors.severity).toBe(0.55);
    // Answers already cite it: more certain, and closer to done, than a page AI skips.
    const skipped = sent('no_ai_traffic');
    expect(skipped.reason.factors.severity).toBe(0.45);
    expect(cited.score).toBeGreaterThan(skipped.score);
    // Pages that make money are worth more.
    expect(sent('no_ai_traffic', { valueSignal: 'revenue' }).score).toBeGreaterThan(skipped.score);
    expect(sent('no_ai_traffic', { valueSignal: 'revenue' }).reason.commercial).toBe(true);
  });

  /** A page sent from a Site Audit report (learning D2): a fix on the site, near to hand. */
  it('scores a page sent from a Site Audit report as a site fix', () => {
    const sent = (checks) =>
      scorePriority(
        {
          action: action({
            kind: 'audit_page',
            category: 'fix',
            impact: 'medium',
            payload: { checks: Array.from({ length: checks }, (_, i) => ({ key: `c${i}` })) },
          }),
          signals: [],
        },
        NOW,
      );
    expect(sent(2).reason).toMatchObject({
      change: 'issue',
      subject: { entity: 'pages', count: 1 },
    });
    expect(sent(6).score).toBeGreaterThan(sent(2).score);
  });

  /** A finding sent from Chat (CHAT-09 §E): scored on creation like every person-sent action. */
  it('scores a finding sent from Chat by its category, on what it names', () => {
    const sent = (category) =>
      scorePriority(
        {
          action: action({
            kind: 'chat_finding',
            category,
            impact: 'medium',
            created_at: daysAgo(0),
            payload: { source: 'chat', targetEntity: 'prompts', targetCount: 2 },
          }),
          signals: [],
        },
        NOW,
      );
    expect(sent('recover').reason).toMatchObject({
      change: 'slipping',
      subject: { entity: 'prompts', count: 2 },
    });
    expect(sent('fix').reason.change).toBe('issue');
    expect(sent('growth').reason.change).toBe('gap');
    // Something slipping is more urgent than a gap.
    expect(sent('recover').score).toBeGreaterThan(sent('growth').score);
  });

  it('scores a live page linking products that no longer sell as a sure, quick fix (shopping path, part 7)', () => {
    const linked = scorePriority(
      {
        action: action({
          kind: 'shopping_links',
          category: 'fix',
          impact: 'medium',
          created_at: daysAgo(0),
          payload: { source: 'shopping_check', targetEntity: 'pages', targetCount: 1 },
        }),
      },
      NOW,
    );
    expect(linked.reason).toMatchObject({
      change: 'issue',
      subject: { entity: 'pages', count: 1 },
    });
    expect(linked.reason.factors).toMatchObject({ severity: 0.6, confidence: 0.9 });
  });

  it('stays within 0–100 and returns whole numbers', () => {
    for (const impact of ['high', 'medium', 'low', 'unknown']) {
      const { score } = scorePriority({ action: action({ impact }), signals: [] }, NOW);
      expect(Number.isInteger(score)).toBe(true);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    }
  });
});

describe('scorePriority with a measured demand level (PROMPT-014)', () => {
  const gap = (prompts) =>
    scorePriority(
      {
        action: action({
          kind: 'close_visibility_gap',
          category: 'growth',
          impact: 'medium',
          payload: { targetEntity: 'prompts', targetCount: 2 },
        }),
        signals: [signal({ kind: 'prompt_visibility_gap', payload: { promptIds: ['p1', 'p2'] } })],
        prompts,
      },
      NOW,
    );
  const withLevels = (p1, p2) =>
    new Map([
      ['p1', { volume: 40, intent: 'informational', level: p1 }],
      ['p2', { volume: 10, intent: 'informational', level: p2 }],
    ]);

  it('raises the score with High, a little with Medium, and leaves it with Low', () => {
    const none = gap(withLevels(null, null));
    const high = gap(withLevels('low', 'high'));
    const medium = gap(withLevels('medium', null));
    const low = gap(withLevels('low', 'low'));

    expect(high.score).toBeGreaterThan(medium.score);
    expect(medium.score).toBeGreaterThan(none.score);
    expect(low.score).toBe(none.score);
    // The demand factor is at least the level's.
    expect(high.reason.factors.demand).toBe(0.85);
    expect(medium.reason.factors.demand).toBe(0.55);
    expect(low.reason.factors.demand).toBe(none.reason.factors.demand);
  });

  it('says the highest level in "Why this priority?", and calls the demand high', () => {
    expect(gap(withLevels('low', 'high')).reason).toMatchObject({
      realDemand: 'high',
      demand: 'high',
    });
    // Low raises nothing, so it's no reason for the score.
    expect(gap(withLevels('low', 'low')).reason.realDemand).toBeNull();
    expect(gap(withLevels(null, null)).reason.realDemand).toBeNull();
  });

  it('never lowers a demand the volumes already put higher', () => {
    const busy = new Map([['p1', { volume: 25_000, intent: 'comparison', level: 'medium' }]]);
    const { reason } = gap(busy);
    expect(reason.factors.demand).toBe(1);
  });

  it('counts a level for a prompt with no volume analysis', () => {
    const { reason } = gap(new Map([['p2', { volume: null, intent: null, level: 'high' }]]));
    expect(reason).toMatchObject({ realDemand: 'high', demand: 'high', searches: null });
  });
});

/**
 * Past success (learning B4): a kind that has improved results at this
 * brand before sits a little higher, one that rarely has a little lower;
 * a couple of results barely move it, and none move nothing.
 */
describe('past success', () => {
  it('reads no history as the prior, moving nothing', () => {
    expect(pastSuccessOf(undefined)).toEqual({ rate: 0.5, points: 0, improved: 0, results: 0 });
  });

  it('pulls a few results toward the prior, and many less so', () => {
    expect(pastSuccessOf({ improved: 3, results: 3 }).points).toBeCloseTo(3.75);
    expect(pastSuccessOf({ improved: 0, results: 3 }).points).toBeCloseTo(-3.75);
    expect(pastSuccessOf({ improved: 10, results: 10 }).points).toBeCloseTo(6.67, 1);
    expect(pastSuccessOf({ improved: 1, results: 1 }).points).toBeLessThan(2);
  });

  it("moves the score by its kind's track here, and says so", () => {
    const signals = [signal()];
    const none = scorePriority({ action: action(), signals }, NOW);
    const worked = scorePriority(
      {
        action: action(),
        signals,
        track: new Map([['recover_lost_citations', { improved: 3, results: 3 }]]),
      },
      NOW,
    );
    const rarely = scorePriority(
      {
        action: action(),
        signals,
        track: new Map([['recover_lost_citations', { improved: 0, results: 3 }]]),
      },
      NOW,
    );

    expect(none.reason.pastSuccess).toBeNull();
    // No result behind it: no rate, rather than the prior read as one.
    expect(none.reason.factors).not.toHaveProperty('pastSuccess');
    expect(worked.reason.factors.pastSuccess).toBe(0.69);
    expect(worked.score).toBeGreaterThan(none.score);
    expect(rarely.score).toBeLessThan(none.score);
    expect(worked.reason.pastSuccess).toEqual({ improved: 3, results: 3, points: 3.75 });
  });

  it("reads only its own kind's track", () => {
    const signals = [signal()];
    const other = scorePriority(
      {
        action: action(),
        signals,
        track: new Map([['fix_low_scores', { improved: 0, results: 9 }]]),
      },
      NOW,
    );
    expect(other.score).toBe(scorePriority({ action: action(), signals }, NOW).score);
    expect(other.reason.pastSuccess).toBeNull();
  });

  it('adds to the measured demand level rather than replacing it', () => {
    const gap = (prompts, track) =>
      scorePriority(
        {
          action: action({
            kind: 'close_visibility_gap',
            category: 'growth',
            impact: 'medium',
            payload: { targetEntity: 'prompts', targetCount: 1 },
          }),
          signals: [signal({ kind: 'prompt_visibility_gap', payload: { promptIds: ['p1'] } })],
          prompts,
          track,
        },
        NOW,
      );
    const level = (l) => new Map([['p1', { volume: 40, intent: 'informational', level: l }]]);
    const track = new Map([['close_visibility_gap', { improved: 3, results: 3 }]]);

    const neither = gap(level(null), new Map());
    const demand = gap(level('high'), new Map());
    const both = gap(level('high'), track);

    expect(demand.score).toBeGreaterThan(neither.score);
    expect(both.score).toBeGreaterThan(demand.score);
    expect(both.reason).toMatchObject({
      realDemand: 'high',
      pastSuccess: { improved: 3, results: 3, points: 3.75 },
    });
    expect(both.reason.factors.demand).toBe(0.85);
  });
});

describe('promptIdsOf', () => {
  it('finds the prompts payloads name, once each', () => {
    expect(
      promptIdsOf([
        { promptId: 'a' },
        { promptIds: ['a', 'b'] },
        { entity: 'prompts', targets: [{ id: 'c' }] },
        { targetEntity: 'prompts', targets: [{ id: 'd' }] },
        { entity: 'pages', targets: [{ id: '/pricing' }] },
        null,
      ]),
    ).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('priorityColumns', () => {
  it('names the columns the score is stored in', () => {
    expect(
      priorityColumns({ score: 94, level: 'critical', reason: { change: 'lost' } }, NOW),
    ).toEqual({
      priority_score: 94,
      priority_level: 'critical',
      priority_reason: { change: 'lost' },
      priority_updated_at: NOW.toISOString(),
    });
  });
});
