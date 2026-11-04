import crypto from 'node:crypto';
import * as cheerio from 'cheerio';
import { z } from 'zod';
import supabaseAdmin from '../config/supabase.js';
import { logger } from './logger.js';
import { PageFetchError } from './safeFetch.js';
import { brandSiteType, rulesLanguage, untouchedRules } from './contentLanguage.js';
import { postJson } from './safePost.js';
import { isWebflowConfigured } from './composio.js';
import { credentialsConfigured } from './catalog/credentials.js';
import { sendToWebflow } from './cms/webflowDelivery.js';
import { sendToWordPress } from './cms/wordpressDelivery.js';
import { sendToFramer } from './cms/framerDelivery.js';
import { sendToWix } from './cms/wixDelivery.js';

/**
 * Send to CMS, phase 1 (#1331): an admin or manager sends Content Editor
 * pages to the brand's webhook, each as a content package (schemaVersion 1)
 * the workspace's own automation turns into a post: its publishable HTML
 * (built in the browser as Export builds it, CE-057, and cleaned here once
 * more), title, slug, meta and page fields. A page's slug and meta are kept
 * on the draft. Each send is a content_draft_deliveries row (00262): queued
 * when reserved against the workspace's 200 a day, then sent or failed, and
 * published once the callback names the live address.
 *
 * One page is sent while the request waits; a bulk send (up to 25) goes on
 * in the background, one page after another, and the Library follows its
 * rows. A row a restarted server left queued is closed as interrupted by
 * the workspace's next send (reserve_content_deliveries).
 *
 * Phase 2: a page can go to the brand's Webflow collection instead (00283,
 * cms/webflowDelivery.js), as a draft item, to its WordPress site (00294,
 * cms/wordpressDelivery.js), as a draft post, to its Framer collection
 * (00295, cms/framerDelivery.js), as a draft item, or to its Wix site's
 * Blog (00372, cms/wixDelivery.js), as a draft post, under the same cap,
 * batches and delivery rows; a delivery says where it went (`target`).
 */

export const DELIVERY_EVENT = 'content_draft.sent';
export const PACKAGE_VERSION = 1;
/** Deliveries a workspace may send in 24 hours. */
export const DAILY_DELIVERIES = 200;
/** Pages one send may take. */
export const PAGES_PER_SEND = 25;
/** Between a batch's pages: a CMS's per-minute cap (#1331, "with a short pause"). */
export const PAUSE_MS = 2_000;
const MAX_HTML_CHARS = 1_000_000;
const EXCERPT_CHARS = 2000;

export const deliveryPage = z.object({
  draftId: z.guid(),
  title: z.string().trim().min(1).max(300),
  // As a URL's last segment: letters, digits, '-', '_' and single dots.
  slug: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .regex(/^(?!.*\.\.)[\p{L}\p{N}._-]+$/u),
  metaTitle: z.string().trim().max(300).default(''),
  metaDescription: z.string().trim().max(500).default(''),
  html: z.string().min(1).max(MAX_HTML_CHARS),
  author: z.string().trim().max(200).nullable().default(null),
  reviewer: z.string().trim().max(200).nullable().default(null),
  featuredImage: z
    .object({ src: z.url({ protocol: /^https$/ }).max(2048), alt: z.string().max(500) })
    .nullable()
    .default(null),
});

/**
 * Where pages go: the brand's webhook (phase 1), its Webflow collection, its
 * WordPress site, its Framer collection or its Wix site's Blog (phase 2).
 */
const DELIVERY_TARGETS = ['webhook', 'webflow', 'wordpress', 'framer', 'wix'];

export const sendInput = z.object({
  // guid, not uuid: brand ids aren't all RFC 4122 versions (seeded ones).
  brandId: z.guid(),
  pages: z.array(deliveryPage).min(1).max(PAGES_PER_SEND),
  target: z.enum(DELIVERY_TARGETS).default('webhook'),
});

