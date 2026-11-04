/**
 * Deleting a brand and everything under it.
 *
 * The web used to delete the brand row directly, as the signed-in user. The
 * cascade reaches every answer the brand received and every citation row and
 * shopping card under them, and on a brand of any size it outran the
 * authenticated role's 8-second statement timeout: the delete was cancelled
 * and the brand stayed. Here the answers go first, in batches that each fit
 * comfortably in a statement, and the brand row — with what little is left
 * under it — last.
 */

import supabaseAdmin from '../config/supabase.js';
import { logger } from './logger.js';

/** Answers deleted per statement, with their citation rows and shopping cards. */
export const RESULT_BATCH = 2000;

/** Brands being deleted right now, so a second click does not start a second run. */
const inProgress = new Map();

/**
 * Deletes in batches until `deleteBatch` reports none left.
 * @param {() => Promise<number>} deleteBatch - deletes one batch, returns how many it deleted
 * @returns {Promise<number>} total deleted
 */
export async function drainInBatches(deleteBatch) {
  let total = 0;
  for (;;) {
    const deleted = await deleteBatch();
    total += deleted;
    if (deleted === 0) return total;
  }
}

async function run(brandId) {
  const started = Date.now();
  const results = await drainInBatches(async () => {
    const { data, error } = await supabaseAdmin.rpc('delete_brand_results_batch', {
      p_brand_id: brandId,
      p_limit: RESULT_BATCH,
    });
    if (error) throw new Error(error.message);
    return Number(data) || 0;
  });

  const { error } = await supabaseAdmin.from('brands').delete().eq('id', brandId);
  if (error) throw new Error(error.message);

  logger.info({ brandId, results, ms: Date.now() - started }, '[brands] deleted');
}

/**
 * Starts deleting a brand, or returns the run already in progress for it.
 * @returns {Promise<void>}
 */
export function deleteBrand(brandId) {
  if (!inProgress.has(brandId)) {
    const job = run(brandId)
      .catch((err) => {
        logger.error({ err, brandId }, '[brands] delete failed');
        throw err;
      })
      .finally(() => inProgress.delete(brandId));
    inProgress.set(brandId, job);
  }
  return inProgress.get(brandId);
}
