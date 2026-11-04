import supabaseAdmin from '../../config/supabase.js';
import { logger } from '../logger.js';
import { clearDemoData } from './index.js';

/**
 * A demo brand nobody opened for a while doesn't keep its sample data
 * (00380): every organization gets one, so the rows would pile up for
 * workspaces that left. A visit rebuilds the demo every few days
 * (DEMO_MAX_AGE_MS), so one built over IDLE_DAYS ago wasn't opened since.
 * The daily run clears its data the way a rebuild does (clearDemoData, in
 * the modules' reverse order, so rows go before the rows they point to)
 * and keeps the brand row with no version and no build time: the next
 * visit builds it again in place, with the same deterministic ids, so
 * links to it still work.
 *
 * A clear holds the brand as a build does (demo_version null, demo_built_at
 * now), so a visit at the same moment waits for it instead of reading half
 * the data, then rebuilds.
 */

/** A demo brand built longer ago than this is cleared. */
export const IDLE_DAYS = 14;
/** Demo brands cleared per daily run at most; the rest waits a day. */
export const MAX_CLEARED = 200;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Takes the brand for the clear, only if its row is still as read: a visit
 * that started a build meanwhile keeps it.
 */
async function claim(db, brand, now) {
  let query = db
    .from('brands')
    .update({ demo_version: null, demo_built_at: now.toISOString() })
    .eq('id', brand.id)
    .eq('is_demo', true)
    .eq('demo_built_at', brand.demo_built_at);
  query =
    brand.demo_version === null || brand.demo_version === undefined
      ? query.is('demo_version', null)
      : query.eq('demo_version', brand.demo_version);
  const { data, error } = await query.select('id');
  if (error) throw new Error(`demo brand claim: ${error.message}`);
  return (data ?? []).length > 0;
}

/** Leaves the brand with no build time: the next visit rebuilds it at once. */
async function release(db, brandId, now) {
  const { error } = await db
    .from('brands')
    .update({ demo_built_at: null })
    .eq('id', brandId)
    .is('demo_version', null)
    .eq('demo_built_at', now.toISOString());
  // The build lease runs out on its own; the next visit rebuilds then.
  if (error) logger.warn({ brandId, err: error }, '[demo] cleared brand not released');
}

/**
 * Clears the data of the demo brands built over IDLE_DAYS ago, MAX_CLEARED
 * a run at most, and says how many it cleared. Never throws: a failure is
 * logged.
 *
 * @param {{ db?: object, now?: Date, clear?: (brandId: string) => Promise<void> }} [options]
 * @returns {Promise<number>}
 */
export async function sweepIdleDemoBrands({
  db = supabaseAdmin,
  now = new Date(),
  clear = clearDemoData,
} = {}) {
  const cutoff = new Date(now.getTime() - IDLE_DAYS * DAY_MS).toISOString();
  const { data: brands, error } = await db
    .from('brands')
    .select('id, demo_version, demo_built_at')
    .eq('is_demo', true)
    .lt('demo_built_at', cutoff)
    .order('demo_built_at', { ascending: true })
    .limit(MAX_CLEARED);
  if (error) {
    logger.error({ err: error }, '[demo] idle demo brands not read');
    return 0;
  }

  let cleared = 0;
  for (const brand of brands ?? []) {
    try {
      if (!(await claim(db, brand, now))) continue;
      await clear(brand.id);
      await release(db, brand.id, now);
      cleared++;
    } catch (err) {
      // Held as a build that failed: a visit rebuilds it once the lease is
      // up, and the sweep clears it again IDLE_DAYS on.
      logger.error({ err, brandId: brand.id }, '[demo] idle demo brand not cleared');
    }
  }
  if (cleared > 0) logger.info({ cleared }, '[demo] idle demo brands cleared');
  return cleared;
}
