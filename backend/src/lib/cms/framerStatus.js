import supabaseAdmin from '../../config/supabase.js';
import { isSubscriptionActive } from '../../config/plans.js';
import { logger } from '../logger.js';
import { credentialsConfigured } from '../catalog/credentials.js';
import { liveAddress, markDeliveryPublished } from '../contentPublished.js';
import { readCmsCredentials } from './credentials.js';
import { FramerError, readPublished } from './framer.js';

/**
 * Pages sent to Framer, published there since (Send to CMS #1331, phase 2;
 * 00295): nothing calls back when a Framer site is published, so GetCito
 * reads the items its sends made, in one connection to the project. An item
 * goes live with the site's publish once it isn't a draft, so a send is
 * marked published at the item's page (the site's address, the collection's
 * detail page path with the item's slug) when the item isn't a draft and the
 * site was published after the send and after the item's last change (an
 * item taken out of draft since the publish isn't on the site yet). An item
 * published before (a live page sent again) waits for the site's next
 * publish; an item deleted in Framer
 * closes its send. Read when the Library opens (a brand's newest sends,
 * throttled by its route) and once a day for all, as WordPress's are
 * (wordpressStatus.js).
 */

/** Items the Library's check reads: the newest sends. The daily sweep reads the rest. */
export const ITEMS_ON_DEMAND = 10;
/** Items the daily sweep reads a brand. */
export const ITEMS_DAILY = 100;
/** Sends older than this aren't read again: a draft left that long stays one. */
const LOOK_BACK_MS = 60 * 24 * 60 * 60 * 1000;
/** Connections the daily sweep reads, shuffled so a deadline doesn't leave the same brands out. */
const SWEEP_CONNECTIONS = 1000;
const SWEEP_DEADLINE_MS = 10 * 60 * 1000;

const none = { checked: 0, published: [] };

/** The key was refused while reading: Settings asks for a new one (as the send read it). */
async function markRefused(connection) {
  const { error } = await supabaseAdmin
    .from('brand_cms_connections')
    .update({ status: 'auth_failed', updated_at: new Date().toISOString() })
    .eq('id', connection.id)
    .eq('provider', 'framer')
    .eq('updated_at', connection.updated_at);
  if (error) logger.warn({ err: error }, '[framer-status] refusal not kept');
}

/** A send whose item is gone from the collection: closed. The page's next send makes a new item. */
async function closeRemoved(send) {
  const { error } = await supabaseAdmin
    .from('content_draft_deliveries')
    .update({ status: 'failed', error: 'Removed in Framer' })
    .eq('id', send.id)
    .eq('status', 'sent');
  if (error) {
    logger.warn({ err: error, deliveryId: send.id }, '[framer-status] removal not kept');
  }
}

const logged = (err) => ({ name: err?.name, code: err?.code });

/**
 * An item's page on the site: the detail page's path with the item's slug
 * for ":slug", as a published address is kept (liveAddress: at most 2048
 * characters) and https. Else why it has none: 'path' (no ":slug", or
 * another parameter), 'slug' (the item has none) or 'address'.
 *
 * @returns {{ url: string } | { problem: 'path'|'slug'|'address' }}
 */
