import { toItem } from '../../lib/feeds/item.js';
import { ConnectError } from '../errors.js';
import { nextLink } from '../http.js';

/**
 * The example store connector (#1263): a template for a real one, and the
 * harness's own test. It isn't registered in `CONNECTORS`, so no one can
 * connect it.
 *
 * Its made-up platform has a JSON API at the store's own address:
 *   - `GET /api/shop` → `{ domain, name }`, to check the key;
 *   - `GET /api/products?per_page=100` → `{ products: [...] }`, paged by a
 *     `Link: <…>; rel="next"` header, each product with its variants.
 * The key goes in an `Authorization: Bearer` header, never in the address.
 */

/** Pages read at most, so a store that pages forever can't hold the run. */
export const MAX_PAGES = 200;
const PER_PAGE = 100;

/** The store's address as its origin ("https://shop.example"), or a ConnectError. */
function storeOrigin(value) {
  let url;
  try {
    url = new URL(String(value ?? '').trim());
  } catch {
    throw new ConnectError(
      "That isn't a web address. Paste the store's address, like https://shop.example.",
    );
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new ConnectError("The store's address must start with https://.");
  }
  return url.origin;
}

const auth = (credentials) => ({ authorization: `Bearer ${credentials.apiKey}` });

/** One variant as the catalog's feed attributes (lib/feeds/item.js). */
function attributesOf(product, variant) {
  return {
    id: String(variant.id),
    item_group_id: String(product.id),
    // The product's own name: the catalog names a product after its items' title.
    title: product.title,
    description: product.description,
    link: variant.url ?? product.url,
    image_link: variant.image ?? product.images?.[0],
    additional_image_link: product.images?.slice(1),
    brand: product.vendor,
    gtin: variant.barcode,
    mpn: variant.sku,
    price: variant.price == null ? undefined : `${variant.price} ${product.currency ?? ''}`.trim(),
    sale_price:
      variant.sale_price == null
        ? undefined
        : `${variant.sale_price} ${product.currency ?? ''}`.trim(),
    availability: variant.in_stock ? 'in stock' : 'out of stock',
    color: variant.options?.color,
    size: variant.options?.size,
    product_type: product.category,
  };
}

export default {
  kind: 'example_store',
  label: 'Example Store',
  fields: [
    { name: 'url', label: 'Store address', placeholder: 'https://shop.example' },
    {
      name: 'apiKey',
      label: 'API key',
      secret: true,
      help: 'Settings › API in the store, with read access to products only.',
    },
  ],

  async connect(input, { request }) {
    const origin = storeOrigin(input.url);
    const apiKey = String(input.apiKey ?? '').trim();
    if (!apiKey) throw new ConnectError('Paste the API key.');
    const { data } = await request(`${origin}/api/shop`, { headers: auth({ apiKey }) });
    if (!data?.domain) throw new ConnectError("That address didn't answer like an Example Store.");
    return {
      account: String(data.domain),
      url: origin,
      label: data.name ? String(data.name) : null,
      credentials: { apiKey },
    };
  },

  async readCatalog(source, { request, credentials }) {
    const items = [];
    const errors = [];
    let next = `${source.url}/api/products?per_page=${PER_PAGE}`;
    for (let page = 0; next && page < MAX_PAGES; page += 1) {
      const res = await request(next, { headers: auth(credentials) });
      for (const product of res.data?.products ?? []) {
        for (const variant of product.variants ?? []) {
          const out = toItem(
            attributesOf(product, variant),
            items.length + errors.length + 1,
            'Item',
          );
          if (out.item) items.push(out.item);
          else errors.push(out.error);
        }
      }
      // Only a next page on the store's own address is followed.
      const link = nextLink(res.headers);
      next =
        link && new URL(link, source.url).origin === source.url
          ? new URL(link, source.url).href
          : null;
    }
    return { items, errors, format: 'example_store' };
  },

  async disconnect() {
    // The made-up platform has no way to revoke a key; a real one would call it here.
  },
};
