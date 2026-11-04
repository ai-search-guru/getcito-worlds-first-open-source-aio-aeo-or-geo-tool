import * as cheerio from 'cheerio';
import supabaseAdmin from '../config/supabase.js';
import { openActionProducts, syncShoppingLinksAction } from './action-center/fromShoppingCheck.js';
import { isBrandActive } from './activeSubscriptions.js';
import { onBrandDomain } from './audit/host.js';
import { brandSite } from './catalog/categoryPages.js';
import { isInStock } from './catalog/stock.js';
import { selectInChunks } from './chunkedIn.js';
import { linkKey } from './contentLinks.js';
import { logger } from './logger.js';
import { readAllRpcRows } from './rpcPages.js';
import { fetchPage } from './safeFetch.js';
import { readIn, readShoppingPath, refuses } from './shoppingPath.js';

/**
 * Whether a page's shopping links still sell (shopping path, part 7, 00352).
 *
 * After each catalog sync, every draft of the brand with a shopping path is
 * read again: the live page where it is published, else the draft. Its links
 * are matched to the path's category pages and products (by link-targets'
 * key, as the editor's Rules and Before you publish match them), and each
 * linked product is read as the catalog has it now: sold out (no variant in
 * stock), refused (Merchant Center refuses every variant in stock in its free
 * listings) or gone from the catalog. What it finds is kept per draft in
 * content_shopping_checks, for the Content Library's Shopping path column.
 * A live page that links one that no longer sells gets a Fix action in the
 * Action Center, closed by the check that finds it fixed
 * (action-center/fromShoppingCheck.js).
 *
 * A live page is read only on the brand's site (brandSite), and only when
 * it reads as the page: one with fewer than MIN_WORDS words (an empty
 * shell, bot protection's page), or that links none of the path while its
 * draft does, is read from its draft instead.
 *
 * Only the path's products are checked: a product linked by hand from
 * outside the path isn't known to be one.
 */

/** Drafts read a request: their HTML comes with them. */
export const DRAFT_BATCH = 50;
/** The most drafts with a path a brand's check reads, in id order. */
export const MAX_DRAFTS = 1000;
/** Live pages one check reads at most, one at a time; the rest are read from their draft. */
export const MAX_LIVE_PAGES = 50;
/** A live page's read: its links are in its first megabyte. */
const PAGE_TIMEOUT_MS = 10_000;
const PAGE_BYTES = 1024 * 1024;
/**
 * A live page with fewer words than this isn't the page: an empty shell, or
 * bot protection's (as the Action Center's automatic checks read one).
 */
export const MIN_WORDS = 20;
/** A check stops reading live pages after this, and reads the rest from their drafts. */
export const LIVE_PAGES_DEADLINE_MS = 3 * 60 * 1000;
/** New Action Center actions one check opens at most: the rest wait for the next sync. */
export const MAX_NEW_ACTIONS = 5;

/** A link longer than this isn't read: no page's address is (as content_drafts caps its own). */
export const MAX_HREF_CHARS = 2048;

const TITLE_CHARS = 200;
const MAX_BAD = 40;
/** The path's products that sell and the page doesn't link, named to swap in. */
const MAX_SWAPS = 5;

/**
 * Every link's address in a page's HTML, and in the HTML blocks the editor
 * keeps base64-encoded (`div[data-html-block]`, a product grid among them).
 * A relative address is read against `base`, the live page's own; without
 * one it is dropped, as a draft's links are full addresses. A link longer
 * than MAX_HREF_CHARS is dropped too.
 */
export function pageHrefs(html, base = null) {
  const hrefs = [];
  const read = (markup, nested) => {
    const $ = cheerio.load(markup);
    $('a[href]').each((_, a) => {
      const href = String($(a).attr('href') ?? '').trim();
      if (!href || href.length > MAX_HREF_CHARS) return;
      try {
        hrefs.push(base ? new URL(href, base).toString() : new URL(href).toString());
      } catch {
        // Not an address: a broken href, or a relative one without a base.
      }
    });
    if (nested) return;
    $('[data-html-block]').each((_, el) => {
      const code = Buffer.from(String($(el).attr('data-html-block') ?? ''), 'base64').toString(
        'utf8',
      );
      if (code) read(code, true);
    });
  };
  read(String(html ?? ''), false);
  return hrefs;
}

/** A page's words outside its code (scripts, styles, frames). */
export function pageWords(html) {
  const $ = cheerio.load(String(html ?? ''));
  $('script, style, noscript, template, iframe, svg').remove();
  const body = $('body');
  return (body.length ? body : $.root())
    .text()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean).length;
}

