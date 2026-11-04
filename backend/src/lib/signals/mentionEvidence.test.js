import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The evidence of an uncited-mentions signal (AC-001): per prompt, the
 * platforms, the brand's position, the sentiment, and a quote of the newest
 * answer around the mention.
 */

let tables = {};
let reads = [];
let failResponses = false;

function builder(table) {
  let columns = '';
  const chain = {
    select: (cols) => {
      columns = cols;
      return chain;
    },
    eq: () => chain,
    neq: () => chain,
    gt: () => chain,
    gte: () => chain,
    order: () => chain,
    limit: () => chain,
    range: () => chain,
    in: (column, values) => {
      reads.push({ table, column, values, columns });
      return chain;
    },
    maybeSingle: async () => ({ data: tables[table]?.[0] ?? null, error: null }),
    then: (resolve) => {
      const rows = tables[table] ?? [];
      if (table === 'prompt_results' && columns.includes('response')) {
        resolve(
          failResponses
            ? { data: null, error: { message: 'timeout' } }
            : { data: tables.responses, error: null },
        );
        return;
      }
      resolve({ data: rows, error: null });
    },
  };
  return chain;
}

vi.mock('../../config/supabase.js', () => ({ default: { from: (t) => builder(t) } }));

const { mentionEvidence, summarizeMentions } = await import('./mentionEvidence.js');

const answer = (over) => ({
  id: 'r1',
  prompt_id: 'p1',
  platform: 'chatgpt-web',
  mention_position: 2,
  sentiment: 'neutral',
  created_at: '2026-10-14T05:00:00Z',
  ...over,
});

describe('summarizeMentions', () => {
  it('gives the platforms, the median position and the most common sentiment', () => {
    expect(
      summarizeMentions([
        answer({ platform: 'gemini-web', mention_position: 1, sentiment: 'positive' }),
        answer({ mention_position: 3, sentiment: 'positive' }),
        answer({ mention_position: null, sentiment: 'neutral' }),
      ]),
    ).toEqual({
      platforms: ['chatgpt-web', 'gemini-web'],
      answers: 3,
      position: 2,
      sentiment: 'positive',
    });
  });

  it('calls a tie neutral rather than picking a side', () => {
    expect(
      summarizeMentions([answer({ sentiment: 'positive' }), answer({ sentiment: 'negative' })])
        .sentiment,
    ).toBe('neutral');
  });
});

describe('mentionEvidence', () => {
  beforeEach(() => {
    reads = [];
    failResponses = false;
    tables = {
      brands: [{ name: 'Acme Coffee' }],
      brand_domains: [{ domain: 'acme-coffee.example.com' }],
      prompts: [
        { id: 'p1', text: 'Best coffee subscription?' },
        { id: 'p2', text: 'Coffee gifts' },
      ],
      prompt_results: [
        answer({ id: 'r3', created_at: '2026-10-14T05:00:00Z' }),
        answer({ id: 'r2', platform: 'gemini-web', created_at: '2026-10-13T05:00:00Z' }),
        answer({ id: 'r9', prompt_id: 'p2', mention_position: 1 }),
      ],
      responses: [
        { id: 'r3', response: 'For offices, **Acme Coffee** ships beans weekly.' },
        { id: 'r9', response: 'Try [acme-coffee.example.com](https://acme-coffee.example.com).' },
      ],
    };
  });

  it("describes each prompt in the signal's order and quotes its newest answer", async () => {
    const evidence = await mentionEvidence('b1', ['p1', 'p2', 'p3'], {
      now: new Date('2026-10-15T00:00:00Z'),
      windowDays: 7,
    });
    expect(evidence).toEqual([
      {
        promptId: 'p1',
        promptText: 'Best coffee subscription?',
        platforms: ['chatgpt-web', 'gemini-web'],
        answers: 2,
        position: 2,
        sentiment: 'neutral',
        excerpt: 'For offices, Acme Coffee ships beans weekly.',
        excerptPlatform: 'chatgpt-web',
        excerptAt: '2026-10-14T05:00:00Z',
      },
      {
        promptId: 'p2',
        promptText: 'Coffee gifts',
        platforms: ['chatgpt-web'],
        answers: 1,
        position: 1,
        sentiment: 'neutral',
        excerpt: 'Try acme-coffee.example.com.',
        excerptPlatform: 'chatgpt-web',
        excerptAt: '2026-10-14T05:00:00Z',
      },
    ]);
    // Only the newest answers' text is read back, a few per prompt.
    expect(reads.find((r) => r.columns.includes('response'))?.values).toEqual(['r3', 'r2', 'r9']);
  });

  it('quotes an older answer when the newest does not name the brand', async () => {
    tables.responses = [
      { id: 'r3', response: 'A list with no brand in it.' },
      { id: 'r2', response: 'Acme Coffee ships weekly.' },
    ];
    const [first] = await mentionEvidence('b1', ['p1'], {
      now: new Date('2026-10-15T00:00:00Z'),
      windowDays: 7,
    });
    expect(first).toMatchObject({
      excerpt: 'Acme Coffee ships weekly.',
      excerptPlatform: 'gemini-web',
      excerptAt: '2026-10-13T05:00:00Z',
    });
  });

  it("keeps the summary when the answers' text cannot be read", async () => {
    failResponses = true;
    const [first] = await mentionEvidence('b1', ['p1'], {
      now: new Date('2026-10-15T00:00:00Z'),
      windowDays: 7,
    });
    expect(first).toMatchObject({
      platforms: ['chatgpt-web', 'gemini-web'],
      answers: 2,
      excerpt: null,
      excerptPlatform: null,
    });
  });

  it('reads nothing for a signal without prompts', async () => {
    expect(await mentionEvidence('b1', [], { now: new Date(), windowDays: 7 })).toEqual([]);
    expect(reads).toEqual([]);
  });
});
