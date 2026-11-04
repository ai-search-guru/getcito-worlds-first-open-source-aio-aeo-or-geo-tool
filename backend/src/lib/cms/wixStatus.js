import supabaseAdmin from '../../config/supabase.js';
import { isSubscriptionActive } from '../../config/plans.js';
import { logger } from '../logger.js';
import { credentialsConfigured } from '../catalog/credentials.js';
import { markDeliveryPublished } from '../contentPublished.js';
import { readCmsCredentials } from './credentials.js';
import { WixError, readDraftPost, webAddress } from './wix.js';

/**
 * Pages sent to Wix, published there since (Send to CMS #1331, phase 2;
 * 00372): nothing calls back when a post goes live, so GetCito reads the
 * posts its sends made. A send writes a draft, or a live post's draft
 * version (cms/wixDelivery.js), so a post published with no changes left
 * unpublished was put live after the send: it is marked published at the
 * post's address. One still holding unpublished changes isn't yet; a post
 * deleted, or gone, closes its send. Read when the Library opens (a brand's
 * newest sends, throttled by its route) and once a day for all, as
 * WordPress's are (wordpressStatus.js).
 */

/** Posts the Library's check reads: the newest sends. The daily sweep reads the rest. */
export const POSTS_ON_DEMAND = 10;
/** Posts the daily sweep reads a brand. */
export const POSTS_DAILY = 100;
/** Sends older than this aren't read again: a draft left that long stays one. */
const LOOK_BACK_MS = 60 * 24 * 60 * 60 * 1000;
/** Post reads that fail in a row before a check stops: the site is down. */
const FAILURES_IN_A_ROW = 3;
/** Connections the daily sweep reads, shuffled so a deadline doesn't leave the same brands out. */
const SWEEP_CONNECTIONS = 1000;
const SWEEP_DEADLINE_MS = 10 * 60 * 1000;

const none = { checked: 0, published: [] };

/** The API key was refused while reading: Settings asks for a new one (as the send read it). */
async function markRefused(connection) {
  const { error } = await supabaseAdmin
    .from('brand_cms_connections')
    .update({ status: 'auth_failed', updated_at: new Date().toISOString() })
    .eq('id', connection.id)
    .eq('provider', 'wix')
    .eq('updated_at', connection.updated_at);
  if (error) logger.warn({ err: error }, '[wix-status] refusal not kept');
}

/** A send whose post is gone from Wix: closed. The page's next send makes a new post. */
async function closeRemoved(send) {
  const { error } = await supabaseAdmin
    .from('content_draft_deliveries')
    .update({ status: 'failed', error: 'Removed in Wix' })
    .eq('id', send.id)
    .eq('status', 'sent');
  if (error) {
    logger.warn({ err: error, deliveryId: send.id }, '[wix-status] removal not kept');
  }
}

const logged = (err) => ({ name: err?.name, code: err?.code });

/** A post's address, when it's a web address; one Wix gives without its scheme gets https://. */
const linkOf = (post) => webAddress(post?.url);

/**
 * Reads the brand's pages sent to Wix and not yet seen live (each page's
 * latest such send to the connected site, newest first, up to `limit`), and
 * marks the published ones published. One post's failure doesn't stop the
 * others (three in a row do); a key refused stops the check and marks the
 * connection.
 *
 * @returns {Promise<{ checked: number, published: { draftId: string|null, url: string }[] }>}
 */
export async function checkWixPublished(brandId, { limit = POSTS_ON_DEMAND, request, base } = {}) {
  if (!credentialsConfigured()) return none;
  const { data: connection, error } = await supabaseAdmin
    .from('brand_cms_connections')
    .select('id, brand_id, status, site_id, updated_at')
    .eq('brand_id', brandId)
    .eq('provider', 'wix')
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!connection || connection.status !== 'connected' || !connection.site_id) return none;

  // The connected site's sends only: a post on a site connected before isn't read with this key.
  const { data: rows, error: rowsError } = await supabaseAdmin
    .from('content_draft_deliveries')
    .select('id, draft_id, status, published_url, external_id, target_collection, sent_at')
    .eq('brand_id', brandId)
    .eq('target', 'wix')
    .eq('target_collection', connection.site_id)
    .eq('status', 'sent')
    .not('external_id', 'is', null)
    .gte('sent_at', new Date(Date.now() - LOOK_BACK_MS).toISOString())
    .order('sent_at', { ascending: false })
    .limit(limit * 4);
  if (rowsError) throw new Error(rowsError.message);
  // A page's latest send: an earlier one made the same post, updated since, or one replaced.
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
  const published = [];
  let checked = 0;
  let failures = 0;
  for (const send of sends) {
    let post;
    try {
      post = await readDraftPost(connection.site_id, credentials.apiKey, send.external_id, {
        request,
        base,
      });
    } catch (err) {
      if (err instanceof WixError && err.code === 'auth_failed') {
        await markRefused(connection);
        return { checked, published };
      }
      logger.warn({ err: logged(err), deliveryId: send.id }, '[wix-status] post not read');
      if (++failures === FAILURES_IN_A_ROW) break;
      continue;
    }
    failures = 0;
    checked++;
    if (!post || post.status === 'DELETED') {
      await closeRemoved(send);
      continue;
    }
    // Published, its changes too: a live post's draft version waits for the person.
    const url = post.status === 'PUBLISHED' && !post.pending ? linkOf(post) : null;
    if (!url) continue;
    await markDeliveryPublished(send, url);
    published.push({ draftId: send.draft_id, url });
  }
  return { checked, published };
}

/**
 * The daily check, for brands with Wix connected (on an active
 * subscription), in a shuffled order so the deadline leaves out different
 * brands each day; one brand's failure is logged and the next goes on.
 */
export async function sweepWixPublished() {
  if (!credentialsConfigured()) return { brands: 0, published: 0 };
  const started = Date.now();
  const { data, error } = await supabaseAdmin
    .from('brand_cms_connections')
    .select('brand_id, brands!inner(is_demo, organizations!inner(subscription_status))')
    // A demo brand (00380) never reaches Wix.
    .eq('brands.is_demo', false)
    .eq('provider', 'wix')
    .eq('status', 'connected')
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
      const result = await checkWixPublished(row.brand_id, { limit: POSTS_DAILY });
      brands++;
      published += result.published.length;
    } catch (err) {
      logger.error({ err: logged(err), brandId: row.brand_id }, '[wix-status] check failed');
    }
  }
  return { brands, published };
}
