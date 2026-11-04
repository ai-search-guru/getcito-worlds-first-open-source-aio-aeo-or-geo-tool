'use server';

import { z } from 'zod';
import { API_BASE_URL } from '@/config/api';
import { createClient } from '@/lib/supabase/server';
import { jsonbBytes } from '@/lib/content/draftInputs';
import { variantStock } from '@/lib/content/feedMatch';
import { linkKey } from '@/lib/content/linkTargets';
import { MAX_BLOCK_PRODUCTS } from '@/lib/content/productBlock';
import type {
  ShoppingCheck,
  ShoppingLinkState,
  ShoppingProductCheck,
} from '@/lib/content/shoppingCheck';
import { readAllRpcRows } from '@/lib/supabase/rpcPages';
import { hasMerchantCenter } from '@/lib/shopping/catalogRead';
import { assertWritable } from '@/lib/subscriptionGuard';
import {
  NO_PATH_REASONS,
  bestInStock,
  priceText,
  shoppingChoicesSchema,
  shoppingPathSchema,
  type NoPathReason,
  type ShoppingChoices,
  type ShoppingPath,
} from '@/lib/content/shoppingPath';
import type { Json } from '@/types/supabase';

/**
 * A draft's shopping path (shopping path, 00351): read and changed by the
 * member through RLS, like the brief; built by the API from the brand's
 * catalog.
 */

const guid = z.guid();
/** The column's 64 KB (00351). */
const MAX_PATH_BYTES = 65_536;
/** The path a change was made on, by when it was built and last changed. */
const readAt = shoppingPathSchema.pick({ builtAt: true, savedAt: true });

/** A kept path as the tab reads it: none until built, `unreadable` when it isn't one it reads. */
function readPath(kept: Json | null): { path: ShoppingPath | null; unreadable?: true } {
  if (kept == null) return { path: null };
  const parsed = shoppingPathSchema.safeParse(kept);
  if (!parsed.success) {
    console.error('The shopping path can’t be read:', parsed.error.issues.slice(0, 3));
    return { path: null, unreadable: true };
  }
  return { path: parsed.data };
}

/**
 * The draft's shopping path, null until built; `unreadable` when the one
 * kept isn't a path this tab reads (the API builds over it, as over none).
 * Null for the whole answer when the draft can't be read.
 */
export async function getDraftShoppingPath(
  draftId: string,
): Promise<{ path: ShoppingPath | null; unreadable?: true } | null> {
  if (!guid.safeParse(draftId).success) throw new Error('invalid');
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('content_drafts')
    .select('shopping_path')
    .eq('id', draftId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return readPath(data.shopping_path);
}

/**
 * Saves the person's choices (locks, removals, additions) on the path they
 * were made on, its removed products out of the page; the rest of the path
 * stays as the API wrote it. Written only over the path read (its `builtAt`
 * and `savedAt`), so a build or another change since is never overwritten:
 * returned, not thrown, as 'changed', for the tab to read it again.
 */
export async function saveDraftShoppingPath(
  draftId: string,
  read: { builtAt: string; savedAt?: string | null },
  choices: ShoppingChoices,
): Promise<{ path: ShoppingPath } | { error: 'changed' }> {
  await assertWritable();
  const at = readAt.safeParse(read);
  const chosen = shoppingChoicesSchema.safeParse(choices);
  if (!guid.safeParse(draftId).success || !at.success || !chosen.success) {
    throw new Error('invalid');
  }
  const savedAt = at.data.savedAt ?? null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('content_drafts')
    .select('shopping_path')
    .eq('id', draftId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('not_found');
  const stored = shoppingPathSchema.safeParse(data.shopping_path);
  if (
    !stored.success ||
    stored.data.builtAt !== at.data.builtAt ||
    (stored.data.savedAt ?? null) !== savedAt
  ) {
    return { error: 'changed' };
  }
  // The path as kept, not as read: its links and stock as the API wrote them.
  const kept = data.shopping_path as { products: { id: string }[] } & Record<string, Json>;
  const removed = new Set(chosen.data.removed);
  const next = {
    ...kept,
    ...chosen.data,
    products: kept.products.filter((p) => !removed.has(p.id)),
    savedAt: new Date().toISOString(),
  };
  if (jsonbBytes(next) > MAX_PATH_BYTES) throw new Error('too_long');
  let write = supabase
    .from('content_drafts')
    .update({ shopping_path: next as unknown as Json })
    .eq('id', draftId)
    .eq('shopping_path->>builtAt', at.data.builtAt);
  write = savedAt
    ? write.eq('shopping_path->>savedAt', savedAt)
    : write.is('shopping_path->>savedAt', null);
  const { data: written, error: writeError } = await write.select('id');
  if (writeError) throw new Error(writeError.message);
  if (!written?.length) return { error: 'changed' };
  return { path: shoppingPathSchema.parse(next) };
}

/**
 * Why a build gave no path: 'changed' when the path changed while it was
 * built (read it again), 'rate_limited' past the API's bucket, else 'failed'.
 */
export type BuildShoppingPathError = 'failed' | 'changed' | 'rate_limited';

export type BuildShoppingPathResult =
  { path: ShoppingPath } | { path: null; reason: NoPathReason } | { error: BuildShoppingPathError };

/** Builds the draft's shopping path again from the catalog, the person's choices kept. */
export async function buildDraftShoppingPath(
  draftId: string,
  brandId: string,
): Promise<BuildShoppingPathResult> {
  if (!guid.safeParse(draftId).success || !guid.safeParse(brandId).success) {
    return { error: 'failed' };
  }
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { error: 'failed' };
  try {
    const res = await fetch(`${API_BASE_URL}/api/content-drafts/${draftId}/shopping-path`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ brandId }),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.status === 429) return { error: 'rate_limited' };
    if (res.status === 409 && body.code === 'changed') return { error: 'changed' };
    if (!res.ok) return { error: 'failed' };
    if (body.path === null) {
      const known: readonly unknown[] = NO_PATH_REASONS;
      // A reason the API added since is said in general words.
      const reason = known.includes(body.reason) ? (body.reason as NoPathReason) : 'other';
      return { path: null, reason };
    }
    const path = shoppingPathSchema.safeParse(body.path);
    return path.success ? { path: path.data } : { error: 'failed' };
  } catch (err) {
    console.error('Failed to build the shopping path:', err);
    return { error: 'failed' };
  }
}

