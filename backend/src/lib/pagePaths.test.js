import { describe, expect, it } from 'vitest';

import { isExcludedPath } from './pagePaths.js';

/**
 * Page scope (#705, #719).
 *
 * Shared by the suggestion generator and the detection engine, so a mistake
 * here is a mistake in two places at once — and both failure directions are
 * costly: excluding too much deletes real content silently, excluding too
 * little fills the customer's list with pages nobody will act on.
 */

describe('isExcludedPath', () => {
  it('excludes transactional pages', () => {
    // A GA4 purchase fires on the confirmation page, so without this the
    // top-revenue "page" in most shops is the checkout.
    for (const path of [
      '/checkout',
      '/cart/',
      '/en/order-confirmation',
      '/thank-you',
      '/account/orders',
      '/login',
    ]) {
      expect(isExcludedPath(path), path).toBe(true);
    }
  });

  it('excludes pages whose AI visibility cannot move the business', () => {
    // These take real traffic and rank on engagement, so they surface unless
    // excluded — but nobody acts on "your job posting is invisible to AI".
    for (const path of ['/career/visual-designer', '/careers', '/jobs/backend', '/privacy']) {
      expect(isExcludedPath(path), path).toBe(true);
    }
  });

  it('matches whole segments, never substrings', () => {
    // The dangerous direction: a substring check would delete real content
    // and nobody would notice it had gone.
    expect(isExcludedPath('/cartography-guides')).toBe(false);
    expect(isExcludedPath('/blog/career-advice-for-analysts')).toBe(false);
    expect(isExcludedPath('/blog/accountability-in-ai')).toBe(false);
    expect(isExcludedPath('/products/searchlight-3000')).toBe(false);
  });

  it('excludes GA placeholders and blanks, which are not pages', () => {
    expect(isExcludedPath('')).toBe(true);
    expect(isExcludedPath('(not set)')).toBe(true);
    expect(isExcludedPath(undefined)).toBe(true);
  });

  it('keeps ordinary content, category and marketing pages', () => {
    for (const path of ['/', '/pricing', '/compare', '/features/insights', '/blog/a-guide']) {
      expect(isExcludedPath(path), path).toBe(false);
    }
  });

  it('ignores a query string when deciding', () => {
    expect(isExcludedPath('/checkout?step=2')).toBe(true);
    expect(isExcludedPath('/pricing?ref=ai')).toBe(false);
  });
});
