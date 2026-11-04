import supabaseAdmin from '../../config/supabase.js';
import { logger } from '../logger.js';
import { readCmsCredentials } from './credentials.js';
import { FramerError, writeItem } from './framer.js';
import { framerFieldData, framerSlug, toFramerHtml } from './framerItems.js';

/**
 * Send to CMS to Framer (#1331, phase 2; 00295): a page goes to the brand's
 * Framer collection as a draft item, or updates the item its last Framer
 * send made in that collection, its draft state as it is. Nothing is
 * published: Framer's own publish puts the site, its items with it, live.
 * contentDelivery.js reserves, writes and batches the deliveries as it
 * does for the webhook.
 */

/**
 * The item the page's last Framer send made in this collection, if any,
 * whatever became of that send: an item since deleted in Framer is looked
 * for and not found, and a new one is made (writeItem).
 */
async function lastItem(draftId, collectionId, deliveryId) {
  const { data, error } = await supabaseAdmin
    .from('content_draft_deliveries')
    .select('external_id')
    .eq('draft_id', draftId)
    .eq('target', 'framer')
    .eq('target_collection', collectionId)
    .not('external_id', 'is', null)
    .neq('id', deliveryId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.external_id ?? null;
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
    .eq('provider', 'framer')
    .eq('updated_at', connection.updated_at);
  if (error) logger.warn({ err: error }, '[content-delivery] framer refusal not kept');
}

/**
 * Sends one page to the brand's Framer collection. What went wrong is said
 * in our words. `connect` replaces framer-api's in tests.
 *
 * @param {{ delivery: { id: string }, page: object, html: string, jsonLd?: object[],
 *   connection: { id: string, site_id: string, collection_id: string, field_map: object,
 *   updated_at: string }, connect?: Function }} input
 * @returns {Promise<{ taken: boolean, failure?: string, refused?: boolean, externalId?: string,
 *   collectionId?: string, updated?: boolean, live?: boolean, changed?: { images: number } }>}
 *   live: the item updated isn't a draft in Framer, so the page goes live with the site's
 *   next publish
 */
export async function sendToFramer({ delivery, page, html, jsonLd, connection, connect }) {
  const collectionId = connection.collection_id;
  const { html: body, changed } = toFramerHtml(html);
  const slug = framerSlug(page);
  const fieldData = framerFieldData({ page, body, jsonLd }, connection.field_map ?? {});
  try {
    const credentials = await readCmsCredentials(connection.id);
    if (!credentials?.apiKey) {
      await markRefused(connection);
      return {
        taken: false,
        failure: 'The Framer API key can’t be read. Connect Framer again.',
        refused: true,
      };
    }
    const before = await lastItem(page.draftId, collectionId, delivery.id);
    const written = await writeItem(
      connection.site_id,
      credentials.apiKey,
      collectionId,
      { before, slug, fieldData, titleField: connection.field_map?.title ?? null },
      { connect },
    );
    return {
      taken: true,
      externalId: written.id,
      collectionId,
      updated: written.updated,
      live: written.live,
      changed,
    };
  } catch (err) {
    if (err instanceof FramerError) {
      if (err.code === 'auth_failed') {
        await markRefused(connection);
        return { taken: false, failure: err.message, refused: true };
      }
      return { taken: false, failure: err.message };
    }
    logger.warn(
      { err: { name: err?.name }, deliveryId: delivery.id },
      '[content-delivery] framer send failed',
    );
    return { taken: false, failure: 'Framer could not be reached' };
  }
}
