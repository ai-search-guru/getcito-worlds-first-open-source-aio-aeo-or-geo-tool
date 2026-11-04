import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

const tables = {};
vi.mock('../../config/supabase.js', () => ({
  default: { from: (table) => tables[table]() },
}));

const {
  BASKET_KPIS,
  CONTROL_MIN_COUNT,
  SENTIMENT_MIN_ANSWERS,
  basketScope,
  basketValues,
  controlScope,
  netEffect,
  pageScope,
} = await import('./basketMetrics.js');

/** A query builder that resolves to `result` however it is chained. */
function chain(result) {
  const b = {
    select: () => b,
    eq: () => b,
    in: () => b,
    lt: () => b,
    order: () => b,
    limit: () => Promise.resolve(result),
    maybeSingle: () => Promise.resolve(result),
    then: (resolve) => resolve(result),
  };
  return b;
}

/** `chain`, recording each filter it is given as [method, ...args] in `calls`. */
function recordingChain(result, calls) {
  const b = chain(result);
  for (const method of ['eq', 'in', 'lt']) {
    b[method] = (...args) => {
      calls.push([method, ...args]);
      return b;
    };
  }
  return b;
}

describe('pageScope', () => {
  it('turns page URLs into citation keys, hosts and GA paths', () => {
    expect(
      pageScope([
        'https://www.Example.com/Blog/Post/?utm=x#top',
        'https://docs.example.com/',
        'not a url',
      ]),
    ).toEqual({
      keys: ['example.com/blog/post', 'docs.example.com'],
      domains: ['example.com', 'docs.example.com'],
      paths: ['/Blog/Post', '/'],
    });
  });
});