/** A send that can't go, with the code the web names to the person. */
export class DeliveryError extends Error {
  /**
   * @param {'no_webhook'|'webhook_not_subscribed'|'webflow_not_configured'|'no_webflow'|
   *   'webflow_refused'|'webflow_not_ready'|'wordpress_not_configured'|'no_wordpress'|
   *   'wordpress_refused'|'framer_not_configured'|'no_framer'|'framer_refused'|
   *   'framer_not_ready'|'wix_not_configured'|'no_wix'|'wix_refused'|'in_progress'|
   *   'not_found'|'daily_limit'|'framer_site_publish'|'live_item'|'publish_refused'} code
   */
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/** Attributes that hold a URL. */
const URL_ATTRS = new Set([
  'href',
  'src',
  'xlink:href',
  'action',
  'formaction',
  'srcset',
  'poster',
  'cite',
]);
/** The schemes a published page's links may use; others are dropped. */
const SAFE_SCHEMES = new Set(['http', 'https', 'mailto', 'tel']);

/**
 * Whether a URL attribute may stay: http(s), mailto, tel or relative; a data:
 * image for an image's src. Browsers ignore tabs and newlines in a URL and
 * leading control characters, so they are taken out before its scheme is
 * read ("java&#9;script:" is javascript:).
 */
function safeUrl(value, { image }) {
  const bare = String(value)
    .replace(/[\t\n\r]/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/^[\x00-\x20]+/, '');
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(bare)?.[1]?.toLowerCase();
  if (!scheme) return true;
  if (scheme === 'data') return image && /^data:image\/(png|jpe?g|gif|webp|avif)[;,]/i.test(bare);
  return SAFE_SCHEMES.has(scheme);
}

/**
 * The page's HTML once more on the server, as a second guard behind the
 * browser's (DOMPurify, CE-057): no script but JSON-LD, no frames, forms,
 * document-level tags or SVG animation (which can set a link), no event
 * handlers, and links only to the schemes a page needs (safeUrl).
 */
/** A script that holds JSON-LD, its type written however the page wrote it. */
const isJsonLd = ($, el) =>
  ($(el).attr('type') ?? '').trim().toLowerCase() === 'application/ld+json';

export function cleanPublishHtml(html) {
  const $ = cheerio.load(html, null, false);
  $('script').each((_, el) => {
    if (!isJsonLd($, el)) $(el).remove();
  });
  $(
    'iframe, frame, frameset, object, embed, applet, form, base, meta, link, style, animate, set, animateMotion, animateTransform',
  ).remove();
  $('*').each((_, el) => {
    for (const [name, value] of Object.entries(el.attribs ?? {})) {
      const attr = name.toLowerCase();
      if (attr.startsWith('on')) {
        $(el).removeAttr(name);
      } else if (URL_ATTRS.has(attr)) {
        const image = attr === 'src' && el.tagName?.toLowerCase() === 'img';
        if (!safeUrl(value, { image })) $(el).removeAttr(name);
      }
    }
  });
  return $.html();
}

/** `sha256=<hex>`: the body signed with the webhook's secret, for X-GetCito-Signature. */
export function signBody(secret, body) {
  return `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;
}

function serverUrl() {
  return process.env.PUBLIC_SERVER_URL || `http://localhost:${process.env.PORT || 3001}`;
}

/** The JSON-LD in a page's cleaned HTML: a CMS's rich-text field drops <script>. */
function jsonLdOf(html) {
  const $ = cheerio.load(html, null, false);
  return $('script')
    .toArray()
    .filter((el) => isJsonLd($, el))
    .flatMap((el) => {
      try {
        return [JSON.parse($(el).text())];
      } catch {
        return [];
      }
    });
}

/**
 * The package a page goes as (schemaVersion 1). The callback is offered only
 * to a webhook with a secret: the secret is what authenticates it. What the
 * draft is (method, live address, page type, language) comes from its row,
 * not the browser: an optimized page's workflow updates its post.
 */
export function contentPackage({ delivery, page, brand, html, jsonLd, callback = true }) {
  return {
    event: DELIVERY_EVENT,
    schemaVersion: PACKAGE_VERSION,
    delivery: {
      id: delivery.id,
      batchId: delivery.batch_id ?? null,
      sentAt: new Date().toISOString(),
    },
    page: {
      draftId: page.draftId,
      title: page.title,
      slug: page.slug,
      metaTitle: page.metaTitle || page.title,
      metaDescription: page.metaDescription,
      html,
      jsonLd: jsonLd ?? jsonLdOf(html),
      author: page.author,
      reviewer: page.reviewer,
      featuredImage: page.featuredImage,
      method: page.method ?? null,
      sourceUrl: page.sourceUrl ?? null,
      pageType: page.pageType ?? null,
      language: page.language ?? null,
    },
    brand: { id: brand.id, name: brand.name, domain: brand.domain, industry: brand.industry },
    callback_url: callback ? `${serverUrl()}/webhooks/content-drafts/${delivery.id}/status` : null,
    callback_method: callback ? 'POST' : null,
  };
}

async function webhooksFor(brandId) {
  const { data, error } = await supabaseAdmin
    .from('webhook_configs')
    .select('id, webhook_url, webhook_secret, events')
    .eq('brand_id', brandId)
    .eq('is_active', true);
  if (error) throw new Error(error.message);
  const configs = data ?? [];
  if (!configs.length) {
    throw new DeliveryError('no_webhook', 'No workflow connected', 409);
  }
  const subscribed = configs.filter((c) => c.events?.includes(DELIVERY_EVENT));
  if (!subscribed.length) {
    throw new DeliveryError(
      'webhook_not_subscribed',
      'Webhook is not subscribed to Content page sent events.',
      409,
    );
  }
  return subscribed;
}

/** The brand's Webflow connection, ready to take pages (a collection with a body field). */
async function webflowFor(brandId) {
  if (!isWebflowConfigured()) {
    throw new DeliveryError('webflow_not_configured', 'Webflow is not set up on this server.', 503);
  }
  const { data, error } = await supabaseAdmin
    .from('brand_cms_connections')
    .select('brand_id, composio_account_id, composio_entity_id, status, collection_id, field_map')
    .eq('brand_id', brandId)
    .eq('provider', 'webflow')
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) {
    throw new DeliveryError('no_webflow', 'Connect Webflow in Settings › Integrations.', 409);
  }
  if (data.status === 'auth_failed') {
    throw new DeliveryError(
      'webflow_refused',
      'Webflow refused the site token. Connect it again in Settings › Integrations.',
      409,
    );
  }
  if (!data.collection_id || !data.field_map?.body) {
    throw new DeliveryError(
      'webflow_not_ready',
      'Pick the Webflow collection pages go to in Settings › Integrations.',
      409,
    );
  }
  return data;
}

