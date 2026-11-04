import { z } from 'zod';
import supabaseAdmin from '../config/supabase.js';
import { categoryPages, leafName, wordsOf } from './catalog/categoryPages.js';
import { bestInStock } from './catalog/offer.js';
import { isInStock, stockKey } from './catalog/stock.js';
import { selectInChunks } from './chunkedIn.js';
import { siteTypeOf } from './contentPageTypes.js';
import { logger } from './logger.js';
import { readAllRpcRows } from './rpcPages.js';

/**
 * A draft's shopping path (shopping path, 00351): on an online shop, the
 * category pages and the catalog products a buying guide, a best-of list or
 * a comparison links, so its readers, and the AI answers that quote it,
 * reach a page that sells.
 *
 * Picked from the brand's catalog for the draft's topic: its title, the
 * brief's keywords, goal and headings. A category is a candidate when it has
 * a page on the site (catalog/categoryPages.js) and products in stock; a
 * product when it has a link, a variant in stock, and Google Merchant
 * Center doesn't refuse that variant in its free listings
 * (catalog_item_issues, see `refuses`). Products of the picked categories
 * come first. The best products the rules leave out are kept with why (sold
 * out, refused, no link, gone from the catalog), for the Brief tab to say so.
 *
 * A rebuild keeps the person's choices: locked and added products stay
 * whatever their score, removed ones never come back.
 */

/** The page types a shopping path fits, and how many products each links. */
export const PRODUCTS_FOR = {
  best_of: 8,
  buying_guide: 5,
  comparison: 4,
  alternatives: 4,
  guide: 4,
  blog_post: 3,
};
/** Category pages a path links at most. */
export const MAX_CATEGORIES = 2;
/** Products read to score, at most, and scored products read in full. */
export const SCORED_PRODUCTS = 2000;
export const DETAILED_PRODUCTS = 40;
/** Products left out a path keeps, with why: the best of the others, and the person's own. */
export const LEFT_OUT = 3;
/**
 * The path's caps, the Brief tab's schema's (frontend/src/lib/content/shoppingPath.ts):
 * products, issues a product, left out, the person's locks and additions, and removals.
 */
export const MAX_PRODUCTS = 40;
export const MAX_ISSUES = 20;
export const MAX_LEFT_OUT = 10;
export const MAX_KEPT = 40;
export const MAX_REMOVED = 200;
/** A product's or a page's title in the path, in characters at most. */
export const TITLE_CHARS = 200;
/** The path's size at most, under the column's 64 KB (00351) with room to spare. */
export const MAX_PATH_BYTES = 64000;
/** Characters of a product's description kept to score, and its words scored, as AI shopping reads its opening. */
const DESCRIPTION_CHARS = 400;
const DESCRIPTION_WORDS = 40;

/**
 * Words that say what kind of page it is, or join others, and not what it
 * is about: "How to choose the best waterproof boots" is about "waterproof"
 * and "boots". Read as `wordsOf` reads them (folded, a plural's "s" dropped).
 * "Top" and "pick" name products too (a shop's tops, guitar picks): only
 * "top 10" is dropped, by TOP_N.
 */
const NOT_TOPIC = new Set(
  wordsOf(
    [
      'how to choose choosing best guide guides buying buyer buyers buy',
      'vs versus compare compared comparing comparison comparisons review reviews reviewed',
      'alternative alternatives list ranked rated ultimate complete tips ideas',
      'the a an for and or with without of in on at by from to into about',
      'your you our my we is are be what which why when where who should can do does',
      'it its this that these those than vs new latest year',
      'en iyi nasil secilir secimi rehber rehberi icin ve ile karsilastirma',
    ].join(' '),
  ),
);
/** A year ("2026") dates a list; it isn't what the list is about. */
const YEAR = /^(19|20)\d\d$/;
/** A list's size: "Top 10", "top-5". */
const TOP_N = /\btop[\s-]*\d+\b/gi;