/**
 * Each product's state as the catalog has it now, by id: 'gone' (not in the
 * brand's catalog, or removed from it), 'sold_out' (no variant in stock),
 * 'refused' (Merchant Center refuses every variant in stock) or 'ok'; and
 * its page and title in the catalog (its link, else a variant's), for a
 * product the path keeps neither for (one the person removed).
 *
 * @returns {Promise<{ states: Map<string, string>, pages: Map<string, string>,
 *   titles: Map<string, string> }>}
 */
export async function productStates(db, brandId, ids) {
  const unique = [...new Set(ids)];
  const states = new Map(unique.map((id) => [id, 'gone']));
  const pages = new Map();
  const titles = new Map();
  if (!unique.length) return { states, pages, titles };
  const products = await readIn(
    db,
    'catalog_products',
    'id, title, url, removed_at',
    'id',
    unique,
    {
      order: 'id',
      more: (q) => q.eq('brand_id', brandId),
    },
  );
  const live = products.filter((p) => !p.removed_at).map((p) => p.id);
  const variants = await readIn(
    db,
    'catalog_variants',
    'id, product_id, external_id, url, availability',
    'product_id',
    live,
    { order: 'id', more: (q) => q.eq('brand_id', brandId).is('removed_at', null) },
  );
  for (const product of products) {
    const url = product.url ?? variants.find((v) => v.product_id === product.id && v.url)?.url;
    if (url) pages.set(product.id, url);
    if (product.title) titles.set(product.id, product.title);
  }
  const inStock = variants.filter((v) => isInStock(v.availability));
  const issues = await readIn(
    db,
    'catalog_item_issues',
    'id, external_id, severity, reporting_context',
    'external_id',
    [...new Set(inStock.map((v) => v.external_id))],
    { order: 'id', more: (q) => q.eq('brand_id', brandId).eq('severity', 'disapproved') },
  );
  const refused = new Set(issues.filter(refuses).map((i) => i.external_id));
  for (const id of live) {
    const offered = inStock.filter((v) => v.product_id === id);
    states.set(
      id,
      !offered.length
        ? 'sold_out'
        : offered.every((v) => refused.has(v.external_id))
          ? 'refused'
          : 'ok',
    );
  }
  return { states, pages, titles };
}

/** A path's products and the ones the person removed or it left out: every id to read. */
export function pathProductIds(path) {
  return [
    ...new Set([
      ...path.products.map((p) => p.id),
      ...path.removed,
      ...path.leftOut.map((p) => p.id),
    ]),
  ];
}

/**
 * What a page's links do with its path, as the editor's Rules read them
 * (web lib/content/shoppingCheck.ts): how many of its category pages and
 * of its products that sell it links, and the products it links that no
 * longer sell. A product the person removed or the path left out counts
 * only when it no longer sells: the page may still link it. `swaps`: the
 * path's products that sell and the page doesn't link, in its order.
 *
 * @param {{ states: Map<string, string>, pages: Map<string, string>,
 *   titles?: Map<string, string> }} catalog
 */
export function linkCheck(hrefs, path, { states, pages, titles = new Map() }) {
  const keys = new Set(hrefs.map((href) => linkKey(href)).filter(Boolean));
  const categories = [...new Set(path.categories.map((c) => linkKey(c.url)).filter(Boolean))];
  const inPath = new Set(path.products.map((p) => p.id));
  const leftOutTitles = new Map(path.leftOut.map((p) => [p.id, p.title]));
  const checked = [
    ...path.products.map((p) => ({ id: p.id, title: p.title, url: p.url, inPath: true })),
    ...[...new Set([...path.removed, ...path.leftOut.map((p) => p.id)])]
      .filter((id) => !inPath.has(id))
      .map((id) => ({
        id,
        title: leftOutTitles.get(id) ?? titles.get(id) ?? null,
        url: pages.get(id),
        inPath: false,
      })),
  ];
  const linked = [];
  const seenPages = new Set();
  for (const product of checked) {
    const key = product.url ? linkKey(product.url) : null;
    // One per page: the path's first, before a removed one with the same page.
    if (!key || !keys.has(key) || seenPages.has(key)) continue;
    seenPages.add(key);
    const state = states.get(product.id) ?? 'gone';
    if (!product.inPath && state === 'ok') continue;
    linked.push({
      id: product.id,
      title: String(product.title ?? '').slice(0, TITLE_CHARS),
      state,
      inPath: product.inPath,
    });
  }
  const selling = path.products.filter((p) => (states.get(p.id) ?? 'gone') === 'ok').length;
  return {
    categories: categories.length,
    categoriesLinked: categories.filter((key) => keys.has(key)).length,
    products: selling,
    productsLinked: linked.filter((p) => p.inPath && p.state === 'ok').length,
    bad: linked
      .filter((p) => p.state !== 'ok')
      .map(({ inPath: _inPath, ...p }) => p)
      .slice(0, MAX_BAD),
    swaps: path.products
      .filter((p) => p.url && (states.get(p.id) ?? 'gone') === 'ok' && !keys.has(linkKey(p.url)))
      .slice(0, MAX_SWAPS)
      .map((p) => ({ id: p.id, title: String(p.title ?? '').slice(0, TITLE_CHARS) })),
  };
}

