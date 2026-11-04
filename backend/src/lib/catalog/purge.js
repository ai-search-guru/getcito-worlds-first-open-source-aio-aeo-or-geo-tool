import supabaseAdmin from '../../config/supabase.js';
import { chunkIds } from '../chunkedIn.js';
import { logger } from '../logger.js';

/**
 * A product gone from its source is marked removed by the sync (sync.js,
 * `removed_at`) and kept REMOVED_KEEP_DAYS, so one that comes back within
 * them is live again with the same id. The daily run deletes older ones
 * here, so the catalog doesn't grow with every product a shop ever sold.
 *
 * - Their variants, images and category links go with them (on delete
 *   cascade, 00278).
 * - Merchant Center's item issues (00296) aren't theirs: they're keyed by
 *   source and item id, replaced by each sync of the source and deleted with
 *   it. An item Merchant Center still lists keeps its issues even when the
 *   catalog can't keep the item, so they aren't deleted here.
 * - A draft's shopping path (00351) keeps product ids in jsonb. A deleted
 *   product reads as a removed one, gone from the catalog: the path's build
 *   (shoppingPath.js keptProducts) and the editor's check (the web's
 *   getShoppingCheck) both say `gone` for an id with no row.
 */

/** How long a removed product is kept. */
export const REMOVED_KEEP_DAYS = 90;
/** Products read per batch. */
export const PURGE_BATCH = 500;
/** Products deleted per daily run at most; the rest waits a day. */
export const MAX_PURGED = 10_000;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Deletes the products removed over REMOVED_KEEP_DAYS ago, PURGE_BATCH at a
 * time and MAX_PURGED a run at most, and says how many it deleted. Each
 * delete asks again that the product is still removed, so one a sync brought
 * back meanwhile stays. Never throws: a failure is logged and the rest waits
 * a day.
 *
 * @param {{ db?: object, now?: Date }} [options]
 * @returns {Promise<number>}
 */
export async function purgeRemovedCatalogProducts({ db = supabaseAdmin, now = new Date() } = {}) {
  const before = new Date(now.getTime() - REMOVED_KEEP_DAYS * DAY_MS).toISOString();
  let purged = 0;
  try {
    while (purged < MAX_PURGED) {
      const size = Math.min(PURGE_BATCH, MAX_PURGED - purged);
      const { data, error } = await db
        .from('catalog_products')
        .select('id')
        .lt('removed_at', before)
        .limit(size);
      if (error) throw new Error(`catalog_products read: ${error.message}`);
      const ids = (data ?? []).map((row) => row.id);
      let batch = 0;
      // A delete's ids go in its address: IN_FILTER_CHUNK at a time.
      for (const chunk of chunkIds(ids)) {
        const { data: deleted, error: failed } = await db
          .from('catalog_products')
          .delete()
          .in('id', chunk)
          .lt('removed_at', before)
          .select('id');
        if (failed) throw new Error(`catalog_products delete: ${failed.message}`);
        batch += deleted?.length ?? 0;
      }
      purged += batch;
      if (ids.length < size || batch === 0) break;
    }
  } catch (err) {
    logger.warn(
      { err: { name: err?.name, message: err?.message }, purged },
      '[catalog] removed products purge failed; the rest goes tomorrow',
    );
    return purged;
  }
  if (purged >= MAX_PURGED) {
    logger.warn(
      { purged },
      '[catalog] removed products purge stopped early; the rest goes tomorrow',
    );
  } else {
    logger.info({ purged }, '[catalog] removed products purged');
  }
  return purged;
}