/** The brand's WordPress connection, its sign-in kept by the API (00294). */
async function wordpressFor(brandId) {
  if (!credentialsConfigured()) {
    throw new DeliveryError(
      'wordpress_not_configured',
      'WordPress is not set up on this server.',
      503,
    );
  }
  const { data, error } = await supabaseAdmin
    .from('brand_cms_connections')
    .select('id, brand_id, status, site_url, updated_at')
    .eq('brand_id', brandId)
    .eq('provider', 'wordpress')
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) {
    throw new DeliveryError('no_wordpress', 'Connect WordPress in Settings › Integrations.', 409);
  }
  if (data.status === 'auth_failed') {
    throw new DeliveryError(
      'wordpress_refused',
      'WordPress refused the sign-in. Connect it again in Settings › Integrations.',
      409,
    );
  }
  return data;
}

/**
 * The brand's Framer connection (00295), its key kept by the API, ready to
 * take pages: a collection with its title and body fields.
 */
async function framerFor(brandId) {
  if (!credentialsConfigured()) {
    throw new DeliveryError('framer_not_configured', 'Framer is not set up on this server.', 503);
  }
  const { data, error } = await supabaseAdmin
    .from('brand_cms_connections')
    .select('id, brand_id, status, site_id, collection_id, field_map, updated_at')
    .eq('brand_id', brandId)
    .eq('provider', 'framer')
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) {
    throw new DeliveryError('no_framer', 'Connect Framer in Settings › Integrations.', 409);
  }
  if (data.status === 'auth_failed') {
    throw new DeliveryError(
      'framer_refused',
      'Framer refused the API key. Connect it again in Settings › Integrations.',
      409,
    );
  }
  if (!data.collection_id || !data.field_map?.title || !data.field_map?.body) {
    throw new DeliveryError(
      'framer_not_ready',
      'Pick the Framer collection and its fields in Settings › Integrations.',
      409,
    );
  }
  return data;
}