/** Whether a check found any of the path's links: a category page, or a product it names. */
export function linksPath(check) {
  return check.categoriesLinked > 0 || check.productsLinked > 0 || check.bad.length > 0;
}

/** Where a draft is live: its CMS's address, or an optimized page's own, once published. */
export function livePage(draft) {
  if (draft.status !== 'published') return null;
  const url = draft.published_url ?? (draft.method === 'optimize' ? draft.source_url : null);
  return typeof url === 'string' && /^https?:\/\//i.test(url) ? url : null;
}

/**
 * A live page's links, or null when it can't be read (the draft's are read
 * instead): no answer, an error, a redirect off the brand's site, or too
 * few words to be the page.
 */
async function liveHrefs(url, readPage, domains) {
  try {
    const page = await readPage(url, {
      timeoutMs: PAGE_TIMEOUT_MS,
      maxBytes: PAGE_BYTES,
      truncate: true,
    });
    if (page.status >= 400) return null;
    if (!onBrandDomain(page.url, domains)) return null;
    if (pageWords(page.html) < MIN_WORDS) return null;
    return pageHrefs(page.html, page.url);
  } catch {
    return null;
  }
}

/** The brand's site (brandSite), for the live pages read; none when it can't be read. */
async function siteDomains(db, brandId) {
  try {
    return await brandSite(db, brandId);
  } catch {
    return [];
  }
}

/** The brand's primary site, as a base for a draft's relative links; null when none. */
async function primarySite(db, brandId) {
  const { data, error } = await db
    .from('brand_domains')
    .select('domain')
    .eq('brand_id', brandId)
    .eq('is_primary', true)
    .maybeSingle();
  if (error || !data?.domain) return null;
  return /^https?:\/\//i.test(data.domain) ? data.domain : `https://${data.domain}`;
}

/** What a draft's check reads of it. */
const DRAFT_COLUMNS =
  'id, title, status, method, source_url, published_url, body_html, shopping_path';

/** The brand's drafts with a shopping path, a batch at a time, in id order. */
async function draftBatch(db, brandId, from) {
  const { data, error } = await db
    .from('content_drafts')
    .select(DRAFT_COLUMNS)
    .eq('brand_id', brandId)
    .is('archived_at', null)
    .not('shopping_path', 'is', null)
    .order('id')
    .range(from, from + DRAFT_BATCH - 1);
  if (error) throw new Error(`content_drafts read: ${error.message}`);
  return data ?? [];
}

/** Rows of drafts that lost their path or were archived since: not in `kept`. */
async function dropStale(db, brandId, kept) {
  const { data, error } = await readAllRpcRows('content_shopping_checks', (from, to) =>
    db
      .from('content_shopping_checks')
      .select('draft_id')
      .eq('brand_id', brandId)
      .order('draft_id')
      .range(from, to),
  );
  if (error) throw new Error(`content_shopping_checks read: ${error.message}`);
  const stale = data.map((r) => r.draft_id).filter((id) => !kept.has(id));
  const { error: dropErr } = await selectInChunks(stale, (chunk) =>
    db.from('content_shopping_checks').delete().eq('brand_id', brandId).in('draft_id', chunk),
  );
  if (dropErr) throw new Error(`content_shopping_checks delete: ${dropErr.message}`);
  return stale.length;
}

/**
 * The products each draft's open action names (openActionProducts), or the
 * read's error: then no action of these drafts is synced.
 */
async function heldProducts(db, brandId, draftIds) {
  try {
    return { held: await openActionProducts(db, brandId, draftIds), heldErr: null };
  } catch (err) {
    return { held: new Map(), heldErr: err };
  }
}

