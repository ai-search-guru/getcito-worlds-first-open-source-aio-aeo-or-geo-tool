import * as cheerio from 'cheerio';
import supabaseAdmin from '../../config/supabase.js';
import { logger } from '../logger.js';
import { readCmsCredentials } from './credentials.js';
import { WixError, createDraftPost, readDraftPost, toRicos, updateDraftPost } from './wix.js';

/**
 * Send to CMS to Wix (#1331, phase 2; 00372): a page goes to the brand's Wix
 * site's Blog as a draft post, or updates the post its last Wix send made on
 * that site. Unlike WordPress, Wix keeps a draft of a live post: a page whose
 * post is published updates that draft (UPDATE_PUBLICATION), and the post
 * people read stays as it was until the person publishes the changes in Wix.
 * contentDelivery.js reserves, writes and batches the deliveries as it does
 * for the webhook.
 *
 * The page's title and meta description, and its JSON-LD, go as the post's
 * SEO tags; its images stay out (Wix shows only images in its Media
 * Manager), and the send counts them.
 */

/** Wix's limits on a draft post's excerpt and slug. */
const EXCERPT_MAX = 500;
const SLUG_MAX = 100;

/**
 * The post's status that means it's live: its changes go to its draft
 * version (UPDATE_PUBLICATION). A scheduled post isn't live yet, so it's
 * written as a draft is (UPDATE).
 */
const LIVE = 'PUBLISHED';

/**
 * The post the page's last Wix send made on this site, if any, whatever
 * became of that send. The site is its id (the delivery's target_collection).
 */
async function lastPost(draftId, siteId, deliveryId) {
  const { data, error } = await supabaseAdmin
    .from('content_draft_deliveries')
    .select('id, external_id')
    .eq('draft_id', draftId)
    .eq('target', 'wix')
    .eq('target_collection', siteId)
    .not('external_id', 'is', null)
    .neq('id', deliveryId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.external_id ? data : null;
}

/**
 * The key the send was refused with: Settings asks for a new one. Only the
 * connection as the send read it: one connected again meanwhile keeps its
 * new key.
 */
async function markRefused(connection) {
  const { error } = await supabaseAdmin
    .from('brand_cms_connections')
    .update({ status: 'auth_failed', updated_at: new Date().toISOString() })
    .eq('id', connection.id)
    .eq('provider', 'wix')
    .eq('updated_at', connection.updated_at);
  if (error) logger.warn({ err: error }, '[content-delivery] wix refusal not kept');
}

/** The page's HTML as Wix takes it: its JSON-LD (sent as SEO tags) and images out; how many images went. */
export function toWixHtml(html) {
  const $ = cheerio.load(html, null, false);
  $('script').remove();
  const images = $('img').length;
  $('img, picture, source').remove();
  // A figure left with only its caption, or nothing, goes too.
  $('figure').each((_, el) => {
    if (!$(el).find('*').not('figcaption').length) $(el).remove();
  });
  return { html: $.html(), images };
}

/** The post's SEO tags: its title, meta description and JSON-LD. */
export function seoTags(page, jsonLd = []) {
  const tags = [];
  const title = page.metaTitle || page.title;
  if (title) tags.push({ type: 'title', children: title, custom: false, disabled: false });
  if (page.metaDescription) {
    tags.push({
      type: 'meta',
      props: { name: 'description', content: page.metaDescription },
      custom: false,
      disabled: false,
    });
  }
  if (page.reviewer) {
    tags.push({
      type: 'meta',
      props: { name: 'reviewed-by', content: page.reviewer },
      custom: true,
      disabled: false,
    });
  }
  for (const block of jsonLd) {
    tags.push({
      type: 'script',
      props: { type: 'application/ld+json' },
      // Every "<" escaped: nothing in it can end or open a tag in the post's script.
      children: JSON.stringify(block).replace(/</g, '\\u003c'),
      custom: false,
      disabled: false,
    });
  }
  return tags;
}

/**
 * Sends one page to the brand's Wix site's Blog. What went wrong is said in
 * our words.
 *
 * @param {{ delivery: { id: string }, page: object, html: string, jsonLd?: object[],
 *   connection: { id: string, site_id: string, account: string, updated_at: string },
 *   request?: Function, base?: string }} input
 * @returns {Promise<{ taken: boolean, failure?: string, refused?: boolean, externalId?: string,
 *   collectionId?: string, updated?: boolean, live?: boolean, changed?: { images: number } }>}
 */
export async function sendToWix({ delivery, page, html, jsonLd = [], connection, request, base }) {
  const siteId = connection.site_id;
  const opts = { request, base };
  try {
    const credentials = await readCmsCredentials(connection.id);
    if (!credentials?.apiKey) {
      await markRefused(connection);
      return {
        taken: false,
        failure: 'The Wix API key can’t be read. Connect Wix again.',
        refused: true,
      };
    }
    const { apiKey } = credentials;
    const { html: body, images } = toWixHtml(html);
    const post = {
      title: page.title.slice(0, 200),
      richContent: await toRicos(siteId, apiKey, body, opts),
      memberId: connection.account,
      ...(page.metaDescription ? { excerpt: page.metaDescription.slice(0, EXCERPT_MAX) } : {}),
      ...(page.slug ? { seoSlug: page.slug.slice(0, SLUG_MAX) } : {}),
      seoData: { tags: seoTags(page, jsonLd) },
    };
    const last = await lastPost(page.draftId, siteId, delivery.id);
    const current = last ? await readDraftPost(siteId, apiKey, last.external_id, opts) : null;
    let written = null;
    if (current && current.status !== 'DELETED') {
      try {
        written = await updateDraftPost(siteId, apiKey, current.id, post, {
          ...opts,
          live: current.status === LIVE,
        });
      } catch (err) {
        if (!(err instanceof WixError && err.code === 'not_found')) throw err;
      }
    }
    const updated = Boolean(written);
    written ??= await createDraftPost(siteId, apiKey, post, opts);
    return {
      taken: true,
      // Wix's answer to an update may leave out the post's id: it's the one updated, still.
      externalId: written.id ?? current?.id,
      collectionId: siteId,
      updated,
      // A live post's draft was written: nothing new was made beside it.
      live: false,
      changed: { images },
    };
  } catch (err) {
    if (err instanceof WixError) {
      if (err.code === 'auth_failed') {
        await markRefused(connection);
        return { taken: false, failure: err.message, refused: true };
      }
      return { taken: false, failure: err.message };
    }
    logger.warn(
      { err: { name: err?.name }, deliveryId: delivery.id },
      '[content-delivery] wix send failed',
    );
    return { taken: false, failure: 'Wix could not be reached' };
  }
}
