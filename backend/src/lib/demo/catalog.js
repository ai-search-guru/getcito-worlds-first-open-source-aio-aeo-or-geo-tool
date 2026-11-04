/**
 * The demo brand's product catalog (demo-site), for Product Visibility, the
 * Content Editor's shopping path and the catalog's category pages.
 *
 * Brewline's catalog comes from a product feed URL, as a store's does: the
 * feed is written here in Google's XML, read by the feed parser
 * (feeds/index.js) and turned into products and variants by the catalog
 * sync's own catalogRecords and hashOf (catalog/sync.js). Rows keep the
 * demo's stable ids rather than the database's, so a rebuild keeps links to
 * a product. The products AI answers show as product cards (brewline.js)
 * are the same products here: same page, same title, same price.
 *
 * No product has an image: the demo loads nothing from outside.
 */

import supabaseAdmin from '../../config/supabase.js';
import { sourceKey } from '../catalog/sources.js';
import { catalogRecords, hashOf } from '../catalog/sync.js';
import { parseFeed } from '../feeds/index.js';
import { BRAND } from './brewline.js';
import { demoId } from './random.js';
import { DAY_MS } from './siteCommon.js';
import { allSettledOrThrow, demoWriter } from './write.js';
import { productDescription, variantsOf } from './siteHtml.js';
import { CATALOG, CATEGORY_DECISIONS, REMOVED_PRODUCT, SITE_URL, pageUrl } from './siteWorld.js';

/** The feed's address and when it was added; it is read every morning. */
export const FEED_URL = `${SITE_URL}/feeds/google-shopping.xml`;
const SOURCE_DAYS_AGO = 30;
const SYNC_HOUR_UTC = 4;

const xml = (text) =>
  String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A variant's title: the product's, its grind and size ("…, Whole Bean 12 oz") or its bags. */
function variantTitle(product, label) {
  const name = `Brewline ${product.title.replace(/^Brewline /, '')}`;
  if (!label) return name;
  return product.sizes ? `${name}, Whole Bean ${label}` : `${name} - ${label}`;
}

/** One feed item per variant, as a Google product feed lists them. */
export function feedItems(product) {
  const variants = variantsOf(product);
  return variants.map(([label, price, availability, sale], i) => {
    const suffix = label ? `-${label.replace(/\s+/g, '').toUpperCase()}` : '';
    return {
      id: `${product.id}${suffix}`,
      item_group_id: variants.length > 1 ? product.id : null,
      title: variantTitle(product, label),
      description: productDescription(product),
      link:
        i === 0
          ? pageUrl(product.path)
          : `${pageUrl(product.path)}?${product.sizes ? 'size' : 'bags'}=${label.replace(/\s+/g, '').toLowerCase()}`,
      brand: BRAND.name,
      mpn: `${product.id}${suffix}`,
      price: `${price.toFixed(2)} USD`,
      sale_price: sale ? `${sale.toFixed(2)} USD` : null,
      availability: availability ?? 'in stock',
      condition: 'new',
      size: label,
      product_type: product.type,
    };
  });
}

