import * as cheerio from 'cheerio';
import supabaseAdmin from '../../config/supabase.js';
import { logger } from '../logger.js';
import { markDeliveryPublished } from '../contentPublished.js';
import { readCmsCredentials } from './credentials.js';
import { WordPressError, createPost, readPost, updatePost } from './wordpress.js';

/**
 * Send to CMS to WordPress (#1331, phase 2; 00294): a page goes to the
 * brand's WordPress site as a draft post, or updates the post its last
 * WordPress send made on that site while that post is still a draft.
 *
 * WordPress has no draft of a live post: a published post written to is
 * live at once. Send to CMS sends drafts only, so a page whose post is
 * live (or scheduled, or private) goes as a new draft post, and the send
 * says so; the person moves it over by hand. contentDelivery.js reserves,
 * writes and batches the deliveries as it does for the webhook.
 *
 * The page's JSON-LD stays out: WordPress keeps a <script> only for users
 * allowed unfiltered HTML, and for the others strips the tags and leaves the
 * JSON in the post as text.
 */

/** A post still a draft: written to, it stays one. */
const DRAFT_STATUSES = new Set(['draft', 'pending', 'auto-draft']);

/**
 * The post the page's last WordPress send made on this site, if any,
 * whatever became of that send. The site is its whole address (the
 * delivery's target_collection): two sites in folders of one domain, or of
 * one multisite, number their posts each from 1.
 */
async function lastPost(draftId, site, deliveryId) {
  const { data, error } = await supabaseAdmin
    .from('content_draft_deliveries')
    .select('id, draft_id, status, published_url, external_id')
    .eq('draft_id', draftId)
    .eq('target', 'wordpress')
    .eq('target_collection', site)
    .not('external_id', 'is', null)
    .neq('id', deliveryId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.external_id ? data : null;
}

/**
 * The last send's post, found live by this send before the published check
 * saw it: that send is marked published at the post's link, so the publish
 * isn't lost behind the new draft (the page itself follows its latest send,
 * this new draft, once that is published). Best effort.
 */
async function keepPublished(last, post) {
  if (post.status !== 'publish' || !/^https?:\/\//i.test(post.link ?? '')) return;
  try {
    await markDeliveryPublished(last, post.link);
  } catch (err) {
    logger.warn(
      { err: { name: err?.name }, deliveryId: last.id },
      '[content-delivery] publish not kept',
    );
  }
}

/**
 * The sign-in the send was refused with: Settings asks for a new one. Only
 * the connection as the send read it: one connected again meanwhile keeps
 * its new sign-in.
 */
async function markRefused(connection) {
  const { error } = await supabaseAdmin
    .from('brand_cms_connections')
    .update({ status: 'auth_failed', updated_at: new Date().toISOString() })
    .eq('id', connection.id)
    .eq('provider', 'wordpress')
    .eq('updated_at', connection.updated_at);
  if (error) logger.warn({ err: error }, '[content-delivery] wordpress refusal not kept');
}

/** The page's HTML as WordPress takes it, its JSON-LD out; how many blocks went. */
export function toWordPressHtml(html) {
  const $ = cheerio.load(html, null, false);
  const jsonLd = $('script').filter(
    (_, el) => String($(el).attr('type') ?? '').toLowerCase() === 'application/ld+json',
  );
  const count = jsonLd.length;
  jsonLd.remove();
  return { html: count ? $.html() : html, jsonLd: count };
}

/**
 * Sends one page to the brand's WordPress site. What went wrong is said in
 * our words.
 *
 * @param {{ delivery: { id: string }, page: object, html: string,
 *   connection: { id: string, site_url: string, updated_at: string }, request?: Function }} input
 * @returns {Promise<{ taken: boolean, failure?: string, refused?: boolean, externalId?: string,
 *   collectionId?: string, updated?: boolean, live?: boolean, changed?: { jsonLd: number } }>}
 *   live: the page's post was live, so a new draft was made (with its slug: published,
 *   WordPress gives it "-2"); changed: the JSON-LD blocks left out
 */
export async function sendToWordPress({ delivery, page, html, connection, request }) {
  const site = connection.site_url;
  const { html: content, jsonLd } = toWordPressHtml(html);
  const post = {
    title: page.title,
    // Empty, WordPress makes one from the title.
    ...(page.slug ? { slug: page.slug } : {}),
    content,
    excerpt: page.metaDescription || '',
  };
  try {
    const credentials = await readCmsCredentials(connection.id);
    if (!credentials?.username || !credentials?.password) {
      await markRefused(connection);
      return {
        taken: false,
        failure: 'The WordPress sign-in can’t be read. Connect WordPress again.',
        refused: true,
      };
    }
    const last = await lastPost(page.draftId, site, delivery.id);
    const before = last?.external_id ?? null;
    const current = before ? await readPost(site, credentials, before, { request }) : null;
    const live = Boolean(
      current && current.status !== 'trash' && !DRAFT_STATUSES.has(current.status),
    );
    if (live) await keepPublished(last, current);
    let written = null;
    if (current && !live && current.status !== 'trash') {
      try {
        written = await updatePost(site, credentials, before, post, { request });
      } catch (err) {
        if (!(err instanceof WordPressError && err.code === 'not_found')) throw err;
      }
    }
    const updated = Boolean(written);
    written ??= await createPost(site, credentials, post, { request });
    return {
      taken: true,
      externalId: String(written.id),
      collectionId: site,
      updated,
      live,
      changed: { jsonLd },
    };
  } catch (err) {
    if (err instanceof WordPressError) {
      if (err.code === 'auth_failed') {
        await markRefused(connection);
        return { taken: false, failure: err.message, refused: true };
      }
      return { taken: false, failure: err.message };
    }
    logger.warn(
      { err: { name: err?.name }, deliveryId: delivery.id },
      '[content-delivery] wordpress send failed',
    );
    return { taken: false, failure: 'WordPress could not be reached' };
  }
}
