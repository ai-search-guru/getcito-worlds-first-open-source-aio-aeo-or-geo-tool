import { describe, expect, it, vi } from 'vitest';

// The module imports the supabase admin client, whose config hard-exits when
// SUPABASE_* env is absent (as in CI) — stub it before the import chain.
vi.mock('../config/supabase.js', () => ({ default: {} }));

import {
  aggregateByPage,
  aiPlatformsByPage,
  composeGaCandidates,
  extractPageSummary,
  summaryText,
  toAbsoluteUrl,
} from './gaSuggestions.js';

/**
 * Analytics-fed suggestion candidates (#705).
 *
 * The deterministic half: which pages become candidates, why, and what the
 * model is told about them. Getting this wrong produces suggestions that look
 * plausible and are grounded in nothing — the failure mode a customer notices
 * once and never trusts again.
 */

describe('aggregateByPage', () => {
  it('sums the per-day rows of one page', () => {
    const rows = [
      { landing_page: '/a', sessions: 3, key_events: 1 },
      { landing_page: '/a', sessions: 4, key_events: 0 },
      { landing_page: '/b', sessions: 2, key_events: 5 },
    ];
    expect(aggregateByPage(rows, ['sessions', 'key_events'])).toEqual([
      { landing_page: '/a', sessions: 7, key_events: 1 },
      { landing_page: '/b', sessions: 2, key_events: 5 },
    ]);
  });

  it('drops transactional pages before they can rank', () => {
    const rows = [
      { landing_page: '/checkout', sessions: 900 },
      { landing_page: '/guides', sessions: 4 },
    ];
    expect(aggregateByPage(rows, ['sessions'])).toEqual([{ landing_page: '/guides', sessions: 4 }]);
  });
});

describe('aiPlatformsByPage', () => {
  it('lists the platforms per page, busiest first', () => {
    const rows = [
      { landing_page: '/a', platform: 'chatgpt.com', sessions: 4 },
      { landing_page: '/a', platform: 'claude.ai', sessions: 9 },
      { landing_page: '/a', platform: 'chatgpt.com', sessions: 6 },
    ];
    expect(aiPlatformsByPage(rows).get('/a')).toEqual(['chatgpt.com', 'claude.ai']);
  });

  it('ignores rows whose source could not be classified', () => {
    const rows = [{ landing_page: '/a', platform: null, sessions: 4 }];
    expect(aiPlatformsByPage(rows).get('/a')).toBeUndefined();
  });
});

describe('composeGaCandidates', () => {
  const pageRows = [
    {
      landing_page: '/money',
      sessions: 100,
      key_events: 9,
      transactions: 9,
      purchase_revenue: 900,
    },
    { landing_page: '/small', sessions: 40, key_events: 2, transactions: 2, purchase_revenue: 200 },
    { landing_page: '/quiet', sessions: 60, key_events: 0, transactions: 0, purchase_revenue: 0 },
    {
      landing_page: '/checkout',
      sessions: 80,
      key_events: 50,
      transactions: 50,
      purchase_revenue: 9999,
    },
  ];
  const aiRows = [
    { landing_page: '/quiet', platform: 'chatgpt.com', sessions: 30 },
    { landing_page: '/tiny', platform: 'claude.ai', sessions: 1 },
  ];

  it('raises both a revenue blind spot and an AI momentum page', () => {
    const out = composeGaCandidates({ pageRows, aiRows });
    const kinds = out.map((c) => c.kind);
    expect(kinds).toContain('revenue_blind_spot');
    expect(kinds).toContain('ai_momentum');
  });

  it('interleaves the two signals so neither can crowd the other out', () => {
    // Concatenating would let a shop with real revenue fill every slot and
    // leave no room for what AI engines are already sending traffic to.
    const out = composeGaCandidates({ pageRows, aiRows, limit: 2 });
    expect(out.map((c) => c.kind)).toEqual(['revenue_blind_spot', 'ai_momentum']);
  });

  it('never surfaces a transactional page however much revenue it carries', () => {
    const out = composeGaCandidates({ pageRows, aiRows });
    expect(out.map((c) => c.landingPage)).not.toContain('/checkout');
  });

  it('ranks a page with conversions but no revenue, so properties without ecommerce still produce candidates', () => {
    const noEcommerce = [
      { landing_page: '/demo', sessions: 50, key_events: 12, transactions: 0, purchase_revenue: 0 },
    ];
    const [candidate] = composeGaCandidates({ pageRows: noEcommerce, aiRows: [] });
    expect(candidate.landingPage).toBe('/demo');
    expect(candidate.revenue).toBe(0);
    expect(candidate.keyEvents).toBe(12);
  });

  it('carries the AI evidence onto a revenue candidate and vice versa', () => {
    const out = composeGaCandidates({ pageRows, aiRows });
    const quiet = out.find((c) => c.landingPage === '/quiet');
    expect(quiet.aiSessions).toBe(30);
    expect(quiet.aiPlatforms).toEqual(['chatgpt.com']);
    expect(quiet.sessions).toBe(60);
  });

  it('skips pages with too little behind them to argue from', () => {
    const out = composeGaCandidates({ pageRows, aiRows });
    expect(out.map((c) => c.landingPage)).not.toContain('/tiny');
  });

  it('keeps a dismissed page from resurfacing', () => {
    const out = composeGaCandidates({
      pageRows,
      aiRows,
      excludedPages: new Set(['/money']),
    });
    expect(out.map((c) => c.landingPage)).not.toContain('/money');
  });

  it('lists a page once even when both signals raise it', () => {
    const out = composeGaCandidates({
      pageRows: [
        {
          landing_page: '/both',
          sessions: 50,
          key_events: 5,
          transactions: 5,
          purchase_revenue: 500,
        },
      ],
      aiRows: [{ landing_page: '/both', platform: 'chatgpt.com', sessions: 20 }],
    });
    expect(out).toHaveLength(1);
  });
});

describe('toAbsoluteUrl', () => {
  it('joins a bare domain and a path', () => {
    expect(toAbsoluteUrl('example.com', '/pricing')).toBe('https://example.com/pricing');
  });

  it('tolerates a stored scheme or trailing slash', () => {
    expect(toAbsoluteUrl('https://example.com/', '/a')).toBe('https://example.com/a');
  });

  it('returns null without a domain, since there is nothing to read', () => {
    expect(toAbsoluteUrl('', '/a')).toBeNull();
  });
});

describe('extractPageSummary', () => {
  const html = `
    <html><head>
      <title>Noise-cancelling headphones | Shop</title>
      <meta name="description" content="Over-ear headphones for travel and commuting." />
    </head><body>
      <h1>ANS-2400 Pro Black</h1>
      <h2>Battery life</h2><h3>Comfort</h3>
    </body></html>`;

  it('reads what the page says it is about', () => {
    const summary = extractPageSummary(html);
    expect(summary.title).toBe('Noise-cancelling headphones | Shop');
    expect(summary.description).toBe('Over-ear headphones for travel and commuting.');
    expect(summary.h1).toBe('ANS-2400 Pro Black');
    expect(summary.headings).toEqual(['Battery life', 'Comfort']);
  });

  it('gives the model the category words, not just the model number', () => {
    // The whole point of reading the page: "ANS-2400 Pro Black" is an SKU
    // nobody asks an AI about; the answerable question lives in the title and
    // description around it.
    expect(summaryText(extractPageSummary(html))).toContain('Noise-cancelling headphones');
  });

  it('survives empty or unparseable markup', () => {
    expect(summaryText(extractPageSummary(''))).toBe('');
    expect(extractPageSummary('<html>').title).toBeNull();
  });
});
