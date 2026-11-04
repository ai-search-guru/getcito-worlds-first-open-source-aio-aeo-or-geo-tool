import { setImmediate as nextTurn } from 'timers/promises';
import supabaseAdmin from '../../config/supabase.js';
import { linkKey } from '../contentLinks.js';
import { logger } from '../logger.js';
import { readAllRpcRows } from '../rpcPages.js';

/**
 * The catalog product behind an AI shopping card (product visibility, part 2;
 * ECOM-005, 00360). Product Visibility counts a brand's products on the AI
 * "shelf", so each product card the brand's own (matched_brand_role 'own')
 * is matched to one product of the brand's catalog (00278), first by what
 * names it exactly, then by its title:
 *
 *   1. the marketplace listing it links (an ASIN, an eBay item id), to a
 *      variant's marketplace_item_id;
 *   2. a GTIN the card carries, to a variant's;
 *   3. its link, to a product's or a variant's page (with or without its
 *      query);
 *   4. its title, when most of its words are one product's (TITLE_MATCH)
 *      and clearly not another's (TITLE_MARGIN). The brand's own name and
 *      filler words don't count. The products compared are those sharing a
 *      word with the card that few of the catalog's titles have
 *      (COMMON_WORD_SHARE), so a big catalog's "women" or "backpack" doesn't
 *      make each card weigh most of it.
 *
 * A key two products share names neither. Cards are matched as they're
 * written (cloroResultHandler.js), against a catalog read at most every
 * INDEX_TTL_MS, and all of a brand's recent cards again after its catalog
 * syncs, a slice at a time: by the daily sweep (sweepShoppingCardMatches),
 * and right after a sync the person asked for (matchBrandLater).
 */

/** The share of two titles' words in common (Dice) a title match needs… */
export const TITLE_MATCH = 0.6;
/** …and by how much it must beat the next product, so two lookalikes match neither. */
export const TITLE_MARGIN = 0.1;
/** How far back a brand's cards are matched again after a catalog sync. */
export const REMATCH_DAYS = 90;
/** Matches written a call. */
const WRITE_BATCH = 500;
/** How long a brand's catalog is kept for matching new cards. */
const INDEX_TTL_MS = 10 * 60 * 1000;
/**
 * Products kept across the brands' catalogs at most; the brand read least
 * recently goes first. One brand bigger than this is still kept, alone.
 */
export const MAX_INDEXED_PRODUCTS = 200_000;
/**
 * A word in more of a catalog's titles than this share (and than
 * COMMON_WORD_MIN) still counts in a title's score, but finds no products to
 * compare: it would make each card weigh most of a big catalog.
 */
export const COMMON_WORD_SHARE = 0.05;
/** …so a small catalog compares every product sharing a word, as before. */
export const COMMON_WORD_MIN = 500;
/** Cards matched between two breaths for the event loop. */
export const MATCH_SLICE = 500;
/**
 * A card title's first words a title match reads, at most: a product title
 * says what it is in far fewer, and each word more is compared with up to
 * every product it finds.
 */
export const MAX_CARD_TITLE_WORDS = 40;

const AMBIGUOUS = Symbol('ambiguous');

/** Words that say nothing about which product it is. */
const FILLER = new Set([
  'a',
  'an',
  'and',
  'by',
  'for',
  'in',
  'of',
  'on',
  'the',
  'to',
  'with',
  'new',
]);

const FOLD = { ı: 'i', ß: 'ss', ø: 'o', æ: 'ae', œ: 'oe', ł: 'l', đ: 'd', þ: 'th' };

/** A text's words: lowercased, accents and the letters Unicode keeps whole folded, split at the rest. */
export function titleWords(text, skip = FILLER) {
  const folded = String(text ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[ıßøæœłđþ]/g, (c) => FOLD[c]);
  return new Set(folded.split(/[^\p{L}\p{N}]+/u).filter((word) => word && !skip.has(word)));
}

/** A GTIN as digits, without the zeros GTIN-12, -13 and -14 pad it with. */
export function gtinKey(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits.length >= 8 ? digits.replace(/^0+/, '') : null;
}