/**
 * A path with its open action's products counted as ones the person
 * removed: on its page only while they still don't sell. So a rebuild that
 * dropped them doesn't close the action while the page links them.
 */
function withHeld(path, ids = []) {
  const extra = ids.filter((id) => !path.removed.includes(id));
  return extra.length ? { ...path, removed: [...path.removed, ...extra] } : path;
}

/** Whether a draft's live page may be read: it has one, on the brand's site. */
function readable(draft, domains) {
  const url = livePage(draft);
  return Boolean(url) && onBrandDomain(url, domains);
}

/**
 * A draft's links checked against its path: its live page's when `readLive`
 * and it reads as the page, else the draft's; with its
 * content_shopping_checks row.
 */
async function checkDraft(
  draft,
  path,
  { brandId, catalog, site, domains, readPage, readLive, now },
) {
  const url = livePage(draft);
  const read = readLive ? await liveHrefs(url, readPage, domains) : null;
  // A draft's relative link ("/products/x") is read against its page, else the brand's site.
  const base = url ?? draft.source_url ?? site;
  const inDraft = linkCheck(pageHrefs(draft.body_html, base), path, catalog);
  const onPage = read ? linkCheck(read, path, catalog) : null;
  // A live page that links none of the path while its draft does wasn't
  // read as it is (a shell its script fills, a page served to bots): its
  // draft is read.
  const fromPage = Boolean(onPage) && (linksPath(onPage) || !linksPath(inDraft));
  const check = fromPage ? onPage : inDraft;
  return {
    url,
    fromPage,
    check,
    row: {
      draft_id: draft.id,
      brand_id: brandId,
      read_from: fromPage ? 'page' : 'draft',
      page_url: fromPage ? url : null,
      categories: check.categories,
      categories_linked: check.categoriesLinked,
      products: check.products,
      products_linked: check.productsLinked,
      bad: check.bad,
      checked_at: now.toISOString(),
    },
  };
}

/**
 * Checks a brand's pages' shopping links and keeps what it finds; a live
 * page's Action Center action is opened or closed by what it found. A
 * failure there is logged and the check goes on.
 *
 * @param {string} brandId
 * @param {{ db?: object, now?: Date, readPage?: Function, livePages?: number }} [opts]
 *   `readPage` reads a live page (safe-fetch's fetchPage); tests pass their own.
 * @returns {Promise<{ drafts: number, live: number, attention: number, dropped: number,
 *   opened: number, closed: number }>}
 */
export async function checkShoppingLinks(
  brandId,
  { db = supabaseAdmin, now = new Date(), readPage = fetchPage, livePages = MAX_LIVE_PAGES } = {},
) {
  const started = Date.now();
  const site = await primarySite(db, brandId);
  const domains = await siteDomains(db, brandId);
  const kept = new Set();
  let live = 0;
  let attention = 0;
  let opened = 0;
  let closed = 0;
  // Whether every draft with a path was read: only then is a row no draft
  // was read for a stale one.
  let complete = false;
  for (let from = 0; from < MAX_DRAFTS; from += DRAFT_BATCH) {
    const drafts = await draftBatch(db, brandId, from);
    const read = drafts
      .map((d) => ({ draft: d, path: readShoppingPath(d.shopping_path, { draftId: d.id }) }))
      .filter((d) => d.path);
    const { held, heldErr } = await heldProducts(
      db,
      brandId,
      read.map((d) => d.draft.id),
    );
    const paths = read.map((d) => ({ ...d, path: withHeld(d.path, held.get(d.draft.id)) }));
    const catalog = await productStates(
      db,
      brandId,
      paths.flatMap((d) => pathProductIds(d.path)),
    );
    const rows = [];
    const livePagesRead = [];
    for (const { draft, path } of paths) {
      const canRead =
        readable(draft, domains) &&
        live < livePages &&
        Date.now() - started < LIVE_PAGES_DEADLINE_MS;
      if (canRead) live += 1;
      const { url, fromPage, check, row } = await checkDraft(draft, path, {
        brandId,
        catalog,
        site,
        domains,
        readPage,
        readLive: canRead,
        now,
      });
      if (check.bad.length) attention += 1;
      if (fromPage) livePagesRead.push({ draft, pageUrl: url, check });
      kept.add(draft.id);
      rows.push(row);
    }
    if (rows.length) {
      const { error } = await db
        .from('content_shopping_checks')
        .upsert(rows, { onConflict: 'draft_id' });
      if (error) throw new Error(`content_shopping_checks write: ${error.message}`);
    }
    // Only a live page read now opens or closes its action: a draft isn't
    // what readers see, and a page that couldn't be read says nothing.
    for (const page of livePagesRead) {
      try {
        // Without its open action's products, a check can't tell it's fixed.
        if (heldErr) throw heldErr;
        const done = await syncShoppingLinksAction(brandId, page, {
          db,
          now,
          open: opened < MAX_NEW_ACTIONS,
        });
        if (done === 'opened') opened += 1;
        if (done === 'closed') closed += 1;
      } catch (err) {
        logger.warn(
          { err: { name: err?.name, message: err?.message }, brandId, draftId: page.draft.id },
          '[shopping-check] Action Center action not synced',
        );
      }
    }
    if (drafts.length < DRAFT_BATCH) {
      complete = true;
      break;
    }
  }
  const dropped = complete ? await dropStale(db, brandId, kept) : 0;
  return { drafts: kept.size, live, attention, dropped, opened, closed };
}

