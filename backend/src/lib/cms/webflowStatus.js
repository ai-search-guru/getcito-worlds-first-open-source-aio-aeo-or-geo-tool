import supabaseAdmin from '../../config/supabase.js';
import { isSubscriptionActive } from '../../config/plans.js';
import { logger } from '../logger.js';
import { isWebflowConfigured } from '../composio.js';
import { markDeliveryPublished } from '../contentPublished.js';
import { WebflowError, getItem, listCollections, listSites } from './webflow.js';

/**
 * Pages sent to Webflow, published there since (Send to CMS #1331, phase
 * 2): nothing calls back when a Webflow item goes live, so GetCito reads
 * the items its sends made, and marks one published at the page's address
 * on the site (its host, the collection's slug and the item's: the
 * collection page Webflow makes) once Webflow published it after the send.
 * An item published before (a live page sent again) waits for its next
 * publish. An item deleted in Webflow closes its send. Read when the
 * Library opens (a brand's newest sends, throttled by its route) and once a
 * day for all.
 */

/** Items the Library's check reads: the newest sends. The daily sweep reads the rest. */
export const ITEMS_ON_DEMAND = 10;
/** Items the daily sweep reads a brand. */
export const ITEMS_DAILY = 100;
/** Sends older than this aren't read again: a draft left that long stays one. */
const LOOK_BACK_MS = 60 * 24 * 60 * 60 * 1000;
/** Item reads that fail in a row before a check stops: Webflow or Composio is down. */
const FAILURES_IN_A_ROW = 3;
/** Connections the daily sweep reads, shuffled so a deadline doesn't leave the same brands out. */
const SWEEP_CONNECTIONS = 1000;
const SWEEP_DEADLINE_MS = 10 * 60 * 1000;

const none = { checked: 0, published: [] };

/** The token was refused while reading: Settings asks for a new one. */
async function markRefused(connection) {
  const { error } = await supabaseAdmin
    .from('brand_cms_connections')
    .update({ status: 'auth_failed', updated_at: new Date().toISOString() })
    .eq('brand_id', connection.brand_id)
    .eq('provider', 'webflow')
    .eq('composio_account_id', connection.composio_account_id);
  if (error) logger.warn({ err: error }, '[webflow-status] refusal not kept');
}

/**
 * A send whose item Webflow says is gone: closed. The page's next send
 * tries the item again (lastItem), and makes a new one if it is gone.
 */
async function closeRemoved(send) {
  const { error } = await supabaseAdmin
    .from('content_draft_deliveries')
    .update({ status: 'failed', error: 'Removed in Webflow' })
    .eq('id', send.id)
    .eq('status', 'sent');
  if (error) logger.warn({ err: error, deliveryId: send.id }, '[webflow-status] removal not kept');
}

const logged = (err) => ({ name: err?.name, code: err?.code });

/**
 * Reads the brand's pages sent to Webflow and not yet seen live (each
 * page's latest such send, newest first, up to `limit`), and marks the ones
 * Webflow published after the send published. One item's failure doesn't
 * stop the others (three in a row do); a token refused stops the check and
 * marks the connection.
 *
 * @returns {Promise<{ checked: number, published: { draftId: string|null, url: string }[] }>}
 */