/**
 * The draft's topic as weighted words: the title's count 3, the brief's
 * keywords 2, its goal and headings 1.
 *
 * @returns {Map<string, number>}
 */
export function topicWords({ title, brief }) {
  const words = new Map();
  const add = (text, weight) => {
    for (const word of wordsOf(String(text ?? '').replace(TOP_N, ' '))) {
      if (NOT_TOPIC.has(word) || YEAR.test(word)) continue;
      words.set(word, Math.max(words.get(word) ?? 0, weight));
    }
  };
  for (const heading of brief?.outline ?? []) add(heading?.heading, 1);
  add(brief?.goal, 1);
  for (const keyword of brief?.keywords ?? []) add(keyword, 2);
  add(title, 3);
  return words;
}

/** How much of the topic a text holds: the weights of its topic words, each once. */
export function topicScore(topic, text) {
  let score = 0;
  for (const word of new Set(wordsOf(text))) score += topic.get(word) ?? 0;
  return score;
}

/** A title as the path keeps it: TITLE_CHARS at most. */
function titleOf(title) {
  return title == null ? null : String(title).slice(0, TITLE_CHARS);
}

/**
 * The categories to link: with a page and products in stock, the best for
 * the topic first; a second one only when it scores half the first's.
 */
export function pickCategories(categories, topic, max = MAX_CATEGORIES) {
  const scored = categories
    .filter((c) => c.page && c.inStock > 0)
    .map((c) => ({
      category: c,
      score: topicScore(topic, leafName(c.name)) * 2 + topicScore(topic, c.page.title ?? ''),
    }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score || b.category.inStock - a.category.inStock);
  if (!scored.length) return [];
  const top = scored[0].score;
  return scored
    .filter((c, i) => i === 0 || c.score >= top / 2)
    .slice(0, max)
    .map(({ category }) => ({
      name: category.name,
      url: category.page.url,
      title: titleOf(category.page.title),
    }));
}

/**
 * Whether a Merchant Center issue refuses the variant. Decision: only a
 * disapproval in the free listings (reporting_context FREE_LISTINGS), or
 * one that names no context, does. AI shopping answers draw on the free,
 * organic listings; a disapproval for ads (SHOPPING_ADS, DISPLAY_ADS…)
 * leaves the product there, so it is listed as the other issues are.
 */
export function refuses(issue) {
  if (issue.severity !== 'disapproved') return false;
  const context = String(issue.reporting_context ?? '')
    .trim()
    .toUpperCase();
  return context === '' || context === 'FREE_LISTINGS';
}

/**
 * A product as the path offers it, or why it can't be: a variant in stock
 * that Merchant Center doesn't refuse, the best stock then the lowest price
 * (catalog/offer.js bestInStock), and the issues Merchant Center reports
 * for it that don't refuse it.
 */
export function offerOf(product) {
  const url = product.url ?? product.variants.find((v) => v.url)?.url ?? null;
  const inStock = product.variants.filter((v) => isInStock(v.availability));
  const usable = inStock.filter((v) => !v.issues.some(refuses));
  const reason = !url
    ? 'no_link'
    : !inStock.length
      ? 'sold_out'
      : !usable.length
        ? 'refused'
        : null;
  if (reason) return { reason };
  const variant = bestInStock(usable);
  const issues = [
    ...new Map(
      variant.issues.map((i) => [
        `${i.code}|${i.attribute ?? ''}`,
        { code: i.code, attribute: i.attribute ?? null },
      ]),
    ).values(),
  ].slice(0, MAX_ISSUES);
  return {
    offer: {
      id: product.id,
      title: titleOf(product.title),
      url,
      price: variant.price ?? null,
      salePrice: variant.sale_price ?? null,
      currency: variant.currency ?? null,
      // As stock.js spells it: "limited_availability" whatever the feed wrote.
      availability: stockKey(variant.availability),
      image: product.image ?? null,
      issues,
    },
  };
}

/** A product's score for the topic: its title twice, its type, its description's opening. */
export function productScore(topic, product) {
  const opening = String(product.description ?? '')
    .split(/\s+/)
    .slice(0, DESCRIPTION_WORDS)
    .join(' ');
  return (
    topicScore(topic, product.title) * 2 +
    topicScore(topic, product.product_type ?? '') +
    topicScore(topic, opening)
  );
}

/**
 * The products to link, the best for the topic first: `max` of them, the
 * person's locked and added ones first and counted in it (all of them
 * when there are more, MAX_PRODUCTS at most), removed ones never; and
 * those left out, with why: the person's own, and the best LEFT_OUT of the
 * others. `scored` items carry the product, its `score` and `offerOf`
 * result ({ reason: 'gone' } for a kept product the catalog no longer has).
 */
export function pickProducts(scored, { max, locked = [], removed = [], added = [] }) {
  const keep = new Set([...locked, ...added]);
  const gone = new Set(removed);
  const picks = [];
  const leftOut = [];
  let others = 0;
  const ordered = scored
    .filter((p) => !gone.has(p.product.id))
    .sort(
      (a, b) =>
        Number(keep.has(b.product.id)) - Number(keep.has(a.product.id)) || b.score - a.score,
    );
  for (const { product, score, result } of ordered) {
    const kept = keep.has(product.id);
    if (!kept && score <= 0) continue;
    if (result.offer) {
      if (picks.length < MAX_PRODUCTS && (kept || picks.length < max)) {
        picks.push({ ...result.offer, score });
      }
    } else if (leftOut.length < MAX_LEFT_OUT && (kept || others < LEFT_OUT)) {
      if (!kept) others += 1;
      leftOut.push({ id: product.id, title: titleOf(product.title), reason: result.reason });
    }
  }
  return { products: picks, leftOut };
}

/** A read's rows, in the order `page` asks, past PostgREST's 1000-row cap (rpcPages.js); `limit` at most. */
async function readRows(what, page, limit = Infinity) {
  const { data, error } = await readAllRpcRows(what, (from, to) =>
    from >= limit ? { data: [], error: null } : page(from, Math.min(to, limit - 1)),
  );
  if (error) throw new Error(`${what} read: ${error.message}`);
  return data;
}

/**
 * Rows of `table` whose `column` is one of `ids`: 100 ids a request
 * (chunkedIn.js), each read to its end in `order` (a unique key, so no
 * row is read twice or missed across pages).
 */
export async function readIn(db, table, columns, column, ids, { order, more = (q) => q }) {
  const { data, error } = await selectInChunks(ids, (chunk) =>
    readAllRpcRows(table, (from, to) =>
      more(db.from(table).select(columns).in(column, chunk)).order(order).range(from, to),
    ),
  );
  if (error) throw new Error(`${table} read: ${error.message}`);
  return data;
}

const PRODUCT_FIELDS = 'id, title, url, product_type, description';

/** A product row as the path scores it: its description's opening only. */
function scoredRow(product) {
  return { ...product, description: String(product.description ?? '').slice(0, DESCRIPTION_CHARS) };
}

/** The live products to score: the picked categories' first, then the brand's. */
async function candidateProducts(db, brandId, categories) {
  let products = [];
  if (categories.length) {
    const { data: rows, error } = await db
      .from('catalog_categories')
      .select('id')
      .eq('brand_id', brandId)
      .in(
        'name',
        categories.map((c) => c.name),
      );
    if (error) throw new Error(`catalog_categories read: ${error.message}`);
    const categoryIds = (rows ?? []).map((r) => r.id);
    const links = categoryIds.length
      ? await readRows(
          'catalog_product_categories',
          (from, to) =>
            db
              .from('catalog_product_categories')
              .select('product_id')
              .in('category_id', categoryIds)
              .order('product_id')
              .order('category_id')
              .range(from, to),
          SCORED_PRODUCTS,
        )
      : [];
    const ids = [...new Set(links.map((l) => l.product_id))];
    products = (
      await readIn(db, 'catalog_products', PRODUCT_FIELDS, 'id', ids, {
        order: 'id',
        more: (q) => q.eq('brand_id', brandId).is('removed_at', null),
      })
    ).map((p) => ({ ...scoredRow(p), inCategory: true }));
  }
  if (products.length < SCORED_PRODUCTS) {
    const rows = await readRows(
      'catalog_products',
      (from, to) =>
        db
          .from('catalog_products')
          .select(PRODUCT_FIELDS)
          .eq('brand_id', brandId)
          .is('removed_at', null)
          .order('id')
          .range(from, to),
      SCORED_PRODUCTS,
    );
    const seen = new Set(products.map((p) => p.id));
    products.push(...rows.filter((p) => !seen.has(p.id)).map(scoredRow));
  }
  return products;
}

/** The person's locked and added products as the brand's catalog has them now, removed or not. */
async function keptProducts(db, brandId, ids) {
  const rows = await readIn(db, 'catalog_products', `${PRODUCT_FIELDS}, removed_at`, 'id', ids, {
    order: 'id',
    more: (q) => q.eq('brand_id', brandId),
  });
  return rows.map(scoredRow);
}

/** Each product's live variants, first image and Merchant Center issues, read for the best ones. */
async function withDetails(db, brandId, products) {
  const ids = products.map((p) => p.id);
  const [variants, images] = await Promise.all([
    readIn(
      db,
      'catalog_variants',
      'id, product_id, external_id, url, price, sale_price, currency, availability',
      'product_id',
      ids,
      { order: 'id', more: (q) => q.is('removed_at', null) },
    ),
    readIn(db, 'catalog_images', 'id, product_id, url, position', 'product_id', ids, {
      order: 'id',
    }),
  ]);
  const issues = await readIn(
    db,
    'catalog_item_issues',
    'id, external_id, code, severity, attribute, reporting_context',
    'external_id',
    [...new Set(variants.map((v) => v.external_id))],
    { order: 'id', more: (q) => q.eq('brand_id', brandId) },
  );
  const issuesOf = new Map();
  for (const issue of issues) {
    issuesOf.set(issue.external_id, [...(issuesOf.get(issue.external_id) ?? []), issue]);
  }
  return products.map((p) => ({
    ...p,
    variants: variants
      .filter((v) => v.product_id === p.id)
      .map((v) => ({ ...v, issues: issuesOf.get(v.external_id) ?? [] })),
    image:
      images
        .filter((i) => i.product_id === p.id)
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))[0]?.url ?? null,
  }));
}

