import { isInStock, stockKey } from './stock.js';

/**
 * The price a catalog product is shown and linked with, read one way
 * everywhere (#1607 follow-up): the path's offer (shoppingPath.js
 * offerOf), the agent's grid and what it's told (shoppingBlocks.js,
 * shoppingLinks.js), and the editor's card (frontend/src/lib/content/
 * shoppingPath.ts, the same rule): keep them alike.
 */

/** An amount above 0, or null: a price of 0 is none given. */
const positive = (value) =>
  value != null && Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null;

/**
 * A price as a card reads it: the sale price when it's under the price, or
 * when there's no price; else the price; null without either.
 */
export function priceAmount({ price, salePrice }) {
  const regular = positive(price);
  const sale = positive(salePrice);
  if (regular == null) return sale;
  return sale != null && sale < regular ? sale : regular;
}

/** In stock before low stock (limited availability): the better stock, the lower. */
function inStockRank(availability) {
  return stockKey(availability) === 'limited_availability' ? 1 : 0;
}

/**
 * The variant in stock a product is shown with: the best stock, then the
 * lowest price at it, one with no price last; null with none in stock.
 * Variants as catalog_variants rows: `availability`, `price`, `sale_price`.
 */
export function bestInStock(variants) {
  const amount = (v) => priceAmount({ price: v.price, salePrice: v.sale_price }) ?? Infinity;
  return (
    variants
      .filter((v) => isInStock(v.availability))
      .sort(
        (a, b) =>
          inStockRank(a.availability) - inStockRank(b.availability) || amount(a) - amount(b),
      )[0] ?? null
  );
}