/**
 * Checks one draft's page now, as the catalog sync does (Check now on its
 * Action Center task, action-center/taskChecks.js): keeps what it finds,
 * and from a live page read opens, keeps or closes its action. A failure
 * there is thrown, for the person who asked. Null when the draft has no
 * shopping path to check (none, archived, or not the brand's).
 *
 * @param {string} brandId
 * @param {string} draftId
 * @param {{ db?: object, now?: Date, readPage?: Function }} [opts]
 * @returns {Promise<null | { readFrom: 'page'|'draft', pageUrl: string|null,
 *   bad: Array<{ id: string, title: string, state: string }>, action: string|null }>}
 *   `action`: what syncShoppingLinksAction did; null for a draft read.
 */
export async function checkShoppingDraft(
  brandId,
  draftId,
  { db = supabaseAdmin, now = new Date(), readPage = fetchPage } = {},
) {
  const { data: draft, error } = await db
    .from('content_drafts')
    .select(DRAFT_COLUMNS)
    .eq('brand_id', brandId)
    .eq('id', draftId)
    .is('archived_at', null)
    .maybeSingle();
  if (error) throw new Error(`content_drafts read: ${error.message}`);
  const own = draft ? readShoppingPath(draft.shopping_path, { draftId: draft.id }) : null;
  if (!own) return null;
  const { held, heldErr } = await heldProducts(db, brandId, [draft.id]);
  const path = withHeld(own, held.get(draft.id));
  const site = await primarySite(db, brandId);
  const domains = await siteDomains(db, brandId);
  const catalog = await productStates(db, brandId, pathProductIds(path));
  const { url, fromPage, check, row } = await checkDraft(draft, path, {
    brandId,
    catalog,
    site,
    domains,
    readPage,
    readLive: readable(draft, domains),
    now,
  });
  const { error: writeErr } = await db
    .from('content_shopping_checks')
    .upsert([row], { onConflict: 'draft_id' });
  if (writeErr) throw new Error(`content_shopping_checks write: ${writeErr.message}`);
  if (fromPage && heldErr) throw heldErr;
  const action = fromPage
    ? await syncShoppingLinksAction(brandId, { draft, pageUrl: url, check }, { db, now })
    : null;
  return { readFrom: row.read_from, pageUrl: row.page_url, bad: check.bad, action };
}

/** Brands waiting for their check, with the check's options. */
const queued = new Map();
let draining = null;

/**
 * Checks a brand's pages after a catalog sync, behind the API's other work:
 * one brand at a time, and a brand synced again while it waits is checked
 * once. A brand whose workspace's plan ended isn't checked (#1608). A
 * failure is logged; the next sync checks again.
 */
export function queueShoppingCheck(brandId, opts = {}) {
  queued.set(brandId, opts);
  if (!draining) {
    draining = (async () => {
      while (queued.size) {
        const [[next, options]] = queued;
        queued.delete(next);
        try {
          // A workspace whose plan ended gets no check: it reads live pages (#1608).
          if (!(await isBrandActive(next))) continue;
          const result = await checkShoppingLinks(next, options);
          if (result.drafts || result.dropped) {
            logger.info({ brandId: next, ...result }, '[shopping-check] pages checked');
          }
        } catch (err) {
          logger.error(
            { err: { name: err?.name, message: err?.message }, brandId: next },
            '[shopping-check] check failed',
          );
        }
      }
    })().finally(() => {
      draining = null;
    });
  }
  return draining;
}
