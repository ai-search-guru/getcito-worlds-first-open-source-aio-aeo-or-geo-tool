/**
 * Catalog-fed suggestion candidates (ECOM-003).
 *
 * Shopping questions start from what the brand sells: its catalog's
 * categories (00278), each with how many live products it has and their
 * price band, so the model can ask what a shopper asks an assistant before
 * buying there ("best hiking backpacks under $150"). The categories are
 * counted in the database (catalog_suggestion_categories, 00371), which
 * returns only those offered, however big the catalog. Everything up to the
 * LLM handoff is deterministic. Any failure returns [] so the base
 * suggestion flow never degrades; a brand without a catalog gets no rows.
 */

import supabaseAdmin from '../config/supabase.js';
import { logger } from './logger.js';

/** Categories offered to the model at most, those with the most products first. */
export const MAX_CANDIDATES = 8;
/** A category with fewer live products than this isn't offered. */
export const MIN_PRODUCTS = 2;

/** A price rounded up to one a shopper would name: 40, 150, 2,500. */
export function roundPrice(value) {
  if (!(value > 0)) return null;
  const scale = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10]) {
    if (step * scale >= value) return Math.round(step * scale * 100) / 100;
  }
  return 10 * scale;
}

/**
 * The database's categories as candidates, in its order: each one's live
 * products and, when its priced products share a currency, their lowest
 * and highest price and the round price most of them sell under (the 75th
 * percentile, rounded up).
 *
 * @param {{ category: string, products: number, price_low: number|string|null, price_high: number|string|null, price_p75: number|string|null, currency: string|null }[]} rows
 */
export function catalogCandidates(rows) {
  return rows.slice(0, MAX_CANDIDATES).map((row) => {
    const under = roundPrice(Number(row.price_p75));
    const band = Boolean(row.currency) && under !== null;
    return {
      category: row.category,
      products: Number(row.products),
      priceLow: band ? Number(row.price_low) : null,
      priceHigh: band ? Number(row.price_high) : null,
      priceUnder: band ? under : null,
      currency: band ? row.currency : null,
    };
  });
}

/**
 * The brand's catalog categories as shopping-question candidates; [] for a
 * brand without a catalog, or when it can't be read.
 */
export async function getCatalogSuggestionCandidates(brandId, { db = supabaseAdmin } = {}) {
  try {
    const { data, error } = await db.rpc('catalog_suggestion_categories', {
      p_brand_id: brandId,
      p_limit: MAX_CANDIDATES,
      p_min_products: MIN_PRODUCTS,
    });
    if (error) throw new Error(error.message);
    return catalogCandidates(data ?? []);
  } catch (err) {
    logger.error({ err, brandId }, '[catalog-suggestions] candidate read failed');
    return [];
  }
}
