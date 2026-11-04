import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A draft's Site Audit estimate (customer priorities item 9): the page's
 * checks as run on the draft, the site's from its latest audit, the AI
 * checks only when they were read.
 */

let reads;
let rows;
vi.mock('../../config/supabase.js', () => ({
  default: {
    from: (table) => {
      const op = { table, filters: [] };
      reads.push(op);
      const chain = {
        select: () => chain,
        eq: (col, v) => (op.filters.push([col, v]), chain),
        in: (col, v) => (op.filters.push([col, v]), chain),
        order: () => chain,
        limit: () => chain,
        maybeSingle: async () => ({ data: rows[table] ?? null, error: null }),
        then: (resolve) => resolve({ data: rows[table] ?? [], error: null }),
      };
      return chain;
    },
  },
}));

const { SITE_SIGNALS, draftEstimate, readSiteSignals } = await import('./draftEstimate.js');
const { LLM_SIGNAL_KEYS } = await import('./llmSignals.js');
const { auditContextOf } = await import('./context.js');
const { runSignals } = await import('./engine.js');

beforeEach(() => {
  reads = [];
  rows = {};
});

const pass = (key) => ({ key, status: 'pass', score: 1 });
const fail = (key) => ({ key, status: 'fail', score: 0 });

describe('draftEstimate', () => {
  it('scores the page’s own checks, takes the site’s from its audit, and leaves the AI’s out unread', () => {
    const page = [pass('h1-quality'), pass('https'), fail('lists')];
    const estimate = draftEstimate({ page, site: [fail('https')] });
    // The draft's own https is never the site's: its audit's is.
    expect(estimate.checks).toEqual({ page: 2, site: 1, ai: 0 });
    expect(estimate.categories.structure).toBe(50);
    expect(estimate.categories.trust).toBe(0);
    expect(estimate.categories.content).toBeNull();
    expect(Number.isInteger(estimate.score)).toBe(true);
  });

  it('leaves the site’s checks out without an audit, and counts the AI’s once read', () => {
    const estimate = draftEstimate({
      page: [pass('h1-quality'), pass('https')],
      site: [],
      ai: [pass('direct-answer'), { key: 'definitions', status: 'na', score: null }],
    });
    expect(estimate.checks).toEqual({ page: 1, site: 0, ai: 1 });
    expect(estimate.categories.trust).toBeNull();
    expect(estimate.categories.content).toBe(100);
  });

  it('keeps only real AI checks and site checks from what it is given', () => {
    const estimate = draftEstimate({
      page: [pass('h1-quality')],
      site: [pass('h1-quality')],
      ai: [pass('h1-quality')],
    });
    expect(estimate.checks).toEqual({ page: 1, site: 0, ai: 0 });
  });

  it('reads a real draft: the page’s checks run, the site’s left to its audit', async () => {
    const ctx = auditContextOf({
      url: 'https://acme.example/',
      statusCode: 200,
      html: '<!doctype html><html><head><title>Cold brew</title></head><body><h1>Cold brew at home</h1><p>Cold brew is coffee steeped in cold water for 12 to 18 hours.</p><h2>What you need</h2><ul><li>Coffee</li><li>Water</li></ul></body></html>',
      robotsTxt: null,
      llmsTxt: null,
    });
    const page = await runSignals(ctx);
    const estimate = draftEstimate({ page, site: [] });
    // The page's own 21, less those that don't apply to it (no video, no JSON-LD).
    expect(estimate.checks.page).toBeGreaterThan(10);
    expect(estimate.checks.page).toBeLessThanOrEqual(34 - SITE_SIGNALS.size);
    expect(estimate.score).toBeGreaterThan(0);
    expect(estimate.score).toBeLessThan(100);
  });

  it('names 13 site checks and no AI check among them', () => {
    expect(SITE_SIGNALS.size).toBe(13);
    expect(LLM_SIGNAL_KEYS.some((key) => SITE_SIGNALS.has(key))).toBe(false);
  });
});

describe('readSiteSignals', () => {
  it('reads the site’s checks from the brand’s latest completed audit', async () => {
    rows = {
      site_audits: { id: 'a9' },
      audit_signal_results: [
        { signal_key: 'https', status: 'pass', score: '1' },
        { signal_key: 'canonical', status: 'na', score: null },
      ],
    };
    expect(await readSiteSignals('b1')).toEqual([
      { key: 'https', status: 'pass', score: 1 },
      { key: 'canonical', status: 'na', score: null },
    ]);
    expect(reads[0].filters).toEqual([
      ['brand_id', 'b1'],
      ['status', 'completed'],
    ]);
    expect(reads[1].filters).toEqual([
      ['audit_id', 'a9'],
      ['signal_key', [...SITE_SIGNALS]],
    ]);
  });

  it('reads none for a brand with no audit', async () => {
    expect(await readSiteSignals('b1')).toEqual([]);
    expect(reads).toHaveLength(1);
  });
});
