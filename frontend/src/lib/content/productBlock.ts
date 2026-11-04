import { linkHref } from './linkTargets';

/**
 * Product card and product grid (shopping path, part 5): one to four of the
 * brand's catalog products as an HTML block in the page, each its picture,
 * name and price, linked to its page. Plain HTML with inline styles; no
 * words of its own, so it reads in any language. The server writes the same
 * markup when the agent puts a grid in (backend/src/lib/shoppingBlocks.js):
 * keep the two alike.
 */

/** Products a block shows at most. */
export const MAX_BLOCK_PRODUCTS = 4;

/** A product as a block shows it: `price` as it reads ("$189.00"), null without one. */
export interface BlockProduct {
  title: string;
  url: string | null;
  image: string | null;
  price: string | null;
}

const ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
const escape = (text: string) => text.replace(/[&<>"']/g, (c) => ENTITIES[c]);

/**
 * The page a card links to: https only, without tracking parameters or a
 * hash (linkTargets.ts linkHref, as the server's); null for any other.
 * On any site: a block put in by hand holds products the person picked
 * from their own catalog, where the agent's grid holds only its shopping
 * path's, checked on the brand's site (backend/src/lib/shoppingLinks.js).
 */
export function productHref(url: string | null): string | null {
  const href = url ? linkHref(url) : null;
  return href?.startsWith('https:') ? href : null;
}

/** An https picture the card shows, or null. */
function imageSrc(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

/** The block's HTML: a card for one product, a grid for more; '' with none to show. */
export function productBlockHtml(products: BlockProduct[]): string {
  const items = products
    .map((p) => ({ ...p, url: productHref(p.url), image: imageSrc(p.image) }))
    .filter((p) => p.url && p.title.trim())
    .slice(0, MAX_BLOCK_PRODUCTS);
  if (!items.length) return '';
  // A space before the price and a line between cards: where the styles
  // are dropped (a text export, a CMS's rich text), each product reads
  // "Name $189.00" on its own.
  const cards = items.map((p) => {
    // The name as alt too: a text export reads an image by its alt (draftExport.ts), and
    // an empty one would print "[Image]" there.
    const image = p.image
      ? `<img src="${escape(p.image)}" alt="${escape(p.title.trim())}" loading="lazy" style="display:block;width:100%;aspect-ratio:1/1;object-fit:cover;border-radius:8px">`
      : '';
    const price = p.price
      ? ` <span style="display:block;margin-top:4px">${escape(p.price)}</span>`
      : '';
    return `<a class="getcito-product" href="${escape(p.url!)}" style="display:block;border:1px solid #e5e5e5;border-radius:12px;padding:12px;text-decoration:none;color:inherit">${image}<strong style="display:block;margin-top:8px">${escape(p.title.trim())}</strong>${price}</a>`;
  });
  return `<div class="getcito-products" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:16px;margin:16px 0">${cards.join('\n')}</div>`;
}