/** The brand's Wix connection, its API key kept by the API (00372). */
async function wixFor(brandId) {
  if (!credentialsConfigured()) {
    throw new DeliveryError('wix_not_configured', 'Wix is not set up on this server.', 503);
  }
  const { data, error } = await supabaseAdmin
    .from('brand_cms_connections')
    .select('id, brand_id, status, site_id, account, updated_at')
    .eq('brand_id', brandId)
    .eq('provider', 'wix')
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) {
    throw new DeliveryError('no_wix', 'Connect Wix in Settings › Integrations.', 409);
  }
  if (data.status === 'auth_failed') {
    throw new DeliveryError(
      'wix_refused',
      'Wix refused the API key. Connect it again in Settings › Integrations.',
      409,
    );
  }
  return data;
}

/** A CMS a page goes to itself, not through the webhook: its connection, and how a page is sent. */
const NATIVE = {
  webflow: { label: 'Webflow', connect: webflowFor, send: sendToWebflow },
  wordpress: { label: 'WordPress', connect: wordpressFor, send: sendToWordPress },
  framer: { label: 'Framer', connect: framerFor, send: sendToFramer },
  wix: { label: 'Wix', connect: wixFor, send: sendToWix },
};

/**
 * The brand's connection to a CMS a page goes to itself, as a send reads it
 * (lib/cmsPublish.js publishes on it). DeliveryError when it isn't set up,
 * connected or working.
 */
export function cmsConnectionFor(brandId, target) {
  const native = NATIVE[target];
  if (!native) throw new DeliveryError('not_found', 'This CMS isn’t one a page is sent to.', 404);
  return native.connect(brandId);
}

async function brandFor(brandId) {
  const [{ data: brand }, { data: domains }] = await Promise.all([
    supabaseAdmin
      .from('brands')
      .select('id, name, industry, language, site_type, shopping_mode_enabled')
      .eq('id', brandId)
      .single(),
    supabaseAdmin
      .from('brand_domains')
      .select('domain')
      .eq('brand_id', brandId)
      .eq('is_primary', true)
      .limit(1),
  ]);
  return {
    id: brand?.id ?? brandId,
    name: brand?.name ?? '',
    domain: domains?.[0]?.domain ?? '',
    industry: brand?.industry ?? '',
    language: brand?.language ?? null,
    // Its kind of site, as the editor keys My rules by it; null when unread.
    siteType: brand ? brandSiteType(brand) : null,
  };
}

/**
 * The page to the brand's webhooks: taken once any of them takes it (with
 * that one's answer), else the last answer and reason.
 */
