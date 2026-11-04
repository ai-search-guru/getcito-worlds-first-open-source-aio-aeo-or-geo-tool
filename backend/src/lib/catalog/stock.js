/**
 * A catalog variant's stock, read one way everywhere: as the editor's feed
 * match reads it (frontend/src/lib/content/feedMatch.ts, variantStock) and as
 * catalog_category_counts (00350) counts it. Feeds and stores spell it many
 * ways ("in stock", "IN_STOCK", "limited-availability"), so it is read
 * lowercased, with spaces and hyphens as "_". stock.test.js checks the three
 * lists stay the same.
 */

/** The availabilities that are in stock, as `stockKey` spells them. */
export const IN_STOCK = ['in_stock', 'instock', 'available', 'limited_availability'];

/** A variant's availability lowercased, spaces and hyphens as "_": "In Stock" → "in_stock". */
export function stockKey(availability) {
  return String(availability ?? '')
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

/** Whether a variant's availability is in stock. */
export function isInStock(availability) {
  return IN_STOCK.includes(stockKey(availability));
}
