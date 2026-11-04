import * as cheerio from 'cheerio';
import supabaseAdmin from '../config/supabase.js';
import { onBrandDomain } from './audit/host.js';
import { brandSite, leafName, singular } from './catalog/categoryPages.js';
import { priceAmount } from './catalog/offer.js';
import { isInStock, stockKey } from './catalog/stock.js';
import { linkHref, linkKey } from './contentLinks.js';
import { foldLetters } from './letters.js';
import { logger } from './logger.js';
import { readAllRpcRows } from './rpcPages.js';
import { MAX_PRODUCTS, PRODUCTS_FOR, TITLE_CHARS, readShoppingPath } from './shoppingPath.js';

/**
 * The Content Agent's side of a draft's shopping path (shopping path, part
 * 4): what it's told about the category page and the products the page
 * links (shoppingPath.js picked them), and the links themselves.
 *
 * A page written whole is text the agent can't link (contentWriter.js
 * renderPage), so the agent is asked to write each name exactly as given,
 * and the names it wrote are linked here: the first time each appears in a
 * paragraph or a list item, never in a heading or inside a link. A page it
 * changes (rewrite, suggestions, fixes) links them itself: they join the
 * pages it may link to (contentLinks.js), where anything else is
 * unwrapped. Either way, the only facts it's given about a product are the
 * catalog's: its name, price and stock.
 */

/**
 * What the writer is told of a product's stock, by stock.js's key (an
 * in-stock one is "in stock"); the best first. Nothing for one it can't read.
 */
const STOCK_WORDS = {
  limited_availability: 'low stock',
  preorder: 'available to pre-order',
  pre_order: 'available to pre-order',
  backorder: 'on backorder',
  back_order: 'on backorder',
  out_of_stock: 'out of stock',
  outofstock: 'out of stock',
  sold_out: 'out of stock',
};
const STOCK_ORDER = [
  'in stock',
  'low stock',
  'available to pre-order',
  'on backorder',
  'out of stock',
];

/** A variant's stock in the writer's words, or null when it can't be read. */
export function stockWords(availability) {
  const key = stockKey(availability);
  if (Object.hasOwn(STOCK_WORDS, key)) return STOCK_WORDS[key];
  return isInStock(key) ? 'in stock' : null;
}

/** The sign a price is written with, by its currency, as the number guard reads it (contentSources.js). */
const CURRENCY_SIGNS = {
  USD: '$',
  CAD: '$',
  AUD: '$',
  NZD: '$',
  SGD: '$',
  HKD: '$',
  MXN: '$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
  CNY: '¥',
  TRY: '₺',
};

/** A product's price and stock as the agent is told them: "189.00 USD, in stock". */
function offerLine(product) {
  const amount = priceAmount(product);
  const price =
    amount == null ? null : `${amount.toFixed(2)}${product.currency ? ` ${product.currency}` : ''}`;
  return [price, stockWords(product.availability)].filter(Boolean).join(', ');
}

/** The ways a product's price may be written: 189, 189.00, $189, $189.00 ("$1,299" reads as 1299). */
function priceSpellings(product) {
  const amount = priceAmount(product);
  if (amount == null) return [];
  const values = [...new Set([amount.toFixed(2), String(amount)])];
  const signs = [
    '',
    Object.hasOwn(CURRENCY_SIGNS, product.currency ?? '') ? CURRENCY_SIGNS[product.currency] : '',
  ];
  return [...new Set(signs.flatMap((sign) => values.map((value) => `${sign}${value}`)))];
}

/**
 * Text as names are looked up in it, with where each of its characters
 * came from (`from`, `to`): apostrophes as one, runs of spaces as one, and
 * with `fold` its letters folded as letters.js does ("KADIN" reads as
 * "kadın", "İç" as "iç").
 */