async function sendToWebhooks({ delivery, page, brand, html, jsonLd, configs }) {
  let taken = null;
  let last = null;
  let failure = null;
  for (const config of configs) {
    const signed = Boolean(config.webhook_secret);
    const body = JSON.stringify(
      contentPackage({ delivery, page, brand, html, jsonLd, callback: signed }),
    );
    const headers = {};
    if (signed) {
      // The secret as the other webhooks send it, and the body signed with it.
      headers['X-Webhook-Secret'] = config.webhook_secret;
      headers['X-GetCito-Signature'] = signBody(config.webhook_secret, body);
    }
    try {
      const res = await postJson(config.webhook_url, body, { headers });
      last = res;
      if (res.status >= 200 && res.status < 300) taken ??= res;
      else failure = `The webhook answered ${res.status}`;
    } catch (err) {
      failure = err instanceof PageFetchError ? err.message : 'The webhook could not be reached';
      logger.warn(
        { err, configId: config.id, deliveryId: delivery.id },
        '[content-delivery] send failed',
      );
    }
  }
  const answered = taken ?? last;
  return {
    taken: Boolean(taken),
    failure,
    fields: {
      http_status: answered?.status ?? null,
      response_excerpt: answered?.answer ? answered.answer.slice(0, EXCERPT_CHARS) : null,
    },
  };
}

/**
 * Sends one queued delivery, to the brand's webhooks or its CMS (a Webflow
 * or Framer collection, a WordPress site), and writes how it went: sent, or
 * failed with the reason. A Webflow or Framer item's or WordPress post's id,
 * and its collection or site, are kept on the delivery, so the page's next
 * send updates it. A webhook's callback can land before the
 * webhook answers (an automation that publishes, or fails, first): then the
 * delivery keeps what the callback said, and that is what comes back.
 */
async function deliver({ delivery, page, brand, configs, native }) {
  const html = cleanPublishHtml(page.html);
  const jsonLd = jsonLdOf(html);
  const sent = native
    ? await native.send({ delivery, page, html, jsonLd, connection: native.connection })
    : await sendToWebhooks({ delivery, page, brand, html, jsonLd, configs });
  const update = {
    status: sent.taken ? 'sent' : 'failed',
    ...(sent.fields ?? { http_status: null, response_excerpt: null }),
    error: sent.taken ? null : (sent.failure ?? 'Not sent').slice(0, 500),
    sent_at: new Date().toISOString(),
    ...(sent.externalId
      ? { external_id: sent.externalId, target_collection: sent.collectionId }
      : {}),
  };
  // How the CMS took it, for the one page's answer (and the batch); not kept.
  // live: WordPress had the page's post live, so a new draft was made;
  // Framer's item updated isn't a draft, so it goes live with the site's next publish.
  const how = native
    ? sent.taken
      ? { updated: sent.updated, changed: sent.changed, live: sent.live }
      : { refused: Boolean(sent.refused) }
    : {};
  const { data: written, error } = await supabaseAdmin
    .from('content_draft_deliveries')
    .update(update)
    .eq('id', delivery.id)
    .eq('status', 'queued')
    .select('id');
  if (sent.externalId && (error || (written && !written.length))) {
    // The item (or post) is in the CMS whatever the row says: its id is
    // kept, or the page's next send makes a second one (Webflow refusing it
    // on its slug).
    const { error: idError } = await supabaseAdmin
      .from('content_draft_deliveries')
      .update({ external_id: sent.externalId, target_collection: sent.collectionId })
      .eq('id', delivery.id);
    if (idError) {
      logger.error(
        { err: idError, deliveryId: delivery.id },
        '[content-delivery] item id not kept',
      );
    }
  }
  if (error) {
    logger.error({ err: error, deliveryId: delivery.id }, '[content-delivery] write failed');
  } else if (written && !written.length) {
    // A callback had its word first.
    const { data: told } = await supabaseAdmin
      .from('content_draft_deliveries')
      .select('status, error, published_url')
      .eq('id', delivery.id)
      .maybeSingle();
    if (told) return { id: delivery.id, draftId: page.draftId, ...update, ...told, ...how };
  }
  return { id: delivery.id, draftId: page.draftId, ...update, ...how };
}

/** A queued delivery that doesn't go, closed as failed with the reason. */
async function closeQueued(delivery, reason) {
  const { error } = await supabaseAdmin
    .from('content_draft_deliveries')
    .update({ status: 'failed', error: reason, sent_at: new Date().toISOString() })
    .eq('id', delivery.id)
    .eq('status', 'queued');
  if (error) {
    logger.error({ err: error, deliveryId: delivery.id }, '[content-delivery] write failed');
  }
}

