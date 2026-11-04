import type { SupabaseClient } from '@supabase/supabase-js';
import {
  MERCHANT_CENTER_KIND,
  catalogSourceKey,
  type CatalogCounts,
  type CatalogFormat,
  type CatalogSource,
  type CatalogSourceKind,
  type CatalogSyncStatus,
} from '@/lib/catalog';
import type { CatalogProductRow } from '@/lib/shopping/products';

/**
 * A brand's catalog as Product Visibility reads it (#1263, 00278): its live
 * products with their variants' stock, price and GTIN, first photo and
 * category, in `.range()` pages. Through the client given: the member's
 * session for Product Visibility, the service role for the MCP's
 * list_catalog_products once the brand is the key's.
 */

/** Catalog products the table reads at most. */
export const PRODUCTS_TABLE_MAX = 2000;
const CATALOG_PAGE = 1000;
/** Product ids one catalog read filters by: each request's address stays short. */
const IDS_PER_READ = 100;
/** Such reads in flight at once. */
const ID_READS_AT_ONCE = 6;
const IN_STOCK = new Set(['in_stock', 'instock', 'available', 'limited_availability']);
/**
 * Rows one paged read takes at most, so a pathological brand can't pin the
 * server action: Product Visibility's card reads and a catalog read for some ids.
 */
export const CARD_MAX_ROWS = 50_000;

/** Every row of a brand's catalog table, in `.range()` pages, up to `max`. */
export async function readCatalogRows<T>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- PostgREST builder generics
  build: () => any,
  max: number,
): Promise<T[]> {
  const rows: T[] = [];
  for (let start = 0; start < max; start += CATALOG_PAGE) {
    const { data, error } = await build().range(start, Math.min(start + CATALOG_PAGE, max) - 1);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as T[]));
    if ((data ?? []).length < CATALOG_PAGE) break;
  }
  return rows;
}

/** A catalog table's rows for these ids: IDS_PER_READ ids a read, ID_READS_AT_ONCE reads at a time. */
export async function readForIds<T>(
  ids: readonly string[],
  read: (some: string[]) => Promise<T[]>,
) {
  const slices: string[][] = [];
  for (let i = 0; i < ids.length; i += IDS_PER_READ) slices.push(ids.slice(i, i + IDS_PER_READ));
  const out: T[][] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(ID_READS_AT_ONCE, slices.length) }, async () => {
      while (next < slices.length) {
        const at = next++;
        out[at] = await read(slices[at]);
      }
    }),
  );
  return out.flat();
}

/**
 * The brand's live catalog products as Product Visibility reads them, with
 * their variants' stock, price and GTIN, first photo and category: the
 * whole catalog (up to PRODUCTS_TABLE_MAX) for `ids` null, else the products
 * `ids` names, their rows read IDS_PER_READ ids at a time.
 */
