import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { Database } from '@/types/supabase';
import { pageKey, type CatalogMatch } from './feedMatch';

/** A product's name as the page's title gives it: one line, up to the catalog's length. */
const catalogTitle = z.string().trim().min(1).max(1000);
/** A page's path as an address encodes it and as it reads, in its own case ("/%C3%9Cber", "/Über"). */
function pathForms(url: string): string[] {
  try {
    const path = new URL(url.trim()).pathname.replace(/\/+$/, '');
    if (path.length <= 1) return [];
    let decoded = path;
    try {
      decoded = decodeURIComponent(path);
    } catch {
      // Not encoded as UTF-8: looked up as it is.
    }
    return [...new Set([decoded, path])];
  } catch {
    return [];
  }
}
/** Escape `\`, `%` and `_`: a path or a title matched as written. */
const likeText = (value: string) => value.replace(/[\\%_]/g, (ch) => `\\${ch}`);

/**
 * The draft's product in the brand's catalog (00278; Quality CE-053): by
 * the page's URL (an optimize draft's), else by its title, when one product
 * has it, read with the given client (the person's session in the editor,
 * the service role for the go-live gate). Says whether a catalog is
 * connected at all. Null when the draft isn't there; throws when a read
 * fails.
 */
export async function catalogMatchFor(
  supabase: SupabaseClient<Database>,
  id: string,
  title: string,
): Promise<CatalogMatch | null> {
  const { data: draft, error: draftError } = await supabase
    .from('content_drafts')
    .select('brand_id, source_url')
    .eq('id', id)
    .maybeSingle();
  if (draftError) throw new Error(draftError.message);
  if (!draft) return null;
  const brand = draft.brand_id;
  const { data: one, error: oneError } = await supabase
    .from('catalog_products')
    .select('id')
    .eq('brand_id', brand)
    .is('removed_at', null)
    .limit(1);
  if (oneError) throw new Error(oneError.message);
  if (!one?.length) return { connected: false, product: null };

  let productId: string | null = null;
  let via: 'url' | 'name' = 'url';
  const key = pageKey(draft.source_url);
  const forms = key ? pathForms(draft.source_url!) : [];
  // PostgREST reads "*" in a pattern as a wildcard: such a path or title isn't looked up.
  if (key && forms.length && !forms.some((form) => form.includes('*'))) {
    // The brand's live products (their index), narrowed by the path as
    // written and as an address encodes it, in its own case, then compared
    // whole: a feed's URL may carry a query ("?variant=…") or another
    // form of the host.
    const byUrl = async (table: 'catalog_products' | 'catalog_variants') => {
      const ids = new Set<string>();
      for (const form of forms) {
        const read =
          table === 'catalog_products'
            ? await supabase
                .from('catalog_products')
                .select('id, url')
                .eq('brand_id', brand)
                .is('removed_at', null)
                .ilike('url', `%${likeText(form)}%`)
                .limit(100)
            : await supabase
                .from('catalog_variants')
                .select('product_id, url')
                .eq('brand_id', brand)
                .is('removed_at', null)
                .ilike('url', `%${likeText(form)}%`)
                .limit(100);
        if (read.error) throw new Error(read.error.message);
        for (const row of read.data ?? []) {
          if (pageKey(row.url) !== key) continue;
          ids.add('product_id' in row ? row.product_id : row.id);
        }
      }
      return ids;
    };
    // A product's URL is its first item's link: a variant with its own
    // page ("boot-blue" grouped under "boot-red") is found by its own.
    let ids = await byUrl('catalog_products');
    if (ids.size === 0) ids = await byUrl('catalog_variants');
    if (ids.size === 1) productId = [...ids][0];
  }
  const name = catalogTitle.safeParse(title);
  if (!productId && name.success && !name.data.includes('*')) {
    const { data, error } = await supabase
      .from('catalog_products')
      .select('id')
      .eq('brand_id', brand)
      .is('removed_at', null)
      .ilike('title', likeText(name.data))
      .limit(2);
    if (error) throw new Error(error.message);
    // Two products by one name: whose page this is isn't sure.
    if (data?.length === 1) {
      productId = data[0].id;
      via = 'name';
    }
  }
  if (!productId) return { connected: true, product: null };

  const [product, variants] = await Promise.all([
    supabase
      .from('catalog_products')
      .select('title, url')
      .eq('id', productId)
      .is('removed_at', null)
      .maybeSingle(),
    // By price, so a range's low end is among them however many there are.
    supabase
      .from('catalog_variants')
      .select('price, sale_price, currency, availability, gtin')
      .eq('product_id', productId)
      .is('removed_at', null)
      .order('price', { ascending: true })
      .limit(200),
  ]);
  if (product.error) throw new Error(product.error.message);
  if (variants.error) throw new Error(variants.error.message);
  if (!product.data) return { connected: true, product: null };
  const amount = (value: number | string | null) =>
    value === null || !Number.isFinite(Number(value)) ? null : Number(value);
  return {
    connected: true,
    product: {
      title: product.data.title,
      url: product.data.url,
      via,
      variants: (variants.data ?? []).map((v) => ({
        price: amount(v.price),
        salePrice: amount(v.sale_price),
        currency: v.currency,
        availability: v.availability,
        gtin: v.gtin,
      })),
    },
  };
}