/**
 * The batch's pages, one after another; one deleted or archived before its
 * turn doesn't go, and once the CMS refuses the sign-in, the rest don't either.
 */
async function deliverBatch(going, { brand, configs, native, batchId }) {
  let refused = null;
  for (const [i, item] of going.entries()) {
    if (refused) {
      await closeQueued(item.delivery, refused).catch(() => {});
      continue;
    }
    // A short pause between pages, none before the first.
    if (i > 0) await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));
    try {
      const { data: still } = await supabaseAdmin
        .from('content_drafts')
        .select('id')
        .eq('id', item.page.draftId)
        .is('archived_at', null)
        .maybeSingle();
      if (!still) {
        await closeQueued(item.delivery, 'The page was deleted or archived before it was sent');
        continue;
      }
      const sent = await deliver({ ...item, brand, configs, native });
      if (sent.refused) refused = sent.error ?? `${native?.label ?? 'The CMS'} refused the sign-in`;
    } catch (err) {
      logger.error(
        { err, batchId, deliveryId: item.delivery.id },
        '[content-delivery] send crashed',
      );
      await closeQueued(item.delivery, 'Not sent: something went wrong').catch(() => {});
    }
  }
}

/** A draft no one has set rules on: the workspace's My rules apply (rules.ts effectiveRules). */
const untouched = untouchedRules;

/**
 * The workspace's My rules (00214) for these drafts' types and the brand's
 * kind of site (00227 keys a set by both, as the editor reads it), by type;
 * none when unread, the brand's kind of site too (brandFor): never another
 * kind's set.
 */
async function myRuleSets(orgId, siteType, drafts) {
  const types = [...new Set(drafts.map((d) => d.rules?.set ?? d.page_type).filter(Boolean))];
  if (!types.length || !siteType) return new Map();
  const { data, error } = await supabaseAdmin
    .from('content_rule_sets')
    .select('page_type, overrides')
    .eq('organization_id', orgId)
    .eq('site_type', siteType)
    .in('page_type', types);
  if (error) logger.warn({ err: error }, '[content-delivery] My rules not read');
  return new Map((data ?? []).map((set) => [set.page_type, set]));
}

/**
 * Sends pages of one brand: checks they are the brand's (not archived), that
 * a webhook takes the event (or the brand's Webflow or Framer collection is
 * ready, or its WordPress site connected, for those targets), reserves them against the day's cap (those past
 * it don't go), keeps each page's slug and meta on its draft, then sends
 * them. One page is sent before this returns; more go on in the background,
 * so a CMS isn't sent 25 posts at once.
 *
 * `agentRunId`: the agent run that sends on its own (00444), kept on each
 * delivery; `userId` is then the person the run acts as.
 *
 * @returns {Promise<{ batchId: string|null, deliveries: object[], skipped: number }>}
 *   deliveries: the sent one (one page) or the queued ones (more); skipped:
 *   pages past the day's cap
 */