/** The feed as Brewline's store publishes it: RSS 2.0 with Google's g: namespace. */
export function feedXml(products) {
  const items = products.flatMap(feedItems).map(
    (item) =>
      `<item>${Object.entries(item)
        .filter(([, value]) => value !== null && value !== undefined)
        .map(([name, value]) =>
          name === 'title' || name === 'description' || name === 'link'
            ? `<${name}>${xml(value)}</${name}>`
            : `<g:${name}>${xml(value)}</g:${name}>`,
        )
        .join('')}</item>`,
  );
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:g="http://base.google.com/ns/1.0" version="2.0">
<channel>
<title>${xml(BRAND.name)}</title>
<link>${SITE_URL}</link>
<description>${xml(BRAND.name)} product feed</description>
${items.join('\n')}
</channel>
</rss>`;
}

/**
 * The catalog's rows for one source's products, as syncCatalog writes them
 * (its upsert's columns), with the demo's ids.
 */
function recordRows(brandId, source, items, { at, firstSeen, removedAt = null }) {
  const { products, variants } = catalogRecords(items);
  const productIds = new Map(
    products.map((p) => [p.external_id, demoId(brandId, `catalog-product:${p.external_id}`)]),
  );
  return {
    products: products.map((product) => ({
      id: productIds.get(product.external_id),
      brand_id: brandId,
      source,
      ...product,
      content_hash: hashOf(product),
      removed_at: removedAt,
      first_seen_at: firstSeen,
      updated_at: removedAt ?? at,
    })),
    variants: variants.map((variant) => {
      const { product_external_id, images: _images, ...columns } = variant;
      return {
        id: demoId(brandId, `catalog-variant:${variant.external_id}`),
        brand_id: brandId,
        source,
        product_id: productIds.get(product_external_id),
        ...columns,
        content_hash: hashOf(variant),
        removed_at: removedAt,
        first_seen_at: firstSeen,
        updated_at: removedAt ?? at,
      };
    }),
  };
}

/** When the feed was last read: this morning's sync, or yesterday's before it ran. */
function lastSync(now) {
  const at = new Date(now);
  at.setUTCHours(SYNC_HOUR_UTC, 10, 0, 0);
  if (at > now) at.setUTCDate(at.getUTCDate() - 1);
  return at;
}

/**
 * Every catalog row of the demo brand, built in memory: the same every time
 * but for the dates, which count back from `now`.
 *
 * @param {{ brandId: string, now: Date }} args
 */
export function catalogRows({ brandId, now }) {
  const sourceId = demoId(brandId, 'catalog-source');
  const source = sourceKey(sourceId);
  const createdAt = new Date(now.getTime() - SOURCE_DAYS_AGO * DAY_MS).toISOString();
  const syncedAt = lastSync(now).toISOString();

  const parsed = parseFeed(feedXml(CATALOG), 'google_xml');
  if (parsed.errors.length) throw new Error(`demo feed: ${parsed.errors[0].message}`);
  const live = recordRows(brandId, source, parsed.items, { at: syncedAt, firstSeen: createdAt });
  // A seasonal blend gone from the feed: kept, marked removed (sync.js).
  const removed = recordRows(
    brandId,
    source,
    parseFeed(feedXml([REMOVED_PRODUCT]), 'google_xml').items,
    {
      at: syncedAt,
      firstSeen: createdAt,
      removedAt: new Date(now.getTime() - REMOVED_PRODUCT.removedDaysAgo * DAY_MS).toISOString(),
    },
  );
  const products = [...live.products, ...removed.products];
  const variants = [...live.variants, ...removed.variants];

  const names = [...new Set(products.map((p) => p.product_type).filter(Boolean))];
  const categories = names.map((name) => ({
    id: demoId(brandId, `catalog-category:${name}`),
    brand_id: brandId,
    name,
    created_at: createdAt,
  }));
  const categoryId = new Map(categories.map((c) => [c.name, c.id]));
  const productCategories = products
    .filter((p) => p.product_type)
    .map((p) => ({
      brand_id: brandId,
      product_id: p.id,
      category_id: categoryId.get(p.product_type),
    }));

  const sourceRow = {
    id: sourceId,
    brand_id: brandId,
    kind: 'feed_url',
    format: 'google_xml',
    url: FEED_URL,
    label: 'Brewline product feed',
    last_synced_at: syncedAt,
    last_status: 'ok',
    last_error: null,
    // What this morning's read recorded (sources.js): nothing new in the feed.
    last_counts: {
      format: parsed.format,
      items: parsed.items.length,
      skipped: 0,
      errors: [],
      products: { added: 0, changed: 0, removed: 0, unchanged: live.products.length },
      variants: { added: 0, changed: 0, removed: 0, unchanged: live.variants.length },
    },
    created_by: null,
    created_at: createdAt,
    account: null,
  };

  const categoryPages = CATEGORY_DECISIONS.map(({ category, path }) => ({
    brand_id: brandId,
    category,
    url: pageUrl(path),
    set_by: null,
    set_at: new Date(now.getTime() - 18 * DAY_MS).toISOString(),
  }));

  return { source: sourceRow, products, variants, categories, productCategories, categoryPages };
}

/** The catalog module: its brand-scoped tables, in the order written, and its build. */
/** Its tables' key columns where a row has no `id` of its own. */
const KEYS = {
  catalog_product_categories: 'product_id,category_id',
  catalog_category_pages: 'brand_id,category',
};

export const catalog = {
  name: 'catalog',
  // Rebuilt in place (write.js): written over, what isn't written again deleted after.
  inPlace: true,
  keys: KEYS,
  tables: [
    'catalog_sources',
    // And, through them (on delete cascade), the products' images: the demo has none.
    'catalog_products',
    'catalog_variants',
    'catalog_categories',
    'catalog_product_categories',
    'catalog_category_pages',
  ],

  /**
   * Its independent tables side by side, through the build's writer (a
   * writer over `db` for a first build without one).
   *
   * @param {{ brandId: string, now: Date, db?: object, rebuild?: boolean, write?: Function }} ctx
   */
  async build({
    brandId,
    now,
    db = supabaseAdmin,
    rebuild = false,
    write = demoWriter({ db, brandId, rebuild, keys: KEYS }).write,
  }) {
    const rows = catalogRows({ brandId, now });
    await allSettledOrThrow([
      write('catalog_sources', [rows.source]),
      write('catalog_products', rows.products),
      write('catalog_categories', rows.categories),
      write('catalog_category_pages', rows.categoryPages),
    ]);
    // Variants point at their product; the product categories at both.
    await allSettledOrThrow([
      write('catalog_variants', rows.variants),
      write('catalog_product_categories', rows.productCategories),
    ]);
    return { products: rows.products.length, variants: rows.variants.length };
  },
};