/** A catalog product as Add product finds it. */
export interface CatalogProductHit {
  id: string;
  title: string;
  url: string | null;
}

/** The brand's live catalog products whose title holds `query`, a few at a time. */
export async function searchCatalogProducts(
  brandId: string,
  query: string,
): Promise<CatalogProductHit[]> {
  const text = query.trim().slice(0, 100);
  if (!guid.safeParse(brandId).success || text.length < 2) return [];
  // The pattern's own characters as text: a search for "50%" isn't a wildcard.
  const pattern = `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('catalog_products')
    .select('id, title, url')
    .eq('brand_id', brandId)
    .is('removed_at', null)
    .ilike('title', pattern)
    .order('title')
    .limit(8);
  if (error) throw new Error(error.message);
  return (data ?? []).map((p) => ({ id: p.id, title: p.title, url: p.url ?? null }));
}

/** A catalog product as a product card shows it (productBlock.ts). */
export interface BlockProductRead {
  id: string;
  title: string;
  url: string | null;
  image: string | null;
  price: number | null;
  salePrice: number | null;
  currency: string | null;
  /** A live variant is in stock (feedMatch.ts variantStock): only then does it go in a block. */
  inStock: boolean;
}

type Client = Awaited<ReturnType<typeof createClient>>;

/**
 * A product's live variants and, with `image`, its picture, read for it
 * alone, so no product's are cut off by another's: the product's own
 * first picture, else a variant's first.
 */
async function readBlockDetails(supabase: Client, id: string, image: boolean) {
  const [variants, images] = await Promise.all([
    supabase
      .from('catalog_variants')
      .select('url, price, sale_price, currency, availability')
      .eq('product_id', id)
      .is('removed_at', null),
    image
      ? supabase
          .from('catalog_images')
          .select('url')
          .eq('product_id', id)
          .order('variant_id', { ascending: true, nullsFirst: true })
          .order('position', { ascending: true })
          .limit(1)
      : null,
  ]);
  if (variants.error) throw new Error(variants.error.message);
  if (images?.error) throw new Error(images.error.message);
  return { variants: variants.data ?? [], image: images?.data?.[0]?.url ?? null };
}

/** A product as a card shows it, from its row and its details. */
function blockProduct(
  product: { id: string; title: string; url: string | null },
  details: Awaited<ReturnType<typeof readBlockDetails>>,
): BlockProductRead {
  // As the API's path and the agent's grid pick it: the best stock, then the lowest price.
  const variant = bestInStock(details.variants);
  return {
    id: product.id,
    title: product.title,
    url: product.url ?? details.variants.find((v) => v.url)?.url ?? null,
    image: details.image,
    price: variant?.price ?? null,
    salePrice: variant?.sale_price ?? null,
    currency: variant?.currency ?? null,
    inStock: variant !== null,
  };
}

/**
 * The brand's catalog products by id, as a product card shows them: the
 * product's page, its picture, and the price of its cheapest variant in
 * stock (none, and `inStock` false, when none is). In the order asked,
 * MAX_BLOCK_PRODUCTS at most; a product gone from the catalog is left out.
 */
export async function getProductsForBlock(
  brandId: string,
  ids: string[],
): Promise<BlockProductRead[]> {
  const wanted = [...new Set(ids)]
    .filter((id) => guid.safeParse(id).success)
    .slice(0, MAX_BLOCK_PRODUCTS);
  if (!guid.safeParse(brandId).success || !wanted.length) return [];
  const supabase = await createClient();
  const [products, details] = await Promise.all([
    supabase
      .from('catalog_products')
      .select('id, title, url')
      .eq('brand_id', brandId)
      .is('removed_at', null)
      .in('id', wanted),
    Promise.all(wanted.map((id) => readBlockDetails(supabase, id, true))),
  ]);
  if (products.error) throw new Error(products.error.message);
  const byId = new Map((products.data ?? []).map((p) => [p.id, p]));
  return wanted.flatMap((id, i) => {
    const product = byId.get(id);
    return product ? [blockProduct(product, details[i])] : [];
  });
}

/**
 * Merchant Center refusals that keep a product out of AI shopping: its free
 * listings, which AI Overviews and AI Mode draw on, or an issue with no
 * destination. A refusal for Shopping ads alone doesn't. Read as the API's
 * `refuses` reads it (backend/src/lib/shoppingPath.js): trimmed, any case.
 */
const REFUSING_CONTEXTS = new Set(['FREE_LISTINGS', '']);

/** Ids one `in` filter takes: 100 UUIDs keep a request's address well under the edge's limit. */
const IN_CHUNK = 100;

/**
 * Every row a read by ids gives: IN_CHUNK ids a request, each read a page
 * at a time (PostgREST's 1,000-row cap; `page` orders its rows).
 */
async function readByIds<T>(
  ids: readonly string[],
  page: (
    chunk: string[],
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK) chunks.push(ids.slice(i, i + IN_CHUNK));
  const rows = await Promise.all(
    chunks.map((chunk) => readAllRpcRows<T>((from, to) => page(chunk, from, to))),
  );
  return rows.flat();
}

/**
 * What a relative link on the page is read against: where it went live,
 * else the page it optimizes, else the brand's site. Null when none is
 * known, or the brand's site can't be read: a relative link then isn't
 * matched, and the rest of the check stands.
 */
async function pageSite(
  supabase: Client,
  draft: { brand_id: string; published_url: string | null; source_url: string | null },
): Promise<string | null> {
  for (const url of [draft.published_url, draft.source_url]) {
    if (url && linkKey(url)) return url.trim();
  }
  const { data, error } = await supabase
    .from('brand_domains')
    .select('domain')
    .eq('brand_id', draft.brand_id)
    .eq('is_primary', true)
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error('Failed to read the brand’s site:', error.message);
    return null;
  }
  const host = String(data?.domain ?? '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '');
  return host ? `https://${host}/` : null;
}

