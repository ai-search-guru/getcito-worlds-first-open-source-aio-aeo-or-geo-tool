import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A lost citation's evidence (AC-001): the brand's page that was cited and
 * when, the platforms it was lost on, who is cited now, and its cited days
 * before and after. These pin the summary on the answers and that only the
 * answers that matter have their citations read back.
 */

const reads = [];
let tables = {};

function builder(table) {
  let columns = '';
  const chain = {
    select: (cols) => {
      columns = cols;
      return chain;
    },
    eq: () => chain,
    neq: () => chain,
    gte: () => chain,
    order: () => chain,
    range: () => chain,
    in: (column, values) => {
      if (column === 'id') reads.push(values);
      chain.filter = { column, values };
      return chain;
    },
    then: (resolve) => {
      let data = tables[table] ?? [];
      if (table === 'prompt_results' && columns.includes('citations') && chain.filter) {
        data = data.filter((r) => chain.filter.values.includes(r.id));
      }
      resolve({ data, error: null });
    },
  };
  return chain;
}

vi.mock('../../config/supabase.js', () => ({ default: { from: (t) => builder(t) } }));

const { lostCitationEvidence, summarizeLostCitation } = await import('./lostCitationEvidence.js');
const { ownDomainMatcher } = await import('../responseParser.js');

const isOwn = ownDomainMatcher(['coffee.example']);
const cite = (url) => ({ url });

// Five result days: cited on chatgpt-web until Oct 10 and on gemini-web on
// Oct 9, then three quiet days where others are cited.
const answers = [
  {
    id: 'r1',
    platform: 'chatgpt-web',
    region: 'US',
    created_at: '2026-10-09T05:00:00Z',
    citation_count: 1,
    citations: null,
  },
  {
    id: 'r2',
    platform: 'gemini-web',
    region: 'US',
    created_at: '2026-10-09T05:00:00Z',
    citation_count: 1,
    citations: [cite('https://other.example/a'), cite('https://www.coffee.example/guide')],
  },
  {
    id: 'r3',
    platform: 'chatgpt-web',
    region: 'GB',
    created_at: '2026-10-10T05:00:00Z',
    citation_count: 1,
    citations: [cite('https://coffee.example/guide')],
  },
  {
    id: 'r4',
    platform: 'chatgpt-web',
    region: 'US',
    created_at: '2026-10-11T05:00:00Z',
    citation_count: 0,
    citations: [cite('https://rival.example/best'), cite('https://g2.example/list')],
  },
  {
    id: 'r5',
    platform: 'gemini-web',
    region: 'US',
    created_at: '2026-10-12T05:00:00Z',
    citation_count: 0,
    citations: [cite('https://g2.example/list'), cite('https://rival.example/best')],
  },
  {
    id: 'r6',
    platform: 'chatgpt-web',
    region: 'US',
    created_at: '2026-10-13T05:00:00Z',
    citation_count: 0,
    citations: [cite('https://rival.example/best')],
  },
];

describe('summarizeLostCitation', () => {
  it('names the lost page, where it was lost, who is cited now and the cited days', () => {
    expect(summarizeLostCitation(answers, isOwn, 3)).toEqual({
      platforms: ['chatgpt-web', 'gemini-web'],
      regions: ['GB', 'US'],
      citedDays: 2,
      days: 2,
      quietDays: 3,
      // The same page with and without www is one page, cited on both.
      lostUrls: [
        {
          url: 'https://coffee.example/guide',
          position: 1,
          lastCitedAt: '2026-10-10T05:00:00Z',
          platforms: ['chatgpt-web', 'gemini-web'],
        },
      ],
      citedNow: [
        {
          url: 'https://rival.example/best',
          domain: 'rival.example',
          answers: 3,
          answersRead: 3,
          position: 1,
        },
        {
          url: 'https://g2.example/list',
          domain: 'g2.example',
          answers: 2,
          answersRead: 3,
          position: 1,
        },
      ],
    });
  });

  it('lists nothing it did not read back', () => {
    const unread = answers.map((a) => ({ ...a, citations: null }));
    const summary = summarizeLostCitation(unread, isOwn, 3);
    expect(summary.lostUrls).toEqual([]);
    expect(summary.citedNow).toEqual([]);
    expect(summary.citedDays).toBe(2);
  });
});

describe('lostCitationEvidence', () => {
  beforeEach(() => {
    reads.length = 0;
    tables = {
      prompt_results: answers.map((a) => ({ ...a, prompt_id: 'p1' })),
      brand_domains: [{ domain: 'coffee.example' }],
    };
  });

  it('reads back only the latest cited answer and the newest quiet ones per platform', async () => {
    const evidence = await lostCitationEvidence('b1', ['p1'], {
      now: new Date('2026-10-13T12:00:00Z'),
      windowDays: 14,
      quietDays: 3,
    });
    // r1 is an older cited answer on chatgpt-web, so its citations are not read.
    expect(reads.flat().sort()).toEqual(['r2', 'r3', 'r4', 'r5', 'r6']);
    expect(evidence.get('p1')).toMatchObject({
      platforms: ['chatgpt-web', 'gemini-web'],
      lostUrls: [{ url: 'https://coffee.example/guide' }],
    });
  });

  it('reads nothing when no prompt lost its citations', async () => {
    const evidence = await lostCitationEvidence('b1', [], {
      now: new Date(),
      windowDays: 14,
      quietDays: 3,
    });
    expect(evidence.size).toBe(0);
    expect(reads).toEqual([]);
  });
});