const productId = z.string().min(1).max(100);
const address = z.string().max(2048);

/**
 * The path as content_drafts.shopping_path keeps it, with the Brief tab's
 * caps (frontend/src/lib/content/shoppingPath.ts). `savedAt` is the person's
 * last change: a build writes only over the path it read, by its
 * `builtAt` and `savedAt`.
 */
export const shoppingPathSchema = z.object({
  version: z.literal(1),
  builtAt: z.string().min(1).max(40),
  savedAt: z.string().min(1).max(40).nullish(),
  pageType: z.string().nullable(),
  categories: z
    .array(z.object({ name: z.string(), url: address, title: z.string().nullable() }))
    .max(5),
  products: z
    .array(
      z.object({
        id: productId,
        title: z.string(),
        url: address,
        price: z.number().nullable(),
        salePrice: z.number().nullable(),
        currency: z.string().nullable(),
        availability: z.string(),
        image: address.nullable(),
        issues: z
          .array(z.object({ code: z.string(), attribute: z.string().nullable() }))
          .max(MAX_ISSUES),
        score: z.number(),
      }),
    )
    .max(MAX_PRODUCTS),
  leftOut: z
    .array(
      z.object({
        id: productId,
        // Null for a kept product the catalog no longer has, and no path named.
        title: z.string().nullable(),
        reason: z.enum(['sold_out', 'refused', 'no_link', 'gone']),
      }),
    )
    .max(MAX_LEFT_OUT),
  locked: z.array(productId).max(MAX_KEPT),
  removed: z.array(productId).max(MAX_REMOVED),
  added: z.array(productId).max(MAX_KEPT),
});