export async function readCatalogProducts(
  supabase: SupabaseClient,
  brandId: string,
  ids: readonly string[] | null,
): Promise<CatalogProductRow[]> {
  // Each table read for the whole catalog, or for the ids, a slice at a time.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- PostgREST builder generics
  const each = <T>(column: string, build: () => any, max: number): Promise<T[]> =>
    ids === null
      ? readCatalogRows<T>(build, max)
      : readForIds(ids, (some) =>
          readCatalogRows<T>(() => build().in(column, some), CARD_MAX_ROWS),
        );
  const [products, variants, images, categories] = await Promise.all([
    each<{
      id: string;
      title: string;
      url: string | null;
      product_type: string | null;
      product_brand: string | null;
      description: string | null;
    }>(
      'id',
      () =>
        supabase
          .from('catalog_products')
          .select('id, title, url, product_type, product_brand, description')
          .eq('brand_id', brandId)
          .is('removed_at', null)
          .order('id'),
      PRODUCTS_TABLE_MAX,
    ),
    each<{
      product_id: string;
      gtin: string | null;
      price: number | null;
      sale_price: number | null;
      currency: string | null;
      availability: string | null;
    }>(
      'product_id',
      () =>
        supabase
          .from('catalog_variants')
          .select('product_id, gtin, price, sale_price, currency, availability')
          .eq('brand_id', brandId)
          .is('removed_at', null)
          .order('id'),
      CARD_MAX_ROWS,
    ),
    each<{ product_id: string; url: string; position: number }>(
      'product_id',
      () =>
        supabase
          .from('catalog_images')
          .select('product_id, url, position')
          .eq('brand_id', brandId)
          .order('id'),
      CARD_MAX_ROWS,
    ),
    each<{ product_id: string; category: { name: string } | null }>(
      'product_id',
      () =>
        supabase
          .from('catalog_product_categories')
          .select('product_id, category:category_id ( name )')
          .eq('brand_id', brandId)
          .order('product_id')
          .order('category_id'),
      CARD_MAX_ROWS,
    ),
  ]);

  const variantsOf = new Map<string, typeof variants>();
  for (const v of variants) {
    if (!variantsOf.has(v.product_id)) variantsOf.set(v.product_id, []);
    variantsOf.get(v.product_id)!.push(v);
  }
  const imageOf = new Map<string, { url: string; position: number }>();
  for (const image of images) {
    const kept = imageOf.get(image.product_id);
    if (!kept || image.position < kept.position) imageOf.set(image.product_id, image);
  }
  const categoryOf = new Map<string, string>();
  for (const row of categories) {
    if (row.category?.name && !categoryOf.has(row.product_id)) {
      categoryOf.set(row.product_id, row.category.name);
    }
  }
  return products.map((p) => {
    const own = variantsOf.get(p.id) ?? [];
    const stocked = own.filter((v) =>
      IN_STOCK.has(
        String(v.availability ?? '')
          .toLowerCase()
          .replace(/[\s-]+/g, '_'),
      ),
    );
    const priced = (stocked.length ? stocked : own)
      .map((v) => ({ price: v.sale_price ?? v.price, currency: v.currency }))
      .filter((v): v is { price: number; currency: string | null } => v.price !== null)
      .sort((a, b) => a.price - b.price);
    return {
      id: p.id,
      title: p.title,
      url: p.url,
      productType: p.product_type,
      brand: p.product_brand,
      description: p.description,
      image: imageOf.get(p.id)?.url ?? null,
      category: categoryOf.get(p.id) ?? null,
      price: priced[0] ? Number(priced[0].price) : null,
      currency: priced[0]?.currency ?? null,
      // Each variant's price and sale price, in or out of stock.
      prices: own.flatMap((v) =>
        [v.price, v.sale_price]
          .filter((price): price is number => price !== null)
          .map((price) => ({ price: Number(price), currency: v.currency })),
      ),
      inStock: stocked.length > 0,
      hasGtin: own.some((v) => !!v.gtin),
    };
  });
}

/** The brand's sources, oldest first, each with its live products in the catalog. */
export async function readCatalogSources(
  supabase: SupabaseClient,
  brandId: string,
): Promise<CatalogSource[]> {
  const { data, error } = await supabase
    .from('catalog_sources')
    .select(
      'id, kind, format, url, account, label, last_synced_at, last_status, last_error, last_counts',
    )
    .eq('brand_id', brandId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return Promise.all(
    (data ?? []).map(async (row) => {
      const { count } = await supabase
        .from('catalog_products')
        .select('id', { count: 'exact', head: true })
        .eq('brand_id', brandId)
        .eq('source', catalogSourceKey(row.id))
        .is('removed_at', null);
      return {
        id: row.id,
        kind: row.kind as CatalogSourceKind,
        format: row.format as CatalogFormat,
        url: row.url,
        account: row.account,
        label: row.label,
        lastSyncedAt: row.last_synced_at,
        lastStatus: row.last_status as CatalogSyncStatus | null,
        lastError: row.last_error,
        lastCounts: row.last_counts as unknown as CatalogCounts | null,
        products: count ?? 0,
      };
    }),
  );
}

/**
 * Whether the brand reads a Google Merchant Center account into its catalog,
 * its last sync read: only then are its products' Merchant Center issues
 * current. None when it can't be read: the caller then says less, never more.
 */
export async function hasMerchantCenter(
  supabase: SupabaseClient,
  brandId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('catalog_sources')
    .select('id')
    .eq('brand_id', brandId)
    .eq('kind', MERCHANT_CENTER_KIND)
    .eq('last_status', 'ok')
    .limit(1);
  if (error) {
    console.error('Failed to read the brand’s catalog sources:', error.message);
    return false;
  }
  return (data ?? []).length > 0;
}
