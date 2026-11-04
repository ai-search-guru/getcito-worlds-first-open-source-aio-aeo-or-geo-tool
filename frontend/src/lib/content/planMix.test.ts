import { describe, expect, it } from 'vitest';
import { pageTypeMix, type CitedAddress } from './planMix';

/**
 * "What AI cites in your topics" (CE-014): the share of AI citations by page
 * type against the brand's own pages' mix, each of the citations whose type
 * is known, and what share of all citations that is.
 */

const cited = (url: string, citations: number, over: Partial<CitedAddress> = {}): CitedAddress => ({
  url,
  title: null,
  own: false,
  citations,
  ...over,
});

describe('pageTypeMix', () => {
  it('sets AI’s mix by page type against the brand’s own pages’ mix, gaps flagged', () => {
    const { rows, covered } = pageTypeMix(
      [
        cited('https://rival.example/compare/acme-vs-rival', 30),
        cited('https://review.example/compare/crm', 10),
        cited('https://acme.example/vs/hubspot', 5, { own: true }),
        cited('https://acme.example/features/forecasting', 25, { own: true }),
        cited('https://acme.example/features/email-sync/', 5, { own: true }),
        cited('https://acme.example/pricing', 25, { own: true }),
        // No type in the address or title: not in the whole.
        cited('https://www.reddit.com/r/sales/comments/x', 40),
      ],
      'b2b',
      // The tail beyond the list: 60 more citations.
      200,
    );
    // AI: comparison 40, features 30, pricing 25 of 100 typed. The brand's
    // own: comparison 5, features 30, pricing 25 of 60 (8%, 50%, 42%).
    expect(rows).toEqual([
      { pageType: 'comparison', aiShare: 45, yourShare: 8, pages: 1, gap: true },
      { pageType: 'feature_page', aiShare: 30, yourShare: 50, pages: 2, gap: false },
      { pageType: 'pricing', aiShare: 25, yourShare: 42, pages: 1, gap: false },
    ]);
    // 100 typed of the period's 200.
    expect(covered).toBe(50);
  });

  it('reads another site’s /p/ or /products/ address by its title, not as a product page', () => {
    const { rows } = pageTypeMix(
      [
        cited('https://writer.substack.com/p/my-coffee-notes', 10),
        cited('https://blog.google/products/search/ai-mode', 10, { title: 'The best of AI Mode' }),
        cited('https://shop.example/products/beans', 5, { own: true }),
      ],
      'ecommerce',
      25,
    );
    expect(rows.map((r) => [r.pageType, r.aiShare])).toEqual([
      ['best_of', 67],
      ['product_page', 33],
    ]);
  });

  it('reads a type from the title when the address has none, for the site’s own types', () => {
    const { rows, covered } = pageTypeMix(
      [
        cited('https://blog.example/x/123', 4, { title: 'The 10 best coffee subscriptions' }),
        cited('https://shop.example/products/beans', 6, { own: true }),
      ],
      'ecommerce',
      10,
    );
    expect(rows).toEqual([
      { pageType: 'product_page', aiShare: 60, yourShare: 100, pages: 1, gap: false },
      { pageType: 'best_of', aiShare: 40, yourShare: 0, pages: 0, gap: true },
    ]);
    expect(covered).toBe(100);
  });

  it('has nothing to show without a cited page of a known type', () => {
    expect(pageTypeMix([], 'ecommerce', 0)).toEqual({ rows: [], covered: 0 });
    expect(pageTypeMix([cited('https://en.wikipedia.org/wiki/Coffee', 9)], 'ecommerce', 9)).toEqual(
      { rows: [], covered: 0 },
    );
  });
});