/**
 * A draft's stored shopping path, or null when it has none or one that
 * isn't a path (a member's broken write): read as if it had none, and
 * logged, so a build or the agent goes on without it.
 */
export function readShoppingPath(value, { draftId } = {}) {
  if (value == null) return null;
  const parsed = shoppingPathSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  logger.warn(
    { draftId, issues: parsed.error.issues.slice(0, 5).map((i) => i.path.join('.')) },
    '[shopping-path] stored path unreadable; read as none',
  );
  return null;
}

/** A value's bytes as the column stores it: jsonb's text, ", " and ": " between items. */
export function storedSize(value) {
  if (Array.isArray(value)) {
    return 2 + value.reduce((n, v, i) => n + (i ? 2 : 0) + storedSize(v), 0);
  }
  if (value && typeof value === 'object') {
    return (
      2 +
      Object.entries(value).reduce(
        (n, [k, v], i) =>
          n + (i ? 2 : 0) + Buffer.byteLength(JSON.stringify(k)) + 2 + storedSize(v),
        0,
      )
    );
  }
  return Buffer.byteLength(JSON.stringify(value ?? null));
}

/** The path within MAX_PATH_BYTES: fewer issues a product first, then fewer products, the last first. */
export function fitted(path) {
  let out = path;
  for (const issues of [5, 1, 0]) {
    if (storedSize(out) <= MAX_PATH_BYTES) return out;
    out = {
      ...out,
      products: out.products.map((p) => ({ ...p, issues: p.issues.slice(0, issues) })),
    };
  }
  while (out.products.length && storedSize(out) > MAX_PATH_BYTES) {
    out = { ...out, products: out.products.slice(0, -1) };
  }
  return out;
}