/** A page's host and path, without its query: a product page linked with its variant or tracking. */
export function pathKey(url) {
  try {
    const parsed = new URL(String(url ?? '').trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    // Its trailing slashes, cut by a walk back: a regex anchored at the end
    // tries each run of slashes from each of its slashes.
    let path = parsed.pathname;
    let end = path.length;
    while (end > 0 && path[end - 1] === '/') end -= 1;
    path = path.slice(0, end);
    return `${parsed.hostname.toLowerCase().replace(/^www\./, '')}${path.toLowerCase()}`;
  } catch {
    return null;
  }
}

/** The keys a card's provider gives its GTIN under, in the card's raw payload. */
const GTIN_KEYS = ['gtin', 'gtin13', 'gtin12', 'gtin14', 'ean', 'upc'];

/**
 * The GTIN a card's provider gave, if any: in its raw payload as it's
 * written, or read out of it by the sweep (CARD_GTIN_COLUMNS).
 */
function cardGtin(card) {
  const raw = card.raw && typeof card.raw === 'object' ? card.raw : {};
  for (const from of [card, raw]) {
    for (const key of GTIN_KEYS) {
      const value = from[key];
      if ((typeof value === 'string' && value.trim()) || typeof value === 'number') {
        return String(value);
      }
    }
  }
  return null;
}

/** The sweep's select of a card's GTIN keys, each read out of its raw payload. */
const CARD_GTIN_COLUMNS = GTIN_KEYS.map((key) => `${key}:raw->>${key}`).join(', ');

function post(postings, word, at) {
  if (!postings.has(word)) postings.set(word, []);
  postings.get(word).push(at);
}

function setOnce(map, key, productId) {
  if (!key) return;
  const had = map.get(key);
  if (had === undefined) map.set(key, productId);
  else if (had !== productId) map.set(key, AMBIGUOUS);
}

function pick(map, key) {
  if (!key) return null;
  const id = map.get(key);
  return id && id !== AMBIGUOUS ? id : null;
}

/**
 * A brand's catalog as the matcher reads it: its live products' titles and
 * pages, and their variants' listings, GTINs and pages.
 *
 * @param {{ products: { id: string, title: string|null, url: string|null }[], variants: { product_id: string, url: string|null, gtin: string|null, marketplace_item_id: string|null }[] }} catalog
 * @param {{ brandName?: string|null }} [opts] the brand's name: its words don't tell its products apart
 */
export function catalogIndex({ products, variants }, { brandName } = {}) {
  const skip = new Set([...FILLER, ...titleWords(brandName)]);
  const index = {
    skip,
    size: products.length,
    byListing: new Map(),
    byGtin: new Map(),
    byUrl: new Map(),
    byPath: new Map(),
    titles: [],
    postings: new Map(),
    common: new Set(),
  };
  const addPage = (url, productId) => {
    setOnce(index.byUrl, linkKey(url), productId);
    setOnce(index.byPath, pathKey(url), productId);
  };
  const live = new Set();
  // How many titles each word is in.
  const titlesWith = new Map();
  for (const product of products) {
    live.add(product.id);
    if (product.url) addPage(product.url, product.id);
    const words = titleWords(product.title, skip);
    if (!words.size) continue;
    index.titles.push({ id: product.id, words });
    for (const word of words) titlesWith.set(word, (titlesWith.get(word) ?? 0) + 1);
  }
  // A title is found by its words few titles have, or else by its rarest one.
  const common = Math.max(COMMON_WORD_MIN, index.titles.length * COMMON_WORD_SHARE);
  index.titles.forEach(({ words }, at) => {
    let rarest = null;
    let found = false;
    for (const word of words) {
      const count = titlesWith.get(word);
      if (count <= common) {
        found = true;
        post(index.postings, word, at);
      } else {
        index.common.add(word);
        if (rarest === null || count < titlesWith.get(rarest)) rarest = word;
      }
    }
    if (!found) post(index.postings, rarest, at);
  });
  for (const variant of variants) {
    if (!live.has(variant.product_id)) continue;
    setOnce(
      index.byListing,
      variant.marketplace_item_id?.trim().toUpperCase() || null,
      variant.product_id,
    );
    setOnce(index.byGtin, gtinKey(variant.gtin), variant.product_id);
    if (variant.url) addPage(variant.url, variant.product_id);
  }
  return index;
}

/**
 * The catalog product a card shows, and how it was found, or null.
 *
 * @param {{ product_title?: string|null, merchant_url?: string|null, listing_id?: string|null, gtin?: string|null, raw?: object|null }} card
 * @returns {{ productId: string, match: 'listing'|'gtin'|'url'|'title' } | null}
 */
export function matchCard(card, index) {
  const listing = pick(index.byListing, card.listing_id?.trim().toUpperCase() || null);
  if (listing) return { productId: listing, match: 'listing' };
  const gtin = pick(index.byGtin, gtinKey(cardGtin(card)));
  if (gtin) return { productId: gtin, match: 'gtin' };
  if (card.merchant_url) {
    const page =
      pick(index.byUrl, linkKey(card.merchant_url)) ??
      pick(index.byPath, pathKey(card.merchant_url));
    if (page) return { productId: page, match: 'url' };
  }
  const words = new Set(
    [...titleWords(card.product_title, index.skip)].slice(0, MAX_CARD_TITLE_WORDS),
  );
  if (!words.size) return null;
  const compared = new Set();
  for (const word of words) {
    for (const at of index.postings.get(word) ?? []) compared.add(at);
  }
  let best = null;
  let bestScore = 0;
  let second = 0;
  for (const at of compared) {
    const title = index.titles[at].words;
    let common = 0;
    for (const word of words) if (title.has(word)) common += 1;
    const score = (2 * common) / (words.size + title.size);
    if (score > bestScore) {
      second = bestScore;
      bestScore = score;
      best = index.titles[at].id;
    } else if (score > second) {
      second = score;
    }
  }
  // A product not compared shares only the card's common words, and has a
  // word the card hasn't: it scores at most `unseen`. One that close to the
  // best could be the lookalike that matches neither, so neither matches.
  let commonInCard = 0;
  for (const word of words) if (index.common.has(word)) commonInCard += 1;
  const unseen = commonInCard ? (2 * commonInCard) / (words.size + commonInCard + 1) : 0;
  return best && bestScore >= TITLE_MATCH && bestScore - Math.max(second, unseen) >= TITLE_MARGIN
    ? { productId: best, match: 'title' }
    : null;
}

async function readAll(what, page) {
  const { data, error } = await readAllRpcRows(what, page);
  if (error) throw new Error(`${what} read: ${error.message}`);
  return data;
}

/** A brand's live catalog, read for matching. */
export async function loadCatalogIndex(brandId, { db = supabaseAdmin, brandName = null } = {}) {
  const [products, variants] = await Promise.all([
    readAll('catalog_products', (from, to) =>
      db
        .from('catalog_products')
        .select('id, title, url')
        .eq('brand_id', brandId)
        .is('removed_at', null)
        .order('id')
        .range(from, to),
    ),
    readAll('catalog_variants', (from, to) =>
      db
        .from('catalog_variants')
        .select('id, product_id, url, gtin, marketplace_item_id')
        .eq('brand_id', brandId)
        .is('removed_at', null)
        .order('id')
        .range(from, to),
    ),
  ]);
  return catalogIndex({ products, variants }, { brandName });
}

/**
 * Brands' catalogs kept for matching the cards being written: each read
 * again after ttlMs, and, once they hold more than maxProducts products
 * between them, the brand read least recently dropped first.
 *
 * @param {{ maxProducts?: number, ttlMs?: number, load?: typeof loadCatalogIndex, now?: () => number }} [opts]
 */
export function catalogIndexCache({
  maxProducts = MAX_INDEXED_PRODUCTS,
  ttlMs = INDEX_TTL_MS,
  load = loadCatalogIndex,
  now = Date.now,
} = {}) {
  // brandId → { at, index (a promise), size }; a Map keeps the order its
  // keys went in, the least recently read first.
  const kept = new Map();
  const shrink = (keepId) => {
    let total = 0;
    for (const entry of kept.values()) total += entry.size;
    for (const [brandId, entry] of kept) {
      if (total <= maxProducts) break;
      if (brandId === keepId) continue;
      kept.delete(brandId);
      total -= entry.size;
    }
  };
  return {
    get(brandId, opts = {}) {
      const had = kept.get(brandId);
      kept.delete(brandId);
      if (had && now() - had.at < ttlMs) {
        kept.set(brandId, had);
        return had.index;
      }
      const entry = { at: now(), index: null, size: 0 };
      entry.index = load(brandId, opts).then(
        (index) => {
          if (kept.get(brandId) === entry) {
            entry.size = index.size ?? 0;
            shrink(brandId);
          }
          return index;
        },
        (err) => {
          if (kept.get(brandId) === entry) kept.delete(brandId);
          throw err;
        },
      );
      kept.set(brandId, entry);
      return entry.index;
    },
    drop(brandId) {
      kept.delete(brandId);
    },
    /** The brands kept, the least recently read first. */
    brands: () => [...kept.keys()],
  };
}

const indexes = catalogIndexCache();

/**
 * A brand's catalog for matching the cards being written, read again after
 * INDEX_TTL_MS, or when a sweep has matched the brand's cards since.
 */
export function catalogIndexFor(brandId, opts = {}) {
  return indexes.get(brandId, opts);
}

/**
 * Cards matched to a catalog, MATCH_SLICE at a time with a breath between,
 * so a big brand's sweep doesn't hold the event loop (tracking callbacks,
 * API requests) for its whole length.
 */
export async function matchCards(cards, index) {
  const found = [];
  for (let at = 0; at < cards.length; at += 1) {
    if (at > 0 && at % MATCH_SLICE === 0) await nextTurn();
    found.push(matchCard(cards[at], index));
  }
  return found;
}

/**
 * Matches a brand's own cards of the last REMATCH_DAYS to its catalog as it
 * is now, and writes the matches that changed.
 *
 * @returns {Promise<{ cards: number, matched: number, changed: number }>}
 */
export async function matchBrandShoppingCards(
  brandId,
  { db = supabaseAdmin, now = new Date() } = {},
) {
  const { data: brand, error: brandErr } = await db
    .from('brands')
    .select('name')
    .eq('id', brandId)
    .maybeSingle();
  if (brandErr) throw new Error(`brands read: ${brandErr.message}`);
  const index = await loadCatalogIndex(brandId, { db, brandName: brand?.name ?? null });
  indexes.drop(brandId);
  const since = new Date(now.getTime() - REMATCH_DAYS * 86_400_000).toISOString();
  const cards = await readAll('prompt_result_shopping_cards', (from, to) =>
    db
      .from('prompt_result_shopping_cards')
      .select(
        `id, product_title, merchant_url, listing_id, ${CARD_GTIN_COLUMNS}, catalog_product_id, catalog_match`,
      )
      .eq('brand_id', brandId)
      .eq('matched_brand_role', 'own')
      .gte('created_at', since)
      .order('id')
      .range(from, to),
  );
  const matches = await matchCards(cards, index);
  let matched = 0;
  const changes = [];
  for (const [at, card] of cards.entries()) {
    const found = matches[at];
    if (found) matched += 1;
    const productId = found?.productId ?? null;
    const match = found?.match ?? null;
    if (productId !== (card.catalog_product_id ?? null) || match !== (card.catalog_match ?? null)) {
      changes.push({ id: card.id, product_id: productId, match });
    }
  }
  let changed = 0;
  for (let at = 0; at < changes.length; at += WRITE_BATCH) {
    const { data, error } = await db.rpc('set_shopping_card_matches', {
      p_brand_id: brandId,
      p_matches: changes.slice(at, at + WRITE_BATCH),
    });
    if (error) throw new Error(`set_shopping_card_matches: ${error.message}`);
    changed += Number(data ?? 0);
  }
  return { cards: cards.length, matched, changed };
}

/** Brands being matched by matchBrandLater: brandId → { again, done }. */
const later = new Map();

/**
 * A brand's recent cards matched to its catalog after a sync the person
 * asked for (a store or an account connected, a sync from Settings, a file
 * uploaded), without waiting on it: the daily sweep matches them only the
 * next day, and until then the Shelf counts none of the brand's products on
 * it. A brand being matched already is matched once more after, against its
 * catalog as it is then. A failure is logged, never thrown.
 *
 * @returns {Promise<void>} settled once the brand is matched (the tests wait on it)
 */
export function matchBrandLater(brandId, { match = matchBrandShoppingCards } = {}) {
  const running = later.get(brandId);
  if (running) {
    running.again = true;
    return running.done;
  }
  const entry = { again: true, done: null };
  later.set(brandId, entry);
  entry.done = (async () => {
    try {
      while (entry.again) {
        entry.again = false;
        try {
          await match(brandId);
        } catch (err) {
          logger.error(
            { err: { name: err?.name, message: err?.message }, brandId },
            '[card-match] match after sync failed',
          );
        }
      }
    } finally {
      later.delete(brandId);
    }
  })();
  return entry.done;
}

/** Catalogs read again within this long are matched again by the daily sweep. */
const SWEEP_SYNCED_WITHIN_MS = 26 * 60 * 60 * 1000;

/**
 * The daily run, after the catalog sweep: each brand whose catalog synced
 * in the last day has its recent cards matched again, one brand at a time.
 * A brand's failure is logged and the others go on.
 */
export async function sweepShoppingCardMatches({ db = supabaseAdmin, now = new Date() } = {}) {
  const since = new Date(now.getTime() - SWEEP_SYNCED_WITHIN_MS).toISOString();
  const { data, error } = await db
    .from('catalog_sources')
    .select('brand_id')
    .eq('last_status', 'ok')
    .gte('last_synced_at', since);
  if (error) throw new Error(`catalog_sources read: ${error.message}`);
  const brands = [...new Set((data ?? []).map((row) => row.brand_id))];
  let changed = 0;
  for (const brandId of brands) {
    try {
      changed += (await matchBrandShoppingCards(brandId, { db, now })).changed;
    } catch (err) {
      logger.error(
        { err: { name: err?.name, message: err?.message }, brandId },
        '[card-match] brand failed',
      );
    }
  }
  return { brands: brands.length, changed };
}
