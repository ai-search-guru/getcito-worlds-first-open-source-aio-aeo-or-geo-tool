import supabaseAdmin from '../../config/supabase.js';
import { isSubscriptionActive } from '../../config/plans.js';
import { logger } from '../logger.js';
import { credentialsConfigured } from '../catalog/credentials.js';
import { markDeliveryPublished } from '../contentPublished.js';
import { readCmsCredentials } from './credentials.js';
import { WordPressError, answersAsWordPress, readPostState } from './wordpress.js';

/**
 * Pages sent to WordPress, published there since (Send to CMS #1331, phase
 * 2; 00294): nothing calls back when a post goes live, so GetCito reads the
 * posts its sends made. A send writes only to a draft (a live post gets a
 * new draft, cms/wordpressDelivery.js), so a post published now was put
 * live after the send: it is marked published at the post's own link (read
 * as the public sees it when this user can't read it to edit). A post in
 * the trash, or gone while the site answers as WordPress, closes its send;
 * a site answering 404 for every post (moved, its permalinks changed)
 * closes nothing. Read when the Library opens (a brand's newest sends, throttled by
 * its route) and once a day for all, as Webflow's are (webflowStatus.js).
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

/** The sign-in was refused while reading: Settings asks for a new one (as the send read it). */
async function markRefused(connection) {
  const { error } = await supabaseAdmin
    .from('brand_cms_connections')
    .update({ status: 'auth_failed', updated_at: new Date().toISOString() })
    .eq('id', connection.id)
    .eq('provider', 'wordpress')
    .eq('updated_at', connection.updated_at);
  if (error) logger.warn({ err: error }, '[wordpress-status] refusal not kept');
}

/** A send whose post is gone from WordPress: closed. The page's next send makes a new post. */
async function closeRemoved(send) {
  const { error } = await supabaseAdmin
    .from('content_draft_deliveries')
    .update({ status: 'failed', error: 'Removed in WordPress' })
    .eq('id', send.id)
    .eq('status', 'sent');
  if (error) {
    logger.warn({ err: error, deliveryId: send.id }, '[wordpress-status] removal not kept');
  }
}

const logged = (err) => ({ name: err?.name, code: err?.code });

/** A post's own link, when it's a web address. */
const linkOf = (post) => (/^https?:\/\//i.test(post?.link ?? '') ? post.link : null);

/**
 * Reads the brand's pages sent to WordPress and not yet seen live (each
 * page's latest such send to the connected site, newest first, up to
 * `limit`), and marks the published ones published. One post's failure
 * doesn't stop the others (three in a row do); a sign-in refused stops the
 * check and marks the connection.
 *
 * @returns {Promise<{ checked: number, published: { draftId: string|null, url: string }[] }>}
 */
export async function checkWordPressPublished(brandId, { limit = POSTS_ON_DEMAND, request } = {}) {
  if (!credentialsConfigured()) return none;
  const { data: connection, error } = await supabaseAdmin
    .from('brand_cms_connections')
    .select('id, brand_id, status, site_url, updated_at')
    .eq('brand_id', brandId)
    .eq('provider', 'wordpress')
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!connection || connection.status !== 'connected' || !connection.site_url) return none;

  // The connected site's sends only: a post on a site connected before isn't read with this sign-in.
  const { data: rows, error: rowsError } = await supabaseAdmin
    .from('content_draft_deliveries')
    .select('id, draft_id, status, published_url, external_id, target_collection, sent_at')
    .eq('brand_id', brandId)
    .eq('target', 'wordpress')
    .eq('target_collection', connection.site_url)
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
  if (!credentials?.username || !credentials?.password) {
    await markRefused(connection);
    return none;
  }
  const published = [];
  let checked = 0;
  let failures = 0;
  // The site answered as WordPress this check: a post read, or its index.
  let alive = false;
  for (const send of sends) {
    let post;
    try {
      post = await readPostState(connection.site_url, credentials, send.external_id, { request });
    } catch (err) {
      if (err instanceof WordPressError && err.code === 'auth_failed') {
        await markRefused(connection);
        return { checked, published };
      }
      logger.warn({ err: logged(err), deliveryId: send.id }, '[wordpress-status] post not read');
      if (++failures === FAILURES_IN_A_ROW) break;
      continue;
    }
    if (!post && !alive) {
      alive = await answersAsWordPress(connection.site_url, credentials, { request });
      if (!alive) {
        logger.warn({ deliveryId: send.id }, '[wordpress-status] site not answering as WordPress');
        if (++failures === FAILURES_IN_A_ROW) break;
        continue;
      }
    }
    alive = true;
    failures = 0;
    checked++;
    if (!post || post.status === 'trash') {
      await closeRemoved(send);
      continue;
    }
    const url = post.status === 'publish' ? linkOf(post) : null;
    if (!url) continue;
    await markDeliveryPublished(send, url);
    published.push({ draftId: send.draft_id, url });
  }
  return { checked, published };
}

/**
 * The daily check, for brands with WordPress connected (on an active
 * subscription), in a shuffled order so the deadline leaves out different
 * brands each day; one brand's failure is logged and the next goes on.
 */
export async function sweepWordPressPublished() {
  if (!credentialsConfigured()) return { brands: 0, published: 0 };
  const started = Date.now();
  const { data, error } = await supabaseAdmin
    .from('brand_cms_connections')
    .select('brand_id, brands!inner(organizations!inner(subscription_status))')
    .eq('provider', 'wordpress')
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
      const result = await checkWordPressPublished(row.brand_id, { limit: POSTS_DAILY });
      brands++;
      published += result.published.length;
    } catch (err) {
      logger.error({ err: logged(err), brandId: row.brand_id }, '[wordpress-status] check failed');
    }
  }
  return { brands, published };
}
