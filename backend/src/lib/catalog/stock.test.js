import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IN_STOCK, isInStock, stockKey } from './stock.js';

/** A catalog variant's stock, one way everywhere (shopping path). */

describe('isInStock', () => {
  it('reads a feed\'s or a store\'s spelling of "in stock", whatever its case, spaces or hyphens', () => {
    for (const value of [
      'in_stock',
      'In Stock',
      'IN_STOCK',
      'instock',
      'available',
      'limited_availability',
      'Limited-Availability',
    ]) {
      expect(isInStock(value)).toBe(true);
    }
    for (const value of ['out_of_stock', 'out of stock', 'preorder', 'backorder', '', null]) {
      expect(isInStock(value)).toBe(false);
    }
    expect(stockKey('Limited Availability')).toBe('limited_availability');
  });

  it("is the editor's feed match's list and catalog_category_counts' (00350), read the same way", () => {
    const read = (path) => readFileSync(new URL(`../../../../${path}`, import.meta.url), 'utf8');
    const words = (list) => [...list.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    const web = read('frontend/src/lib/content/feedMatch.ts');
    const sql = read('supabase/migrations/00350_catalog_category_pages.sql');
    expect(words(web.match(/return \[([^\]]*)\]\.includes\(a\)/)[1])).toEqual(IN_STOCK);
    expect(words(sql.match(/'_', 'g'\)\)\s+in \(([^)]*)\)/)[1])).toEqual(IN_STOCK);
    // Lowercased, spaces and hyphens as "_", on all three sides.
    expect(web).toMatch(/toLowerCase\(\)\.replace\(\/\[\\s-\]\+\/g, '_'\)/);
    expect(sql).toMatch(/lower\(regexp_replace\(v\.availability, '\[\\s-\]\+', '_', 'g'\)\)/);
    expect(
      readFileSync(new URL('./stock.js', import.meta.url), 'utf8').replace(/\s+/g, ''),
    ).toContain(".toLowerCase().replace(/[\\s-]+/g,'_')");
  });
});