describe('basketValues', () => {
  const raw = {
    cells: 40,
    visible: 10,
    mention_answers: 12,
    competitor_visible_total: 30,
    top_competitor_visible: 20,
    page_citations: 7,
    ga_connected: true,
    page_ai_sessions: 55,
    named_answers: 16,
    positive_answers: 7,
  };

  it('measures the basket', () => {
    expect(basketValues(raw, { pageCount: 2 })).toEqual({
      ai_visibility: 25,
      share_of_voice: 25,
      // 25% against the strongest competitor's 50%.
      competitor_lead: -25,
      mentions: 12,
      citations: 7,
      ai_referral_traffic: 55,
      // 7 of the 16 answers naming the brand were positive (learning D1).
      positive_sentiment: 43.8,
    });
  });

  it('reads no sentiment while the window isn’t counted, or no answer named the brand', () => {
    expect(basketValues({ ...raw, named_answers: null }, { pageCount: 1 }).positive_sentiment).toBe(
      null,
    );
    expect(basketValues({ ...raw, named_answers: 0 }, { pageCount: 1 }).positive_sentiment).toBe(
      null,
    );
  });

  it('reads no sentiment from fewer than five answers naming the brand', () => {
    expect(SENTIMENT_MIN_ANSWERS).toBe(5);
    // 3 of 4 is 75%, but one answer turning either way would move it 25 points.
    expect(
      basketValues({ ...raw, named_answers: 4, positive_answers: 3 }, { pageCount: 1 })
        .positive_sentiment,
    ).toBe(null);
    expect(
      basketValues({ ...raw, named_answers: 5, positive_answers: 3 }, { pageCount: 1 })
        .positive_sentiment,
    ).toBe(60);
  });

  /** As Insights' Positive Sentiment card (00191): an answer only citing the brand is always neutral. */
  it('reads sentiment over the answers naming the brand, never those only citing it', () => {
    // 16 answers named or cited it, 10 named it, 4 of those positive: 40%, not 25%.
    expect(
      basketValues(
        { ...raw, mentioning_answers: 16, named_answers: 10, positive_answers: 4 },
        { pageCount: 1 },
      ).positive_sentiment,
    ).toBe(40);
    // A window of cited-only answers has no sentiment to read.
    expect(
      basketValues(
        { ...raw, mentioning_answers: 16, named_answers: 0, positive_answers: 0 },
        { pageCount: 1 },
      ).positive_sentiment,
    ).toBe(null);
  });

  it('is fed the rollup’s answers naming the brand by 00373, not those naming or citing it', () => {
    const sql = readFileSync(
      new URL(
        '../../../../supabase/migrations/00373_basket_positive_sentiment.sql',
        import.meta.url,
      ),
      'utf8',
    );
    expect(sql).toMatch(/coalesce\(sum\(d\.mention_answers\), 0\) as named_answers/);
    expect(sql).toMatch(/'named_answers', \(select case when unfilled = 0 then named_answers end/);
    // Unfilled by the column it divides by.
    expect(sql).toMatch(/filter \(where d\.mention_answers is null or d\.positive_count is null\)/);
    expect(sql).not.toMatch(/sum\((d\.)?mentioning_answers\)/);
  });

  it('leaves unanswerable metrics unmeasured instead of zero', () => {
    const none = basketValues(
      { ...raw, cells: 0, visible: 0, competitor_visible_total: 0, named_answers: 0 },
      {
        pageCount: 0,
      },
    );
    expect(Object.values(none).every((v) => v === null)).toBe(true);
    expect(
      basketValues({ ...raw, ga_connected: false }, { pageCount: 2 }).ai_referral_traffic,
    ).toBe(null);
  });

  it('covers every basket KPI', () => {
    expect(Object.keys(basketValues(raw, { pageCount: 1 })).sort()).toEqual(
      Object.keys(BASKET_KPIS).sort(),
    );
  });
});

describe('basketScope', () => {
  it('measures the pages an action names and those its drafts went live at, each once', async () => {
    expect(
      (
        await basketScope({
          payload: {
            pages: ['https://www.acme.example/a/'],
            publishedPages: { d1: 'https://acme.example/a', d2: 'https://acme.example/new' },
          },
        })
      ).pages,
    ).toEqual(['https://www.acme.example/a/', 'https://acme.example/new']);
  });

  it('uses the prompt ids the action was sent with', async () => {
    expect(await basketScope({ payload: { promptIds: ['p1'], pages: ['u'] } })).toEqual({
      promptIds: ['p1'],
      pages: ['u'],
    });
  });

  it("falls back to the opportunity's clusters, then to its own prompt", async () => {
    tables.content_opportunities = () =>
      chain({ data: { cluster_id: 'c1', related_cluster_ids: [], prompt_id: 'p9' } });
    tables.prompt_cluster_members = () =>
      chain({ data: [{ prompt_id: 'p1' }, { prompt_id: 'p2' }], error: null });
    expect((await basketScope({ payload: { opportunityId: 'o1' } })).promptIds).toEqual([
      'p1',
      'p2',
    ]);

    tables.content_opportunities = () =>
      chain({ data: { cluster_id: null, related_cluster_ids: [], prompt_id: 'p9' } });
    expect((await basketScope({ payload: { opportunityId: 'o1' } })).promptIds).toEqual(['p9']);
  });

  it('takes the prompts a topic has now when none were tracked when it was sent', async () => {
    tables.prompts = () => chain({ data: [{ id: 'p3' }, { id: 'p4' }], error: null });
    expect(
      (await basketScope({ brand_id: 'b1', payload: { topicId: 't1', promptIds: [] } })).promptIds,
    ).toEqual(['p3', 'p4']);
    // Prompt ids it was sent with are kept, so the basket doesn't move.
    expect(
      (await basketScope({ brand_id: 'b1', payload: { topicId: 't1', promptIds: ['p1'] } }))
        .promptIds,
    ).toEqual(['p1']);
  });
});

/**
 * The control basket (learning B2): the brand's prompts the action didn't
 * touch, and its change net of theirs.
 */
describe('netEffect', () => {
  const metric = (name, unit, before, after) => ({ metric: name, unit, before, after });

  it('takes a rate in points and a count in percent, net of the control', () => {
    expect(
      netEffect(
        [
          metric('ai_visibility', 'percent', 20, 30),
          metric('mentions', 'count', 10, 15),
          metric('citations', 'count', 4, 8),
        ],
        {
          before: { ai_visibility: 40, mentions: 200, citations: null },
          after: { ai_visibility: 44, mentions: 220, citations: null },
        },
      ),
    ).toEqual([
      { metric: 'ai_visibility', net: 6, unit: 'points', control: { before: 40, after: 44 } },
      { metric: 'mentions', net: 40, unit: 'percent', control: { before: 200, after: 220 } },
    ]);
  });

  it('leaves out a count with nothing before to scale by', () => {
    expect(
      netEffect([metric('mentions', 'count', 0, 3)], {
        before: { mentions: 10 },
        after: { mentions: 12 },
      }),
    ).toEqual([]);
  });

  it('never nets AI sessions: a control of prompts has no pages to read them on', () => {
    expect(
      netEffect([metric('ai_referral_traffic', 'sessions', 40, 80)], {
        before: { ai_referral_traffic: 100 },
        after: { ai_referral_traffic: 100 },
      }),
    ).toEqual([]);
  });

  it('leaves out a count read from fewer than five before: one more is a swing, not a result', () => {
    const control = { before: { mentions: 100 }, after: { mentions: 100 } };
    expect(CONTROL_MIN_COUNT).toBe(5);
    // 4 → 6 would read +50% net.
    expect(netEffect([metric('mentions', 'count', 4, 6)], control)).toEqual([]);
    expect(netEffect([metric('mentions', 'count', 5, 6)], control)).toEqual([
      { metric: 'mentions', net: 20, unit: 'percent', control: { before: 100, after: 100 } },
    ]);
  });
});

describe('controlScope', () => {
  /** The first day of the week before the action was raised. */
  const SINCE = '2026-09-01';
  const others = (n, topic = 't1') =>
    Array.from({ length: n }, (_, i) => ({ id: `c${i + 1}`, topic_id: topic }));

  it("takes the brand's other prompts in the action's topics, never its own", async () => {
    tables.prompts = () =>
      chain({ data: [{ id: 'p1', topic_id: 't1' }, ...others(6)], error: null });
    const scope = await controlScope('b1', ['p1'], SINCE);
    expect(scope).toEqual({
      basis: 'topics',
      promptIds: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'],
      pages: [],
    });
  });

  it("falls back to the brand's other prompts, and reads none from too few", async () => {
    let call = 0;
    // Its topic has two others; the brand has six.
    tables.prompts = () =>
      chain({
        data: call++ < 2 ? [{ id: 'p1', topic_id: 't1' }, ...others(2)] : others(6, 't9'),
        error: null,
      });
    expect((await controlScope('b1', ['p1'], SINCE)).basis).toBe('brand');

    tables.prompts = () => chain({ data: others(3), error: null });
    expect(await controlScope('b1', ['p1'], SINCE)).toBeNull();
    expect(await controlScope('b1', [], SINCE)).toBeNull();
  });

  it('leaves out prompts tracked after the week before began: they read in the week after alone', async () => {
    const calls = [];
    tables.prompts = () =>
      recordingChain({ data: [{ id: 'p1', topic_id: 't1' }, ...others(6)], error: null }, calls);
    await controlScope('b1', ['p1'], SINCE);
    expect(calls).toContainEqual(['lt', 'created_at', '2026-09-01T00:00:00Z']);
  });

  it("reads only the brand's own active prompts, in its topics and when it falls back", async () => {
    // Each query's filters; its topic has two others, so it falls back to the brand.
    const queries = [];
    tables.prompts = () => {
      const calls = [];
      queries.push(calls);
      return recordingChain(
        {
          data: queries.length < 3 ? [{ id: 'p1', topic_id: 't1' }, ...others(2)] : others(6),
          error: null,
        },
        calls,
      );
    };
    expect((await controlScope('b1', ['p1'], SINCE)).basis).toBe('brand');

    // The first query reads its own prompts' topics; the others, the control.
    const [targets, inTopics, inBrand] = queries;
    expect(targets).toEqual([['in', 'id', ['p1']]]);
    for (const calls of [inTopics, inBrand]) {
      expect(calls).toContainEqual(['eq', 'prompt_sets.brand_id', 'b1']);
      expect(calls).toContainEqual(['eq', 'is_active', true]);
    }
    expect(inTopics).toContainEqual(['in', 'topic_id', ['t1']]);
    expect(inBrand.some(([method]) => method === 'in')).toBe(false);
  });
});
