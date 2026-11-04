import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A competitor signal's evidence (AC-001): per prompt and platform, the
 * competitor's position against the brand's, and the sources cited in the
 * answers the competitor wins.
 */

let rpcCalls = [];
let tables = {};
/** Each table's reads, as the calls made on them. */
let reads = {};

function builder(table) {
  const calls = [];
  (reads[table] ??= []).push(calls);
  const call =
    (name) =>
    (...args) => {
      calls.push([name, ...args]);
      return chain;
    };
  const chain = {
    select: call('select'),
    eq: call('eq'),
    neq: call('neq'),
    in: call('in'),
    gte: call('gte'),
    order: call('order'),
    limit: call('limit'),
    then: (resolve) => resolve({ data: tables[table] ?? [], error: null }),
  };
  return chain;
}

vi.mock('../../config/supabase.js', () => ({
  default: {
    from: (table) => builder(table),
    rpc: async (name, params) => {
      rpcCalls.push({ name, params });
      return { data: tables.positions ?? [], error: null };
    },
  },
}));

const { competitorEvidence, pageEventsOf, winningSources } =
  await import('./competitorEvidence.js');
const { ownDomainMatcher } = await import('../responseParser.js');

const isOwn = ownDomainMatcher(['coffee.example']);
const answer = (competitorMentions, brandMentions, urls) => ({
  mention_count: brandMentions,
  competitor_mentions: Object.entries(competitorMentions).map(([id, count]) => ({
    competitor_id: id,
    mention_count: count,
  })),
  citations: urls.map((url) => ({ url })),
});

describe('winningSources', () => {
  it('counts the domains cited where the competitor is named and the brand is not', () => {
    const answers = [
      answer({ c1: 1 }, 0, [
        'https://g2.example/a',
        'https://rival.example/x',
        'https://g2.example/b',
      ]),
      answer({ c1: 2 }, 0, ['https://g2.example/c', 'https://coffee.example/own']),
      // The brand is named here too: not a win for the competitor.
      answer({ c1: 1 }, 1, ['https://reddit.example/r']),
      // Another competitor's win.
      answer({ c2: 1 }, 0, ['https://reddit.example/r']),
    ];
    expect(winningSources(answers, 'c1', isOwn)).toEqual([
      { domain: 'g2.example', answers: 2, answersRead: 2 },
      { domain: 'rival.example', answers: 1, answersRead: 2 },
    ]);
  });
});

describe('competitorEvidence', () => {
  beforeEach(() => {
    rpcCalls = [];
    reads = {};
    tables = {
      positions: [
        {
          competitor_id: 'c1',
          prompt_id: 'p1',
          platform: 'chatgpt-web',
          competitor_now: 1,
          competitor_before: 3,
          brand_now: 3,
          brand_before: 2,
        },
      ],
      prompts: [{ id: 'p1', text: 'Best AI rank tracker?' }],
      brand_domains: [{ domain: 'coffee.example' }],
      prompt_results: [answer({ c1: 1 }, 0, ['https://g2.example/a'])],
      competitor_page_events: [
        {
          kind: 'changed',
          at: '2026-10-12T03:00:00Z',
          url: 'https://rival.example/pricing',
          domain: 'rival.example',
          detail: { similarity: 0.71, gained: [{ key: 'faq', label: 'FAQ section' }], lost: [] },
        },
      ],
    };
  });

  it("reads the week's positions against last week's and names each prompt", async () => {
    const evidence = await competitorEvidence('b1', ['c1'], {
      now: new Date('2026-10-15T12:00:00Z'),
      windowDays: 7,
    });
    expect(rpcCalls).toEqual([
      {
        name: 'ae_competitor_positions',
        params: {
          p_brand_id: 'b1',
          p_competitor_ids: ['c1'],
          p_cur_from: '2026-10-09',
          p_cur_to: '2026-10-15',
          p_prev_from: '2026-10-02',
          p_prev_to: '2026-10-08',
          p_limit: 5,
        },
      },
    ]);
    expect(evidence.get('c1')).toEqual({
      positions: [
        {
          promptId: 'p1',
          promptText: 'Best AI rank tracker?',
          platform: 'chatgpt-web',
          competitor: { now: 1, before: 3 },
          you: { now: 3, before: 2 },
        },
      ],
      winningSources: [{ domain: 'g2.example', answers: 1, answersRead: 1 }],
      pageEvents: [
        {
          kind: 'changed',
          at: '2026-10-12T03:00:00Z',
          url: 'https://rival.example/pricing',
          domain: 'rival.example',
          detail: { gained: [{ key: 'faq', label: 'FAQ section' }], lost: [] },
        },
      ],
      pageEventDays: 28,
    });
  });

  it("reads each competitor's five newest page events of the last four weeks", async () => {
    await competitorEvidence('b1', ['c1'], {
      now: new Date('2026-10-15T12:00:00Z'),
      windowDays: 7,
    });
    expect(reads.competitor_page_events).toEqual([
      [
        ['select', 'kind, at, url, domain, detail'],
        ['eq', 'brand_id', 'b1'],
        ['eq', 'competitor_id', 'c1'],
        ['gte', 'at', '2026-09-17T12:00:00.000Z'],
        ['order', 'at', { ascending: false }],
        ['limit', 5],
      ],
    ]);
  });

  it('reads nothing when no competitor signal needs it', async () => {
    expect((await competitorEvidence('b1', [], { now: new Date(), windowDays: 7 })).size).toBe(0);
    expect(rpcCalls).toEqual([]);
  });
});

describe('pageEventsOf', () => {
  it("keeps a first citation's answers and a change's checks, nothing else", () => {
    expect(
      pageEventsOf([
        {
          kind: 'first_cited',
          at: '2026-10-01T00:00:00Z',
          url: 'https://rival.example/guide',
          domain: 'rival.example',
          detail: { answers: 3 },
        },
        { kind: 'changed', at: '2026-10-08T00:00:00Z', url: 'u', domain: 'd', detail: null },
      ]),
    ).toEqual([
      {
        kind: 'first_cited',
        at: '2026-10-01T00:00:00Z',
        url: 'https://rival.example/guide',
        domain: 'rival.example',
        detail: { answers: 3 },
      },
      {
        kind: 'changed',
        at: '2026-10-08T00:00:00Z',
        url: 'u',
        domain: 'd',
        detail: { gained: [], lost: [] },
      },
    ]);
    expect(pageEventsOf(null)).toEqual([]);
  });
});
