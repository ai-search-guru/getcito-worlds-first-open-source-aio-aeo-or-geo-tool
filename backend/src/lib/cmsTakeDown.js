import supabaseAdmin from '../config/supabase.js';
import { unpublishItem, WebflowError } from './cms/webflow.js';
import { unpublishPost, WordPressError } from './cms/wordpress.js';
import { revertToDraft, WixError } from './cms/wix.js';
import { readCmsCredentials } from './cms/credentials.js';
import { markDeliveryTakenDown } from './contentPublished.js';
import { DeliveryError, cmsConnectionFor } from './contentDelivery.js';
import { PUBLISH_TARGETS } from './cmsPublish.js';
import { logger } from './logger.js';

/**
 * Taking a published page down (AUTONOMOUS-GO-LIVE §6.4, PR 10): always a
 * person's click, from the Inbox notice, Chat's Activity, the Content
 * Library or Chat's unpublish_cms; never an agent on its own. Admins and
 * Managers, a Manager even while publishing is off for Managers: it only
 * lowers exposure (§15 Q11).
 *
 * The page's latest published send says where it is live: Webflow
 * unpublishes the item, WordPress sets the post back to a draft, Wix reverts
 * the post to a draft; the content stays there. Framer publishes the whole
 * site and a webhook send is the workflow's, so neither is taken down here
 * (take_down_unavailable, with words). Once the CMS did it, the send is
 * marked taken_down (contentPublished.js), which clears the page's address
 * and closes its measurement. A CMS that refuses says so: take_down_refused,
 * with its words, and nothing is marked. Server only.
 */

const NAMES = { webflow: 'Webflow', wordpress: 'WordPress', wix: 'Wix' };

/** The draft's latest send marked published, or null. */
async function publishedSend(draftId) {
  const { data, error } = await supabaseAdmin
    .from('content_draft_deliveries')
    .select(
      'id, organization_id, brand_id, draft_id, target, status, published_url, external_id, target_collection',
    )
    .eq('draft_id', draftId)
    .eq('status', 'published')
    .order('published_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

/** A sign-in the connection keeps, or the CMS's refusal to connect again. */
async function credentialsOf(connection, target, field) {
  const credentials = await readCmsCredentials(connection.id);
  if (!credentials?.[field]) {
    throw new DeliveryError(
      `${target}_refused`,
      `The ${NAMES[target]} ${target === 'wix' ? 'API key' : 'sign-in'} can’t be read. Connect ${NAMES[target]} again.`,
      409,
    );
  }
  return credentials;
}

const TAKE_DOWN = {
  webflow: (connection, delivery) =>
    unpublishItem(
      { entityId: connection.composio_entity_id, accountId: connection.composio_account_id },
      delivery.target_collection ?? connection.collection_id,
      delivery.external_id,
    ),
  wordpress: async (connection, delivery) => {
    const credentials = await credentialsOf(connection, 'wordpress', 'password');
    await unpublishPost(connection.site_url, credentials, delivery.external_id);
  },
  wix: async (connection, delivery) => {
    const credentials = await credentialsOf(connection, 'wix', 'apiKey');
    await revertToDraft(connection.site_id, credentials.apiKey, delivery.external_id);
  },
};

/**
 * Takes the draft's published page down. Answers the send as it is now
 * (status taken_down) and its CMS. DeliveryError for a refusal: not_found
 * (no such draft of the brand), not_live (no send of it is live),
 * take_down_unavailable (Framer, a webhook), take_down_refused (the CMS
 * said no, or couldn't be reached), or the connection's own codes.
 * @param {{ orgId: string, brandId: string, userId: string, draftId: string }} input
 */
export async function takeDownContentPage({ orgId, brandId, userId, draftId }) {
  const { data: draft, error } = await supabaseAdmin
    .from('content_drafts')
    .select('id, brand_id')
    .eq('id', draftId)
    .eq('brand_id', brandId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!draft) throw new DeliveryError('not_found', 'This page isn’t in the Content Library.', 404);

  const delivery = await publishedSend(draftId);
  if (!delivery || delivery.organization_id !== orgId) {
    throw new DeliveryError('not_live', 'This page isn’t live through GetCito.', 409);
  }
  if (!PUBLISH_TARGETS.includes(delivery.target)) {
    throw new DeliveryError(
      'take_down_unavailable',
      delivery.target === 'framer'
        ? 'Framer publishes the whole site at once: take it down in Framer.'
        : 'GetCito can’t take a webhook send back: your workflow decides what happens to it.',
      409,
    );
  }
  if (!delivery.external_id) {
    throw new DeliveryError(
      'take_down_refused',
      `${NAMES[delivery.target]} has no item of this page to take down.`,
      502,
    );
  }
  const connection = await cmsConnectionFor(brandId, delivery.target);
  try {
    await TAKE_DOWN[delivery.target](connection, delivery);
  } catch (err) {
    if (err instanceof DeliveryError) throw err;
    const known =
      err instanceof WebflowError || err instanceof WordPressError || err instanceof WixError;
    if (!known) {
      logger.warn(
        { err: { name: err?.name }, deliveryId: delivery.id },
        '[cms-take-down] take down failed',
      );
    }
    throw new DeliveryError(
      'take_down_refused',
      known
        ? `${NAMES[delivery.target]} didn’t take it down: ${err.message}`
        : `${NAMES[delivery.target]} could not be reached.`,
      502,
    );
  }
  const at = new Date().toISOString();
  await markDeliveryTakenDown(delivery, { userId, at });
  return {
    delivery: { id: delivery.id, status: 'taken_down', taken_down_at: at },
    target: delivery.target,
  };
}
