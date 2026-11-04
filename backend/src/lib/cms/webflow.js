import { executeWebflowTool } from '../composio.js';

/**
 * Webflow for Send to CMS (#1331, phase 2): a brand's site, its collections
 * and their fields, read through Composio with the brand's site token
 * (composio.js), and which of a collection's fields takes each part of a
 * page. An item's name and slug always go to Webflow's own `name` and
 * `slug`; the rest is the brand's field map (brand_cms_connections, 00283).
 */

/** The parts of a page a field map places, and the field types each may go to. */
const PART_TYPES = {
  body: ['RichText'],
  metaTitle: ['PlainText'],
  metaDescription: ['PlainText'],
  jsonLd: ['PlainText'],
  reviewer: ['PlainText'],
  date: ['DateTime'],
};
const PAGE_PARTS = Object.keys(PART_TYPES);
/**
 * Webflow's own fields: every item has them. Send to CMS always fills its
 * name and slug; Webflow keeps its dates (getCollection leaves them out, as
 * they aren't editable).
 */
const OWN_FIELDS = new Set(['name', 'slug', 'created-on', 'updated-on', 'published-on']);

/** A Webflow call that didn't go, with the code the web names to the person. */
export class WebflowError extends Error {
  /** @param {'auth_failed'|'missing_scopes'|'no_access'|'not_found'|'slug_taken'|'invalid'|'failed'} code */
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** Webflow's words for a token without the scopes asked. */
const MISSING_SCOPES = /missing[_ ]scopes?/i;
/** The brand's account gone at Composio: connected again, it works. */
const ACCOUNT_GONE = /connected[_ ]?account[_ ]?not[_ ]?found/i;
/** A token Webflow refuses: a 401, never a 403 (a site or collection the token doesn't reach). */
const REFUSED = /\b401\b|unauthori[sz]ed|not[_ ]authori[sz]ed|invalid[_ ](api[_ ])?(token|key)/i;
const FORBIDDEN = /\b403\b|forbidden/i;
const NOT_FOUND = /\b404\b|not[_ ]found/i;
/** An item Webflow won't take: its slug another item's, or a field's value. */
const SLUG_TAKEN =
  /slug[\s\S]{0,80}(unique|already|duplicate|taken|exists)|(unique|already|duplicate|taken|exists)[\s\S]{0,80}slug/i;
const INVALID = /\b(400|409|422)\b|validation|invalid[_ ](field|value|request)/i;

/**
 * A Webflow tool's data. What went wrong is told in our words only: the
 * error Composio passes on is read, never shown or logged, since it may
 * quote the request. Only a refused token (or the brand's account gone)
 * is auth_failed, which asks the person to connect again.
 */
async function run(slug, account, args) {
  try {
    return await executeWebflowTool(slug, account, args);
  } catch (err) {
    const said = `${err?.name ?? ''} ${err?.message ?? ''}`;
    if (MISSING_SCOPES.test(said)) {
      throw new WebflowError(
        'missing_scopes',
        'The site token needs the Sites (read) and CMS (read and write) scopes',
      );
    }
    if (ACCOUNT_GONE.test(said) || REFUSED.test(said)) {
      throw new WebflowError('auth_failed', 'Webflow refused the site token');
    }
    if (FORBIDDEN.test(said)) {
      throw new WebflowError('no_access', 'The site token doesn’t reach this site or collection');
    }
    if (NOT_FOUND.test(said)) {
      throw new WebflowError('not_found', 'Webflow has no such site or collection');
    }
    if (SLUG_TAKEN.test(said)) {
      throw new WebflowError(
        'slug_taken',
        'Another Webflow item has this slug. Change the page’s slug, or remove that item in Webflow.',
      );
    }
    if (INVALID.test(said)) {
      throw new WebflowError(
        'invalid',
        'Webflow refused the item: a field doesn’t take what was sent',
      );
    }
    throw new WebflowError('failed', 'Webflow could not be reached');
  }
}

/** The list a Webflow answer holds under `key`, however Composio wraps it. */
function listOf(data, key) {
  for (const value of [data?.[key], data?.response_data?.[key], data?.data?.[key], data]) {
    if (Array.isArray(value)) return value;
  }
  return [];
}

/** The object a Webflow answer is, however Composio wraps it. */
const objectOf = (data) => data?.response_data ?? data?.data ?? data ?? {};

const text = (value, max = 300) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

const HOST =
  /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i;

/**
 * The host a site's pages live on: the custom domain published to last,
 * else its webflow.io address (a site published only there), else its
 * first custom domain; null when Webflow names none.
 */
function siteHost(site) {
  const domains = (Array.isArray(site.customDomains) ? site.customDomains : [])
    .map((d) => ({
      host: text(d?.url)
        .replace(/^https?:\/\//i, '')
        .replace(/\/.*$/, '')
        .toLowerCase(),
      at: Date.parse(d?.lastPublished ?? '') || 0,
    }))
    .filter((d) => HOST.test(d.host));
  const published = domains.filter((d) => d.at).sort((a, b) => b.at - a.at)[0];
  if (published) return published.host;
  const short = text(site.shortName).toLowerCase();
  if (short && HOST.test(`${short}.webflow.io`)) return `${short}.webflow.io`;
  return domains[0]?.host ?? null;
}

/** The sites the token reaches (a site token reaches its own), with the host their pages live on. */
export async function listSites(account) {
  const data = await run('WEBFLOW_LIST_WEBFLOW_SITES', account, {});
  return listOf(data, 'sites')
    .filter((site) => typeof site?.id === 'string' && site.id)
    .map((site) => ({
      id: site.id,
      name: text(site.displayName) || text(site.shortName) || site.id,
      host: siteHost(site),
    }));
}

/** A site's CMS collections. */
export async function listCollections(account, siteId) {
  const data = await run('WEBFLOW_LIST_COLLECTIONS', account, { site_id: siteId });
  return listOf(data, 'collections')
    .filter((c) => typeof c?.id === 'string' && c.id)
    .map((c) => ({
      id: c.id,
      name: text(c.displayName) || text(c.slug) || c.id,
      slug: text(c.slug),
    }));
}

/** A collection's fields a person can fill: slug, name, type and whether it's required. */
export async function getCollection(account, collectionId) {
  const collection = objectOf(
    await run('WEBFLOW_GET_COLLECTION', account, { collection_id: collectionId }),
  );
  const fields = (Array.isArray(collection.fields) ? collection.fields : [])
    .filter((f) => typeof f?.slug === 'string' && f.slug && f.isEditable !== false)
    .map((f) => ({
      slug: f.slug,
      name: text(f.displayName) || f.slug,
      type: typeof f.type === 'string' ? f.type : '',
      required: f.isRequired === true,
    }));
  return {
    id: typeof collection.id === 'string' && collection.id ? collection.id : collectionId,
    name: text(collection.displayName) || text(collection.slug) || collectionId,
    fields,
  };
}

/**
 * An item as Webflow has it: its slug, whether it's live (published, not a
 * draft, not archived), when it was last published, and which of its fields
 * hold a value (by slug). Null when it's gone.
 */
export async function getItem(account, collectionId, itemId) {
  let item;
  try {
    item = objectOf(
      await run('WEBFLOW_GET_COLLECTION_ITEM', account, {
        collection_id: collectionId,
        item_id: itemId,
      }),
    );
  } catch (err) {
    if (err instanceof WebflowError && err.code === 'not_found') return null;
    throw err;
  }
  if (item?.item) item = item.item;
  const fields = item.fieldData ?? item.field_data ?? {};
  const lastPublished = typeof item.lastPublished === 'string' ? item.lastPublished : null;
  return {
    id: typeof item.id === 'string' && item.id ? item.id : itemId,
    slug: text(fields.slug, 256),
    live: Boolean(lastPublished) && item.isDraft !== true && item.isArchived !== true,
    lastPublished,
    filledFields: Object.keys(fields).filter((key) => fields[key] != null && fields[key] !== ''),
  };
}

/** An item's id from Webflow's answer, however Composio wraps it. */
function itemIdOf(data) {
  const item = objectOf(data);
  const id = item?.id ?? item?.item?.id ?? item?.items?.[0]?.id;
  if (typeof id !== 'string' || !id) throw new WebflowError('failed', 'Webflow gave no item back');
  return id;
}

/** A new item in the collection, as a draft: Webflow's own publish puts it live. Its id. */
export async function createItem(account, collectionId, fieldData) {
  const data = await run('WEBFLOW_CREATE_COLLECTION_ITEM', account, {
    collection_id: collectionId,
    field_data: fieldData,
    is_draft: true,
  });
  return itemIdOf(data);
}

/**
 * The item's fields written again. Its draft or live state is left as it is:
 * a live item's change waits for Webflow's next publish. Its id.
 */
export async function updateItem(account, collectionId, itemId, fieldData) {
  const data = await run('WEBFLOW_UPDATE_COLLECTION_ITEM_V2', account, {
    collection_id: collectionId,
    item_id: itemId,
    fieldData,
  });
  try {
    return itemIdOf(data);
  } catch {
    return itemId;
  }
}

/**
 * Puts an item live (AUTONOMOUS-GO-LIVE PR 9): out of draft, then published
 * on its own, so other staged items of the site stay staged. Its id.
 */
export async function publishItem(account, collectionId, itemId) {
  await run('WEBFLOW_UPDATE_COLLECTION_ITEM_V2', account, {
    collection_id: collectionId,
    item_id: itemId,
    isDraft: false,
  });
  await run('WEBFLOW_PUBLISH_COLLECTION_ITEMS', account, {
    collection_id: collectionId,
    item_ids: [itemId],
  });
  return itemId;
}

/**
 * Takes a live item down (AUTONOMOUS-GO-LIVE PR 10): Webflow unpublishes it
 * from the live site and sets it back to a draft. Its id.
 */
export async function unpublishItem(account, collectionId, itemId) {
  await run('WEBFLOW_UNPUBLISH_LIVE_COLLECTION_ITEM', account, {
    collection_id: collectionId,
    item_id: itemId,
  });
  return itemId;
}

/** The words a field's slug or name is read for, by part: the first field that has them is suggested. */
const HINTS = {
  body: [/(^|-)(post-)?body($|-)/, /content/, /article/, /rich/],
  metaTitle: [/(meta|seo)-?title/],
  metaDescription: [/(meta|seo)-?desc/, /summary/, /excerpt/, /description/],
  jsonLd: [/json-?ld/, /schema/, /structured/],
  reviewer: [/reviewed?-?by/, /reviewer/],
  date: [/publish/, /\bdate\b/, /\bposted\b/],
};

/**
 * The field map a collection's fields suggest: for each part, the first
 * field of a type it may go to whose slug (or name) reads as that part, one
 * field a part; a page's body falls back to the collection's first rich text.
 * The date goes only to a date the collection requires: the one that reads
 * as a date, else its only one.
 */
export function suggestFieldMap(fields) {
  const map = {};
  const taken = new Set();
  const words = (f) => `${f.slug} ${f.name.toLowerCase().replace(/\s+/g, '-')}`;
  for (const part of PAGE_PARTS) {
    const fits = fields.filter(
      (f) =>
        PART_TYPES[part].includes(f.type) &&
        !OWN_FIELDS.has(f.slug) &&
        !taken.has(f.slug) &&
        (part !== 'date' || f.required),
    );
    let pick = null;
    for (const hint of HINTS[part]) {
      pick = fits.find((f) => hint.test(words(f)));
      if (pick) break;
    }
    if (!pick && part === 'body') pick = fits[0] ?? null;
    if (!pick && part === 'date' && fits.length === 1) pick = fits[0];
    if (pick) {
      map[part] = pick.slug;
      taken.add(pick.slug);
    }
  }
  return map;
}

/**
 * The parts every page has: its meta title falls back to its title, its
 * meta description to its opening words, and its date is the day it's first
 * sent. A page may have no JSON-LD, so that field can't be one the
 * collection requires.
 */
const ALWAYS_FILLED = new Set(['body', 'metaTitle', 'metaDescription', 'date']);

/**
 * Whether a field map fits the collection: a page's body has a rich text
 * field, each part a field of its own of a type it may go to, and every
 * field the collection requires is one Send to CMS always fills.
 *
 * @returns {{ ok: true, map: Record<string, string> } | { ok: false, problems: string[] }}
 */
export function checkFieldMap(fieldMap, fields) {
  const bySlug = new Map(fields.map((f) => [f.slug, f]));
  const problems = [];
  const map = {};
  const used = new Set();
  for (const part of PAGE_PARTS) {
    const slug = fieldMap?.[part];
    if (slug === undefined || slug === null || slug === '') continue;
    const field = bySlug.get(slug);
    if (!field || OWN_FIELDS.has(slug)) {
      problems.push(`${part}: the collection has no field "${String(slug).slice(0, 100)}"`);
    } else if (!PART_TYPES[part].includes(field.type)) {
      problems.push(
        `${part}: ${field.name} is ${field.type || 'another type'}, not ${PART_TYPES[part].join(' or ')}`,
      );
    } else if (used.has(slug)) {
      problems.push(`${part}: ${field.name} already takes another part`);
    } else {
      map[part] = slug;
      used.add(slug);
    }
  }
  if (!map.body && !problems.some((p) => p.startsWith('body:'))) {
    problems.push('body: pick the rich text field a page goes to');
  }
  const filled = new Set(
    Object.entries(map)
      .filter(([part]) => ALWAYS_FILLED.has(part))
      .map(([, slug]) => slug),
  );
  const unfilled = fields.filter(
    (f) => f.required && !OWN_FIELDS.has(f.slug) && !filled.has(f.slug),
  );
  if (unfilled.length) {
    problems.push(
      `The collection requires ${unfilled.map((f) => f.name).join(', ')}, which Send to CMS doesn’t fill: make ${unfilled.length === 1 ? 'it' : 'them'} optional in Webflow, or pick another collection`,
    );
  }
  return problems.length ? { ok: false, problems } : { ok: true, map };
}