export async function sendContentPages({
  orgId,
  brandId,
  userId,
  pages: asked,
  target = 'webhook',
  agentRunId = null,
}) {
  // A page named twice goes once.
  const byId = new Map(asked.map((p) => [p.draftId, p]));
  const pages = [...byId.values()];
  const ids = [...byId.keys()];
  const { data: drafts, error } = await supabaseAdmin
    .from('content_drafts')
    .select('id, method, source_url, page_type, rules')
    .eq('brand_id', brandId)
    .is('archived_at', null)
    .in('id', ids);
  if (error) throw new Error(error.message);
  if ((drafts ?? []).length !== ids.length) {
    throw new DeliveryError('not_found', 'A page to send is not in this brand', 404);
  }
  const cms = NATIVE[target] ?? null;
  const native = cms ? { ...cms, connection: await cms.connect(brandId) } : null;
  const configs = native ? [] : await webhooksFor(brandId);

  const batchId = pages.length > 1 ? crypto.randomUUID() : null;
  const { data: queued, error: reserveError } = await supabaseAdmin.rpc(
    'reserve_content_deliveries',
    {
      p_organization_id: orgId,
      p_brand_id: brandId,
      p_sent_by: userId,
      p_batch_id: batchId,
      p_items: pages.map((p) => ({ draft_id: p.draftId, title: p.title, slug: p.slug })),
      p_limit: DAILY_DELIVERIES,
      p_target: target,
    },
  );
  if (reserveError) {
    // 00284, 00294, 00295: a page already on its way to the CMS isn't sent there again meanwhile.
    if (/delivery_in_progress/.test(reserveError.message ?? '')) {
      throw new DeliveryError(
        'in_progress',
        `A page is already being sent to ${cms?.label ?? 'the CMS'}. Wait for it, then send again.`,
        409,
      );
    }
    throw new Error(reserveError.message);
  }
  const rows = queued ?? [];
  if (!rows.length) {
    throw new DeliveryError(
      'daily_limit',
      `This workspace has sent ${DAILY_DELIVERIES} pages in the last 24 hours. Try again later.`,
      429,
    );
  }
  if (agentRunId) {
    // Before it goes: the Library and the ship event read who sent it from the row.
    // Not kept, it still goes: its go-live step names the delivery too.
    const { error: agentError } = await supabaseAdmin
      .from('content_draft_deliveries')
      .update({ agent_run_id: agentRunId })
      .in(
        'id',
        rows.map((row) => row.id),
      );
    if (agentError) {
      logger.warn({ err: agentError }, '[content-delivery] agent run not kept on the send');
    }
  }

  // The reserved pages, in the order they go; their slug and meta stay on the draft.
  const order = new Map(ids.map((id, i) => [id, i]));
  const going = rows
    .map((row) => ({ delivery: row, page: byId.get(row.draft_id) }))
    .sort((a, b) => order.get(a.page.draftId) - order.get(b.page.draftId));
  const kept = await Promise.all(
    going.map(({ page }) =>
      supabaseAdmin
        .from('content_drafts')
        .update({
          slug: page.slug,
          meta_title: page.metaTitle || null,
          meta_description: page.metaDescription || null,
        })
        .eq('id', page.draftId),
    ),
  );
  for (const result of kept) {
    if (result?.error)
      logger.warn({ err: result.error }, '[content-delivery] slug and meta not kept');
  }

  // What each draft is, from its row: method, live address, page type, and
  // the language its Language rule names (its own, or the workspace's My
  // rules for a draft no one has set rules on, as the editor reads them),
  // else the brand's.
  const rowOf = new Map((drafts ?? []).map((d) => [d.id, d]));
  // The brand once: its kind of site keys My rules.
  const brand = await brandFor(brandId);
  const mine = await myRuleSets(
    orgId,
    brand.siteType,
    going.map((item) => rowOf.get(item.page.draftId)).filter((d) => d && untouched(d.rules)),
  );
  for (const item of going) {
    const draft = rowOf.get(item.page.draftId) ?? {};
    const rules = untouched(draft.rules)
      ? mine.get(draft.rules?.set ?? draft.page_type)
      : draft.rules;
    item.page = {
      ...item.page,
      method: draft.method ?? null,
      sourceUrl: draft.source_url ?? null,
      pageType: draft.page_type ?? null,
      language: rulesLanguage(rules, brand.language) || 'en',
    };
  }
  if (pages.length === 1) {
    const sent = await deliver({ ...going[0], brand, configs, native });
    return { batchId, deliveries: [sent], skipped: 0 };
  }
  void deliverBatch(going, { brand, configs, native, batchId });
  return {
    batchId,
    deliveries: rows.map((r) => ({ id: r.id, draftId: r.draft_id, status: r.status })),
    skipped: pages.length - rows.length,
  };
}