function readable(text, fold) {
  const out = [];
  const from = [];
  const to = [];
  let at = 0;
  let space = false;
  for (const char of String(text ?? '')) {
    const end = at + char.length;
    let read = /\s/u.test(char) ? ' ' : /['’‘ʼ]/u.test(char) ? "'" : char;
    if (read === ' ' && space) {
      to[to.length - 1] = end;
    } else {
      if (fold) read = foldLetters(read);
      out.push(read);
      space = read.endsWith(' ');
      for (let i = 0; i < read.length; i += 1) {
        from.push(at);
        to.push(end);
      }
    }
    at = end;
  }
  return { text: out.join(''), from, to };
}

/** A name as it's compared: a category's folded, a product's as written (case kept: "Pro" isn't "a pro tip"). */
const nameKey = (name, kind) => readable(name, kind === 'category').text.trim();

/** An https address to link, without tracking; null for any other. */
function shopHref(url) {
  const href = linkHref(url);
  return href && href.startsWith('https:') ? href : null;
}

/**
 * The path's products the page is written with: as many as its page type
 * links (shoppingPath.js PRODUCTS_FOR), the person's locked and added ones
 * all kept and counted in it, MAX_PRODUCTS at most.
 */
function pathProducts(path) {
  const products = path?.products ?? [];
  const own = new Set([...(path?.locked ?? []), ...(path?.added ?? [])]);
  const max = Object.hasOwn(PRODUCTS_FOR, path?.pageType ?? '')
    ? PRODUCTS_FOR[path.pageType]
    : MAX_PRODUCTS;
  let room = max - products.filter((p) => own.has(p.id)).length;
  return products.filter((p) => own.has(p.id) || (room -= 1) >= 0).slice(0, MAX_PRODUCTS);
}

/**
 * The path's category pages and products as link targets, each with the
 * name it's linked on and its catalog item: https only, each name and
 * address once (the first keeps it).
 */
function pathTargets(path) {
  const out = [];
  const seen = new Set();
  const add = (url, title, kind, item) => {
    const href = shopHref(url);
    const name = String(title ?? '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!href || !name) return;
    const keys = [`${kind}:${nameKey(name, kind)}`, `url:${linkKey(href)}`];
    if (keys.some((key) => seen.has(key))) return;
    keys.forEach((key) => seen.add(key));
    out.push({ url: href, title: name, kind, item });
  };
  for (const category of path?.categories ?? []) {
    add(category.url, leafName(category.name), 'category', category);
  }
  for (const product of pathProducts(path)) add(product.url, product.title, 'product', product);
  return out;
}

/** A path's category pages and products as link targets, each with the name it's linked on. */
export function shoppingTargets(path) {
  return pathTargets(path).map(({ url, title, kind }) => ({ url, title, kind }));
}

/** The link targets with the shopping path's: offered first, kept whatever rules are asked for. */
export function withShopping(targets, path) {
  return { ...targets, shopping: shoppingTargets(path) };
}

/**
 * The products with their price and stock as the catalog has them now, both
 * from one live variant: the best stock, then the lowest price at it. A
 * product with no live variant left is gone from the catalog: nothing is
 * said of its price or stock. As the path saved them when the read fails.
 */
async function withOffer(db, brandId, products, draftId) {
  if (!products.length) return products;
  const { data, error } = await readAllRpcRows('catalog_variants', (from, to) =>
    db
      .from('catalog_variants')
      .select('id, product_id, availability, price, sale_price, currency')
      .eq('brand_id', brandId)
      .in(
        'product_id',
        products.map((p) => p.id),
      )
      .is('removed_at', null)
      .order('id')
      .range(from, to),
  ).catch((err) => ({ data: null, error: err }));
  if (error) {
    logger.warn({ err: error, draftId }, "[shopping-links] reading stock failed; the path's used");
    return products;
  }
  // A stock it can't read comes last, and nothing is said of it.
  const rankOf = (v) => {
    const rank = STOCK_ORDER.indexOf(stockWords(v.availability));
    return rank === -1 ? STOCK_ORDER.length : rank;
  };
  const amount = (v) => priceAmount({ price: v.price, salePrice: v.sale_price }) ?? Infinity;
  const best = new Map();
  for (const variant of data) {
    const held = best.get(variant.product_id);
    const rank = rankOf(variant);
    if (held && (held.rank < rank || (held.rank === rank && amount(held) <= amount(variant)))) {
      continue;
    }
    best.set(variant.product_id, { ...variant, rank });
  }
  return products.map((p) => {
    const v = best.get(p.id);
    if (!v) return { ...p, price: null, salePrice: null, availability: '' };
    return {
      ...p,
      price: v.price ?? null,
      salePrice: v.sale_price ?? null,
      currency: v.currency ?? null,
      availability: v.rank < STOCK_ORDER.length ? stockKey(v.availability) : '',
    };
  });
}

/**
 * The draft's shopping path as the agent writes with it, or null: read as
 * shoppingPath.js reads it (none when it isn't a path), its pages only
 * https ones on the brand's own site (a stored path is a member's to
 * change), its products' stock and prices as the catalog has them now.
 * The site not read, it has none: nothing it can't check is linked.
 */
export async function shoppingPathFor(draft, { db = supabaseAdmin } = {}) {
  const path = readShoppingPath(draft.shopping_path, { draftId: draft.id });
  if (!path) return null;
  let site;
  try {
    site = await brandSite(db, draft.brand_id);
  } catch (err) {
    logger.warn({ err, draftId: draft.id }, '[shopping-links] reading the brand site failed');
    return null;
  }
  const onSite = (page) => shopHref(page.url) && onBrandDomain(page.url, site);
  // A name longer than the build ever keeps isn't the build's: left out.
  const named = (name) => String(name ?? '').length <= TITLE_CHARS;
  const categories = path.categories.filter((c) => onSite(c) && named(c.name));
  const products = path.products.filter((p) => onSite(p) && named(p.title));
  const off = path.categories.length + path.products.length - categories.length - products.length;
  if (off) {
    logger.warn(
      { draftId: draft.id, off },
      "[shopping-links] path pages off the brand's site left out",
    );
  }
  return {
    ...path,
    categories,
    products: await withOffer(db, draft.brand_id, products, draft.id),
  };
}

/**
 * The shopping path as a new page's writer reads it; '' when the path has
 * nothing to link.
 */
export function shoppingPrompt(path) {
  const targets = pathTargets(path);
  const categories = targets.filter((t) => t.kind === 'category');
  const products = targets.filter((t) => t.kind === 'product');
  if (!targets.length) return '';
  const lines = [
    "The shopping path: the pages of the brand's shop this page sends readers to. Write each name exactly as given; the editor links it.",
  ];
  if (categories.length) {
    lines.push(
      `Category page: ${categories.map((c) => c.title).join('; ')}. Name it in the opening, and point readers to it again at the end.`,
    );
  }
  if (products.length) {
    lines.push(
      'Products, in this order (recommend or compare them where the page does; one each at most where it fits):',
      ...products.map((p) => {
        const offer = offerLine(p.item);
        return `- ${p.title}${offer ? `: ${offer}` : ''}`;
      }),
      "About these products, write only what is given here and in your data, a price as given (its currency's sign may stand for its code). Never write a price, size, weight or other spec that isn't, and never look one up: leave it out.",
    );
  }
  return lines.join('\n');
}

/**
 * What the path gives the guards (contentSources.js, contentPeople.js):
 * its prices, each way one may be written, known anywhere on the page; its
 * names, which a name may be, and whose own numbers ("Trail 450") are known
 * only where the name is written (withNamedNumbers).
 */
export function shoppingGiven(path) {
  const targets = pathTargets(path);
  return {
    prices: targets
      .filter((t) => t.kind === 'product')
      .flatMap((t) => priceSpellings(t.item))
      .join(' '),
    names: targets.map((t) => (t.kind === 'category' ? t.item.name : t.title)),
  };
}

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const escapeHtml = (text) =>
  text.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

/** A word's plural, roughly: boot → boots, glass → glasses, box → boxes (categoryPages.js singular's other way). */
const plural = (word) => (/(ss|x|z|ch|sh)$/.test(word) ? `${word}es` : `${word}s`);

/**
 * The ways a name may be written, as `readable` reads them: a product's as
 * given; a category's folded, its last word singular or plural too
 * ("Reading Glasses": "reading glass").
 */
function spellings(target) {
  const name = nameKey(target.title, target.kind);
  if (target.kind !== 'category') return [name];
  const words = name.split(' ');
  const last = words.at(-1);
  if (!/^\p{L}+$/u.test(last)) return [name];
  const one = singular(last);
  return [name, [...words.slice(0, -1), one !== last ? one : plural(last)].join(' ')];
}

/**
 * The page's HTML with the path's names linked: each target the first time
 * one of its spellings appears in a paragraph or a list item's text, outside
 * a link and a heading; the products first, the longest names first, so a
 * category's name inside a product's isn't taken. A product's name is read
 * as written, a category's in any case. Returns the HTML and how many of
 * each kind it linked.
 */
export function linkShoppingPath(html, path) {
  const targets = shoppingTargets(path).sort(
    (a, b) =>
      (a.kind === 'product' ? 0 : 1) - (b.kind === 'product' ? 0 : 1) ||
      b.title.length - a.title.length,
  );
  const linked = { category: 0, product: 0 };
  if (!targets.length || !html) return { html, linked };
  const $ = cheerio.load(html, null, false);
  const textNodes = () => {
    const out = [];
    $('p, li').each((_, el) => {
      if ($(el).parents('h1, h2, h3, h4, a').length) return;
      $(el)
        .contents()
        .each((__, node) => {
          if (node.type === 'text') out.push(node);
        });
    });
    return out;
  };
  for (const target of targets) {
    const fold = target.kind === 'category';
    const pattern = new RegExp(
      `(?<![\\p{L}\\p{N}])(?:${spellings(target).map(escape).join('|')})(?![\\p{L}\\p{N}])`,
      'u',
    );
    for (const node of textNodes()) {
      const text = node.data ?? '';
      const read = readable(text, fold);
      const m = pattern.exec(read.text);
      if (!m) continue;
      const start = read.from[m.index];
      const end = read.to[m.index + m[0].length - 1];
      $(node).replaceWith(
        `${escapeHtml(text.slice(0, start))}<a href="${escapeHtml(target.url)}">${escapeHtml(text.slice(start, end))}</a>${escapeHtml(text.slice(end))}`,
      );
      linked[target.kind] += 1;
      break;
    }
  }
  return { html: $.html(), linked };
}