export async function checkWebflowPublished(brandId, { limit = ITEMS_ON_DEMAND } = {}) {
  if (!isWebflowConfigured()) return none;
  const { data: connection, error } = await supabaseAdmin
    .from('brand_cms_connections')
    .select('brand_id, composio_account_id, composio_entity_id, status, site_id')
    .eq('brand_id', brandId)
    .eq('provider', 'webflow')
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!connection || connection.status !== 'connected' || !connection.site_id) return none;

  const { data: rows, error: rowsError } = await supabaseAdmin
    .from('content_draft_deliveries')
    .select('id, draft_id, status, published_url, external_id, target_collection, sent_at')
    .eq('brand_id', brandId)
    .eq('target', 'webflow')
    .eq('status', 'sent')
    .not('external_id', 'is', null)
    .not('target_collection', 'is', null)
    .gte('sent_at', new Date(Date.now() - LOOK_BACK_MS).toISOString())
    .order('sent_at', { ascending: false })
    .limit(limit * 4);
  if (rowsError) throw new Error(rowsError.message);
  // A page's latest send: an earlier one made the same item, updated since.
  const seen = new Set();
  const sends = [];
  for (const row of rows ?? []) {
    const key = row.draft_id ?? row.id;
    if (seen.has(key)) continue;
    seen.add(key);
    sends.push(row);
    if (sends.length === limit) break;
  }
  if (!sends.length) return none;

  const account = {
    entityId: connection.composio_entity_id,
    accountId: connection.composio_account_id,
  };
  const published = [];
  let checked = 0;
  try {
    const site = (await listSites(account)).find((s) => s.id === connection.site_id);
    if (!site?.host) return none;
    // A send to a collection since removed, or on another site, isn't read.
    const slugOf = new Map(
      (await listCollections(account, site.id)).filter((c) => c.slug).map((c) => [c.id, c.slug]),
    );
    let failures = 0;
    for (const send of sends) {
      const collection = slugOf.get(send.target_collection);
      if (!collection) continue;
      let item;
      try {
        item = await getItem(account, send.target_collection, send.external_id);
        failures = 0;
      } catch (err) {
        if (err instanceof WebflowError && err.code === 'auth_failed') throw err;
        logger.warn({ err: logged(err), deliveryId: send.id }, '[webflow-status] item not read');
        if (++failures === FAILURES_IN_A_ROW) break;
        continue;
      }
      checked++;
      if (!item) {
        await closeRemoved(send);
        continue;
      }
      // Live since the send: a live item sent again isn't published until Webflow publishes it again.
      const publishedAt = Date.parse(item.lastPublished ?? '');
      const sentAt = Date.parse(send.sent_at ?? '');
      if (!item.live || !item.slug || !(publishedAt >= sentAt)) continue;
      const url = `https://${site.host}/${encodeURIComponent(collection)}/${encodeURIComponent(item.slug)}`;
      await markDeliveryPublished(send, url);
      published.push({ draftId: send.draft_id, url });
    }
  } catch (err) {
    if (err instanceof WebflowError && err.code === 'auth_failed') {
      await markRefused(connection);
      return { checked, published };
    }
    throw err;
  }
  return { checked, published };
}

/**
 * The daily check, for brands with Webflow connected (on an active
 * subscription), in a shuffled order so the deadline leaves out different
 * brands each day; one brand's failure is logged and the next goes on.
 */
export async function sweepWebflowPublished() {
  if (!isWebflowConfigured()) return { brands: 0, published: 0 };
  const started = Date.now();
  const { data, error } = await supabaseAdmin
    .from('brand_cms_connections')
    .select('brand_id, brands!inner(is_demo, organizations!inner(subscription_status))')
    // A demo brand's connection (00380) is shown, never used.
    .eq('brands.is_demo', false)
    .eq('provider', 'webflow')
    .eq('status', 'connected')
    .not('site_id', 'is', null)
    .limit(SWEEP_CONNECTIONS);
  if (error) throw new Error(`brand_cms_connections read: ${error.message}`);
  const due = (data ?? []).filter((row) =>
    isSubscriptionActive(row.brands?.organizations?.subscription_status),
  );
  for (let i = due.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [due[i], due[j]] = [due[j], due[i]];
  }
  let brands = 0;
  let published = 0;
  for (const row of due) {
    if (Date.now() - started > SWEEP_DEADLINE_MS) break;
    try {
      const result = await checkWebflowPublished(row.brand_id, { limit: ITEMS_DAILY });
      brands++;
      published += result.published.length;
    } catch (err) {
      logger.error({ err: logged(err), brandId: row.brand_id }, '[webflow-status] check failed');
    }
  }
  return { brands, published };
}
