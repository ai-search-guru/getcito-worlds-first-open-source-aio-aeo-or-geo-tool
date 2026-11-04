import * as cheerio from 'cheerio';
import { priceAmount } from './catalog/offer.js';
import { isInStock } from './catalog/stock.js';
import { linkHref } from './contentLinks.js';

/**
 * The product grid a new page gets from its shopping path (shopping path,
 * part 5): the path's products in stock as an HTML block, each its picture,
 * name and price, linked to its page, put at the end of the section that
 * names them most. The markup is the editor's product card and grid
 * (frontend/src/lib/content/productBlock.ts): keep the two alike. Stored as the
 * editor stores an HTML block: UTF-8 in base64, in a data attribute.
 */

/** Products a grid shows at most, as the editor's block. */
export const MAX_BLOCK_PRODUCTS = 4;
/** The page types that show their products as a grid. */
export const GRID_PAGE_TYPES = new Set(['best_of', 'buying_guide', 'comparison', 'alternatives']);

const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escape = (text) => String(text).replace(/[&<>"']/g, (c) => ENTITIES[c]);

/**
 * A product's price as the editor's card reads it ("$189.00"), by
 * catalog/offer.js's priceAmount; null without one.
 */
export function priceText({ price, salePrice, currency }) {
  const amount = priceAmount({ price, salePrice });
  if (amount == null) return null;
  try {
    return currency
      ? new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount)
      : new Intl.NumberFormat('en-US', { minimumFractionDigits: 2 }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}

/** The page a card links to, as the editor's productHref: https only, without tracking or a hash; else null. */
export function productHref(url) {
  const href = linkHref(url);
  return href && href.startsWith('https:') ? href : null;
}

/** An https picture the card shows, or null. */
function imageSrc(value) {
  try {
    const url = new URL(String(value ?? ''));
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

/** The block's HTML, as the editor's productBlockHtml writes it; '' with none to show. */
export function productBlockHtml(products) {
  const items = products
    .map((p) => ({ ...p, url: productHref(p.url), image: imageSrc(p.image) }))
    .filter((p) => p.url && String(p.title ?? '').trim())
    .slice(0, MAX_BLOCK_PRODUCTS);
  if (!items.length) return '';
  // A space before the price and a line between cards: where the styles
  // are dropped (a text export, a CMS's rich text), each product reads
  // "Name $189.00" on its own.
  const cards = items.map((p) => {
    // The name as alt too: a text export reads an image by its alt (draftExport.ts), and
    // an empty one would print "[Image]" there.
    const image = p.image
      ? `<img src="${escape(p.image)}" alt="${escape(String(p.title).trim())}" loading="lazy" style="display:block;width:100%;aspect-ratio:1/1;object-fit:cover;border-radius:8px">`
      : '';
    const price = p.price
      ? ` <span style="display:block;margin-top:4px">${escape(p.price)}</span>`
      : '';
    return `<a class="getcito-product" href="${escape(p.url)}" style="display:block;border:1px solid #e5e5e5;border-radius:12px;padding:12px;text-decoration:none;color:inherit">${image}<strong style="display:block;margin-top:8px">${escape(String(p.title).trim())}</strong>${price}</a>`;
  });
  return `<div class="getcito-products" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:16px;margin:16px 0">${cards.join('\n')}</div>`;
}

/** An HTML block as a draft stores it (htmlAllowlist.ts htmlBlockElement). */
export function htmlBlockElement(code) {
  return `<div data-html-block="${Buffer.from(code, 'utf8').toString('base64')}"></div>`;
}

/**
 * A new page with its shopping path's products in stock as a grid: at the
 * end of the H2 section that links them most, else before the last H2 (a
 * FAQ, most often), else, with no H2, at the end. Only for a list, a buying
 * guide or a comparison with two such products or more; any other page is
 * returned as it is. The path is shoppingPathFor's (shoppingLinks.js): its
 * pages on the brand's site, its stock and prices as the catalog has them now.
 */
export function insertProductGrid(html, path) {
  if (!html || !GRID_PAGE_TYPES.has(path?.pageType)) return html;
  const products = (path?.products ?? []).filter(
    (p) => isInStock(p.availability) && productHref(p.url),
  );
  if (products.length < 2) return html;
  const code = productBlockHtml(
    products.map((p) => ({ title: p.title, url: p.url, image: p.image, price: priceText(p) })),
  );
  if (!code) return html;
  const block = htmlBlockElement(code);
  const keys = new Set(products.map((p) => productHref(p.url)));

  const $ = cheerio.load(html, null, false);
  const top = $.root().children().toArray();
  const headings = top.filter((el) => el.tagName === 'h2');
  if (!headings.length) {
    $.root().append(block);
    return $.html();
  }
  // Each H2's section: the elements up to the next H2.
  let best = null;
  headings.forEach((heading, i) => {
    const from = top.indexOf(heading);
    const to = i + 1 < headings.length ? top.indexOf(headings[i + 1]) : top.length;
    const links = top
      .slice(from + 1, to)
      .flatMap((el) => $(el).find('a[href]').addBack('a[href]').toArray())
      .filter((a) => keys.has(productHref($(a).attr('href')))).length;
    if (links > 0 && (!best || links > best.links)) best = { links, last: top[to - 1] };
  });
  if (best) $(best.last).after(block);
  else $(headings.at(-1)).before(block);
  return $.html();
}