function pageAddress(siteUrl, detailPath, slug) {
  const params = detailPath.match(/:[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
  if (params.length !== 1 || params[0] !== ':slug') return { problem: 'path' };
  if (typeof slug !== 'string' || !slug.trim()) return { problem: 'slug' };
  const path = detailPath.replace(':slug', encodeURIComponent(slug));
  const url = liveAddress(`${siteUrl}${path.startsWith('/') ? '' : '/'}${path}`);
  return url?.startsWith('https://') ? { url } : { problem: 'address' };
}

/** Why a page has no address, as logged. */
const UNPLACED = {
  path: '[framer-status] detail page path has no :slug, or another parameter',
  slug: '[framer-status] item has no slug',
  address: '[framer-status] page address not https, or too long',
};

/**
 * Reads the brand's pages sent to Framer and not yet seen live (each page's
 * latest such send to the connected collection, newest first, up to
 * `limit`), and marks the published ones published. A key refused marks the
 * connection; any other failure to read the project is logged and leaves
 * the sends for the next check. `connect` replaces framer-api's in tests.
 *
 * @returns {Promise<{ checked: number, published: { draftId: string|null, url: string }[] }>}
 */
export async function checkFramerPublished(brandId, { limit = ITEMS_ON_DEMAND, connect } = {}) {
  if (!credentialsConfigured()) return none;
  const { data: connection, error } = await supabaseAdmin
    .from('brand_cms_connections')
    .select('id, brand_id, status, site_id, collection_id, updated_at')
    .eq('brand_id', brandId)
    .eq('provider', 'framer')
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (
    !connection ||
    connection.status !== 'connected' ||
    !connection.site_id ||
    !connection.collection_id
  ) {
    return none;
  }

  // The connected collection's sends only: an item in one picked before isn't read.
  const { data: rows, error: rowsError } = await supabaseAdmin
    .from('content_draft_deliveries')
    .select('id, draft_id, status, published_url, external_id, target_collection, sent_at')
    .eq('brand_id', brandId)
    .eq('target', 'framer')
    .eq('target_collection', connection.collection_id)
    .eq('status', 'sent')
    .not('external_id', 'is', null)
    .gte('sent_at', new Date(Date.now() - LOOK_BACK_MS).toISOString())
    .order('sent_at', { ascending: false })
    .limit(limit * 4);
  if (rowsError) throw new Error(rowsError.message);
  // A page's latest send: an earlier one made the same item, updated since, or one replaced.
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

  const credentials = await readCmsCredentials(connection.id);
  if (!credentials?.apiKey) {
    await markRefused(connection);
    return none;
  }
  let read;
  try {
    read = await readPublished(
      connection.site_id,
      credentials.apiKey,
      connection.collection_id,
      sends.map((send) => send.external_id),
      { connect },
    );
  } catch (err) {
    if (err instanceof FramerError && err.code === 'auth_failed') {
      await markRefused(connection);
      return none;
    }
    // Framer busy or down, the collection gone: the sends wait for the next check.
    logger.warn({ err: logged(err), brandId }, '[framer-status] project not read');
    return none;
  }

  const { siteUrl, deployedAt, detailPath } = read;
  const published = [];
  let checked = 0;
  let unplaced = false;
  for (const send of sends) {
    checked++;
    const item = read.items.get(send.external_id);
    if (!item) {
      await closeRemoved(send);
      continue;
    }
    // Live with a publish since the send: a live item sent again waits for the site's next one.
    const sentAt = Date.parse(send.sent_at ?? '');
    if (item.draft || !siteUrl || !detailPath || deployedAt === null || !(deployedAt > sentAt)) {
      continue;
    }
    // And since the item's last change: one taken out of draft after the publish isn't live yet.
    // Framer may not give the time; the send's then decides alone.
    if (item.updatedAt !== null && item.updatedAt !== undefined) {
      if (!(deployedAt >= Date.parse(item.updatedAt))) continue;
    }
    const { url, problem } = pageAddress(siteUrl, detailPath, item.slug);
    if (!url) {
      // The path is every page's: logged once a check. An item's own, by its send.
      if (problem === 'path') {
        if (!unplaced) logger.warn({ brandId }, UNPLACED.path);
        unplaced = true;
      } else {
        logger.warn({ brandId, deliveryId: send.id }, UNPLACED[problem]);
      }
      continue;
    }
    await markDeliveryPublished(send, url);
    published.push({ draftId: send.draft_id, url });
  }
  return { checked, published };
}

/**
 * The daily check, for brands with Framer connected to a collection (on an
 * active subscription), in a shuffled order so the deadline leaves out
 * different brands each day; one brand's failure is logged and the next
 * goes on.
 */
export async function sweepFramerPublished() {
  if (!credentialsConfigured()) return { brands: 0, published: 0 };
  const started = Date.now();
  const { data, error } = await supabaseAdmin
    .from('brand_cms_connections')
    .select('brand_id, brands!inner(organizations!inner(subscription_status))')
    .eq('provider', 'framer')
    .eq('status', 'connected')
    .not('collection_id', 'is', null)
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
      const result = await checkFramerPublished(row.brand_id, { limit: ITEMS_DAILY });
      brands++;
      published += result.published.length;
    } catch (err) {
      logger.error({ err: logged(err), brandId: row.brand_id }, '[framer-status] check failed');
    }
  }
  return { brands, published };
}