/**
 * The draft's shopping path read against the catalog now (shopping path,
 * part 6): each of its products sold out, refused by Merchant Center, gone,
 * or fine; the ones removed from it or left out that no longer sell, in
 * case the page still links them; the category pages; and whether the
 * brand has a Merchant Center account to say they're accepted. Read for the
 * draft's own brand, whatever brand the tab has open. Null without a path;
 * throws when the draft or the catalog can't be read.
 */
export async function getShoppingCheck(draftId: string): Promise<ShoppingCheck | null> {
  if (!guid.safeParse(draftId).success) throw new Error('invalid');
  const supabase = await createClient();
  const { data: draft, error } = await supabase
    .from('content_drafts')
    .select('brand_id, shopping_path, published_url, source_url')
    .eq('id', draftId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!draft) throw new Error('not_found');
  const { path } = readPath(draft.shopping_path);
  if (!path) return null;
  const brandId = draft.brand_id;

  const inPath = new Set(path.products.map((p) => p.id));
  const others = [...new Set([...path.removed, ...path.leftOut.map((p) => p.id)])].filter(
    (id) => !inPath.has(id),
  );
  const ids = [...inPath, ...others].filter((id) => guid.safeParse(id).success);
  const [products, variants, site, merchantCenter] = await Promise.all([
    readByIds(ids, (chunk, from, to) =>
      supabase
        .from('catalog_products')
        .select('id, title, url, removed_at')
        .eq('brand_id', brandId)
        .in('id', chunk)
        .order('id')
        .range(from, to),
    ),
    readByIds(ids, (chunk, from, to) =>
      supabase
        .from('catalog_variants')
        .select('id, product_id, external_id, url, availability, price, sale_price, currency')
        .eq('brand_id', brandId)
        .in('product_id', chunk)
        .is('removed_at', null)
        .order('id')
        .range(from, to),
    ),
    pageSite(supabase, draft),
    // Nothing to check, nothing to say about it: no catalog read.
    ids.length ? hasMerchantCenter(supabase, brandId) : false,
  ]);
  // A refusal matters only for a variant in stock: the others are sold out anyway.
  const inStock = variants.filter((v) => variantStock(v.availability) === 'in');
  const issues = await readByIds(
    [...new Set(inStock.map((v) => v.external_id))],
    (chunk, from, to) =>
      supabase
        .from('catalog_item_issues')
        .select('id, external_id, reporting_context')
        .eq('brand_id', brandId)
        .eq('severity', 'disapproved')
        .in('external_id', chunk)
        .order('id')
        .range(from, to),
  );
  const refused = new Set(
    issues
      .filter((i) =>
        REFUSING_CONTEXTS.has(
          String(i.reporting_context ?? '')
            .trim()
            .toUpperCase(),
        ),
      )
      .map((i) => i.external_id),
  );

  const byId = new Map(products.map((p) => [p.id, p]));
  const selling = new Map<string, typeof inStock>();
  for (const v of inStock) {
    const list = selling.get(v.product_id);
    if (list) list.push(v);
    else selling.set(v.product_id, [v]);
  }
  // The price a card shows of it now, as one goes in (getProductsForBlock).
  const priceOf = (id: string) => {
    const variant = bestInStock(selling.get(id) ?? []);
    return variant
      ? priceText({
          price: variant.price,
          salePrice: variant.sale_price,
          currency: variant.currency,
        })
      : null;
  };
  const stateOf = (id: string): ShoppingLinkState => {
    const product = byId.get(id);
    if (!product || product.removed_at) return 'gone';
    const sells = selling.get(id) ?? [];
    if (!sells.length) return 'sold_out';
    return sells.every((v) => refused.has(v.external_id)) ? 'refused' : 'ok';
  };

  const pathProducts = path.products.flatMap((p): ShoppingProductCheck[] => {
    // A link the path couldn't keep (not http(s)) is null: nothing to check.
    const key = p.url ? linkKey(p.url) : null;
    if (!key) return [];
    const state = stateOf(p.id);
    return [
      { key, title: p.title, state, inPath: true, price: state === 'ok' ? priceOf(p.id) : null },
    ];
  });
  // Removed or left out: listed only when it no longer sells, at the
  // catalog's page for it (the path doesn't keep one).
  const leftOutTitles = new Map(path.leftOut.map((p) => [p.id, p.title]));
  const otherProducts = others.flatMap((id): ShoppingProductCheck[] => {
    const state = stateOf(id);
    const product = byId.get(id);
    if (state === 'ok' || !product) return [];
    const url = product.url ?? variants.find((v) => v.product_id === id && v.url)?.url ?? null;
    const key = url ? linkKey(url) : null;
    const title = leftOutTitles.get(id) ?? product.title;
    return key ? [{ key, title, state, inPath: false, price: null }] : [];
  });
  return {
    categories: path.categories
      .map((c) => (c.url ? linkKey(c.url) : null))
      .filter((k): k is string => !!k),
    products: [...pathProducts, ...otherProducts],
    site,
    merchantCenter,
  };
}

/**
 * + Insert › Products' search: the brand's live catalog products whose
 * title holds `query` (searchCatalogProducts), each with its price and
 * stock as a card shows them; no picture.
 */
export async function searchProductsForBlock(
  brandId: string,
  query: string,
): Promise<BlockProductRead[]> {
  const hits = await searchCatalogProducts(brandId, query);
  if (!hits.length) return [];
  const supabase = await createClient();
  const details = await Promise.all(hits.map((hit) => readBlockDetails(supabase, hit.id, false)));
  return hits.map((hit, i) => blockProduct(hit, details[i]));
}
