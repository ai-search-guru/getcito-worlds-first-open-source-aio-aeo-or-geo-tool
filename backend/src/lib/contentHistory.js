/**
 * Content Editor version history (CE-018, 00215): a draft's earlier versions
 * are kept 90 days. The daily run deletes older ones here; the editor's
 * History leaves them out until then.
 */
import supabaseAdmin from '../config/supabase.js';
import { logger } from './logger.js';

/** How long a draft's version is kept. */
export const VERSION_RETENTION_DAYS = 90;
/** Versions deleted per call: each holds a whole page, up to 500 KB. */
export const VERSION_PRUNE_BATCH = 200;
/** Calls per daily run at most; the rest waits a day. */
export const MAX_VERSION_PRUNE_CALLS = 100;

/**
 * The daily prune of versions past their 90 days, VERSION_PRUNE_BATCH a call
 * (00215 content_draft_versions_prune), so no one DELETE runs into the
 * statement timeout. Stops when a call deletes fewer than a batch.
 */
export async function pruneContentVersions(now = Date.now()) {
  const before = new Date(now - VERSION_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  for (let call = 0; call < MAX_VERSION_PRUNE_CALLS; call++) {
    const { data, error } = await supabaseAdmin.rpc('content_draft_versions_prune', {
      p_before: before,
      p_limit: VERSION_PRUNE_BATCH,
    });
    if (error) {
      logger.warn({ err: error }, '[content-history] prune failed');
      return;
    }
    if ((data ?? 0) < VERSION_PRUNE_BATCH) return;
  }
  logger.warn(
    { calls: MAX_VERSION_PRUNE_CALLS },
    '[content-history] prune stopped early; the rest goes tomorrow',
  );
}
