import supabaseAdmin from '../config/supabase.js';
import { listCollections, listSites, publishItem, getItem, WebflowError } from './cms/webflow.js';
import { publishPost, WordPressError } from './cms/wordpress.js';
import { publishDraftPost, WixError } from './cms/wix.js';
import { readCmsCredentials } from './cms/credentials.js';
import { markDeliveryPublished } from './contentPublished.js';
import { DeliveryError, cmsConnectionFor, sendContentPages } from './contentDelivery.js';
import { logger } from './logger.js';

/**
 * Publishing a new page live in the brand's CMS (AUTONOMOUS-GO-LIVE §4 row
 * 2, PR 9): a person's Publish click from Chat, or an agent an Admin let go
 * live on its own (routes/internalChatGoLive.js). Webflow, WordPress and
 * Wix; Framer publishes the whole site, other people's staged changes with
 * it, so it refuses (framer_site_publish). New pages only: a page live
 * already stays the Content Editor's (live_item).
 *
 * The page is first written into its CMS draft as Send to CMS writes it
 * (sendContentPages: the page that was checked is the page that goes live),
 * then published on its own there, then its delivery is marked published at
 * its address, which records the ship event (contentPublished.js). A CMS
 * that refuses the publish leaves the draft sent: publish_refused, with its
 * words. Server only.
 */

/** The CMSs a page is published live in. */
export const PUBLISH_TARGETS = ['webflow', 'wordpress', 'wix'];

const NAMES = { webflow: 'Webflow', wordpress: 'WordPress', wix: 'Wix' };

/** Whether the draft is live already: its address, or a send marked published. */
async function isLive(draftId) {
  const [draft, published] = await Promise.all([
    supabaseAdmin.from('content_drafts').select('published_url').eq('id', draftId).maybeSingle(),
    supabaseAdmin
      .from('content_draft_deliveries')
      .select('id')
      .eq('draft_id', draftId)
      .eq('status', 'published')
      .limit(1)
      .maybeSingle(),
  ]);
  for (const result of [draft, published]) if (result.error) throw new Error(result.error.message);
  return !!draft.data?.published_url || !!published.data;
}

/** Webflow: out of draft, published on its own, at its collection's address on the site. */
async function publishWebflow(connection, delivery) {
  const account = {
    entityId: connection.composio_entity_id,
    accountId: connection.composio_account_id,
  };
  const collectionId = delivery.target_collection ?? connection.collection_id;
  await publishItem(account, collectionId, delivery.external_id);
  const [sites, item] = await Promise.all([
    listSites(account),
    getItem(account, collectionId, delivery.external_id),
  ]);
  // The site its address is on: the send's connection reads no site, its row has it.
  const { data: own, error } = await supabaseAdmin
    .from('brand_cms_connections')
    .select('site_id')
    .eq('brand_id', connection.brand_id)
    .eq('provider', 'webflow')
    .maybeSingle();
  if (error) throw new Error(error.message);
  const site = sites.find((s) => s.id === own?.site_id);
  const collection = site
    ? (await listCollections(account, site.id)).find((c) => c.id === collectionId)
    : null;
  if (!site?.host || !collection?.slug || !item?.slug) return null;
  return `https://${site.host}/${encodeURIComponent(collection.slug)}/${encodeURIComponent(item.slug)}`;
}

/** WordPress: the post's status publish, at its link. */
async function publishWordPress(connection, delivery) {
  const credentials = await readCmsCredentials(connection.id);
  if (!credentials?.username || !credentials?.password) {
    throw new DeliveryError(
      'wordpress_refused',
      'The WordPress sign-in can’t be read. Connect WordPress again.',
      409,
    );
  }
  const post = await publishPost(connection.site_url, credentials, delivery.external_id);
  return typeof post.link === 'string' && post.link ? post.link : null;
}

/** Wix: the draft post published, at its web address. */
async function publishWix(connection, delivery) {
  const credentials = await readCmsCredentials(connection.id);
  if (!credentials?.apiKey) {
    throw new DeliveryError(
      'wix_refused',
      'The Wix API key can’t be read. Connect Wix again.',
      409,
    );
  }
  const post = await publishDraftPost(connection.site_id, credentials.apiKey, delivery.external_id);
  return post.url;
}

const PUBLISH = { webflow: publishWebflow, wordpress: publishWordPress, wix: publishWix };

/**
 * Publishes one page live. What it answers: the send's delivery row, with
 * its status `published` and its address when it went live; `sent` with
 * `error` when the page went in as a draft but the CMS refused the publish
 * (thrown as publish_refused); `failed` when the send itself failed.
 * DeliveryError for a refusal before anything went out.
 * @param {{ orgId: string, brandId: string, userId: string, page: object,
 *   target: string, agentRunId?: string|null }} input
 */
export async function publishContentPage({
  orgId,
  brandId,
  userId,
  page,
  target,
  agentRunId = null,
}) {
  if (target === 'framer') {
    throw new DeliveryError(
      'framer_site_publish',
      'Framer publishes the whole site at once: publish it in Framer.',
      409,
    );
  }
  if (!PUBLISH_TARGETS.includes(target)) {
    throw new DeliveryError('not_found', 'Pages go live in Webflow, WordPress or Wix.', 404);
  }
  if (await isLive(page.draftId)) {
    throw new DeliveryError(
      'live_item',
      'This page is live already. Change it from the Content Editor.',
      409,
    );
  }
  const connection = await cmsConnectionFor(brandId, target);
  const sent = await sendContentPages({
    orgId,
    brandId,
    userId,
    pages: [page],
    target,
    agentRunId,
  });
  const delivery = sent.deliveries[0] ?? null;
  if (!delivery || delivery.status === 'failed') return { delivery };

  const { data: row, error } = await supabaseAdmin
    .from('content_draft_deliveries')
    .select(
      'id, organization_id, brand_id, draft_id, status, published_url, external_id, target_collection, sent_at',
    )
    .eq('id', delivery.id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!row?.external_id)
    throw new DeliveryError('publish_refused', `${NAMES[target]} kept no item to publish.`, 502);

  let url;
  try {
    url = await PUBLISH[target](connection, row);
  } catch (err) {
    if (err instanceof DeliveryError) throw err;
    const known =
      err instanceof WebflowError || err instanceof WordPressError || err instanceof WixError;
    if (!known)
      logger.warn({ err: { name: err?.name }, deliveryId: row.id }, '[cms-publish] publish failed');
    throw new DeliveryError(
      'publish_refused',
      known
        ? `${NAMES[target]} didn’t publish it: ${err.message}`
        : `${NAMES[target]} could not be reached.`,
      502,
    );
  }
  if (!url) {
    // Live, but its address couldn't be read: the status sweep finds it next.
    return { delivery: { ...delivery, status: 'sent' }, published: true, url: null };
  }
  await markDeliveryPublished(row, url, { externalId: row.external_id });
  return {
    delivery: { ...delivery, status: 'published', published_url: url },
    published: true,
    url,
  };
}