/**
 * Why a draft has no shopping path: the brand isn't a shop, the page type
 * doesn't take one, no catalog, or nothing in it matches the topic.
 */
export class NoShoppingPath extends Error {
  constructor(reason) {
    super(`No shopping path: ${reason}`);
    this.name = 'NoShoppingPath';
    this.reason = reason;
  }
}

/**
 * Builds the draft's shopping path and saves it on the draft. Throws
 * NoShoppingPath ('not_a_shop', 'page_type', 'no_catalog', 'no_match') when
 * it doesn't fit; a 404 when the draft isn't the brand's; a 409 'changed'
 * when the path changed while it was built (the person's change, or
 * another build), so neither is lost.
 */
export async function buildShoppingPath(
  { draftId, brandId },
  { db = supabaseAdmin, now = new Date() } = {},
) {
  const [draftRead, brandRead] = await Promise.all([
    db
      .from('content_drafts')
      .select('id, brand_id, title, page_type, brief, shopping_path')
      .eq('id', draftId)
      .maybeSingle(),
    db
      .from('brands')
      .select('site_type, industry, shopping_mode_enabled')
      .eq('id', brandId)
      .maybeSingle(),
  ]);
  if (draftRead.error) throw new Error(`content_drafts read: ${draftRead.error.message}`);
  if (brandRead.error) throw new Error(`brands read: ${brandRead.error.message}`);
  const draft = draftRead.data;
  if (!draft || draft.brand_id !== brandId) {
    throw Object.assign(new Error('Draft not found'), { status: 404 });
  }
  const brand = brandRead.data ?? {};
  const siteType = siteTypeOf({
    siteType: brand.site_type,
    industry: brand.industry,
    shoppingModeEnabled: brand.shopping_mode_enabled,
  });
  if (siteType !== 'ecommerce') throw new NoShoppingPath('not_a_shop');
  const max = Object.hasOwn(PRODUCTS_FOR, draft.page_type ?? '')
    ? PRODUCTS_FOR[draft.page_type]
    : 0;
  if (!max) throw new NoShoppingPath('page_type');

  // The stored path as read, to write only over it.
  const read = draft.shopping_path ?? null;
  const before = readShoppingPath(read, { draftId });
  const choices = {
    locked: before?.locked ?? [],
    removed: before?.removed ?? [],
    added: before?.added ?? [],
  };
  const topic = topicWords({ title: draft.title, brief: draft.brief });
  const categories = pickCategories(await categoryPages(brandId, { db }), topic);
  const candidates = await candidateProducts(db, brandId, categories);
  if (!candidates.length) throw new NoShoppingPath('no_catalog');

  const removed = new Set(choices.removed);
  const keepIds = [...new Set([...choices.locked, ...choices.added])].filter(
    (id) => !removed.has(id),
  );
  const keep = new Set(keepIds);
  // A product of a picked category is worth one more of the topic's words.
  const scoreOf = (product) =>
    productScore(topic, product) + (product.inCategory && categories.length ? 1 : 0);
  const best = candidates
    .filter((p) => !keep.has(p.id) && !removed.has(p.id))
    .map((product) => ({ product, score: scoreOf(product) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, DETAILED_PRODUCTS);
  if (!categories.length && !best.length && !keepIds.length) throw new NoShoppingPath('no_match');

  // The person's products, read by id: kept whatever their score, and
  // said to be gone when the catalog removed them or no longer has them.
  const kept = new Map((await keptProducts(db, brandId, keepIds)).map((p) => [p.id, p]));
  const candidateOf = new Map(candidates.map((p) => [p.id, p]));
  const titleBefore = new Map(
    [...(before?.products ?? []), ...(before?.leftOut ?? [])].map((p) => [p.id, p.title]),
  );
  const live = keepIds
    .map((id) => kept.get(id))
    .filter((p) => p && p.removed_at == null)
    .map((product) => ({ product, score: scoreOf(candidateOf.get(product.id) ?? product) }));
  const gone = keepIds
    .filter((id) => !kept.get(id) || kept.get(id).removed_at != null)
    .map((id) => ({
      product: { id, title: kept.get(id)?.title ?? titleBefore.get(id) ?? null },
      score: 0,
      result: { reason: 'gone' },
    }));

  const toDetail = [...live, ...best];
  const detailed = await withDetails(
    db,
    brandId,
    toDetail.map((s) => s.product),
  );
  const byId = new Map(detailed.map((p) => [p.id, p]));
  const scored = toDetail.map(({ product, score }) => {
    const full = byId.get(product.id);
    return { product: full, score, result: offerOf(full) };
  });
  const { products, leftOut } = pickProducts([...scored, ...gone], { max, ...choices });

  const path = fitted({
    version: 1,
    builtAt: now.toISOString(),
    pageType: draft.page_type,
    categories,
    products,
    leftOut,
    ...choices,
  });
  // Written only over the path read: a person's change, or another build,
  // since then is never overwritten. A path no one could read (a broken
  // write, logged above) is built over.
  let write = db
    .from('content_drafts')
    .update({ shopping_path: path })
    .eq('id', draftId)
    .eq('brand_id', brandId);
  if (before) {
    write = write.eq('shopping_path->>builtAt', before.builtAt);
    write = before.savedAt
      ? write.eq('shopping_path->>savedAt', before.savedAt)
      : write.is('shopping_path->>savedAt', null);
  } else if (read == null) {
    write = write.is('shopping_path', null);
  }
  const { data, error } = await write.select('id');
  if (error) throw new Error(`content_drafts write: ${error.message}`);
  if (!data?.length) {
    throw Object.assign(new Error('The shopping path changed while it was built'), {
      status: 409,
      code: 'changed',
    });
  }
  return path;
}
