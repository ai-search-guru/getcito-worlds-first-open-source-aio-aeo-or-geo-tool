import supabaseAdmin from '../../config/supabase.js';
import { normHost, onBrandDomain } from '../audit/host.js';
import { foldLetters } from '../letters.js';

/**
 * Where each catalog category lives on the brand's site (shopping path, 00350):
 * the page a buying guide or a comparison links for "hiking boots".
 *
 * A category with no decision is matched, on every read, to one of the
 * brand's own pages (site_pages, 00104) whose address reads as a category
 * page by the editor's page types for a shop (frontend/src/lib/content/
 * pageTypes.ts, PATH_SIGNS; both sides test the cases in frontend/src/lib/
 * content/__fixtures__/category-paths.json): /collections/…, /c/…,
 * /shop/…, WooCommerce's /product-category/…, and the same words in
 * Turkish, German, French and Spanish (/kategori/…); never a product page,
 * a themed collection (gifts, a sale), a size guide, a comparison, a
 * best-of list or a blog's own section (/blog/category/…). A /category/
 * page is as often WordPress's blog archive as a shop's category, so it
 * counts only on a host with product pages and none of WooCommerce's
 * /product-category/ ones, and when its title isn't an archive's.
 *
 * The best match wins:
 *   1. 'address': the page's last path segment is the category's name
 *      ("Shoes > Hiking Boots" → hiking-boots), its parent's words allowed
 *      beside it ("Men > Shoes" → mens-shoes);
 *   2. 'title': the page's title or h1 holds the category's name;
 *   3. 'words': most of the name's words are in the address or the title.
 * A one-word name ("Shoes") matches by its address only: running-shoes
 * isn't the shoes page. Ties go to the page naming more of the parent's
 * words, then to the page AI cites, then visits, more. When categories
 * find the same page, the one naming more of its parent's words there
 * keeps it ("Women > Shoes" keeps "Women's shoes") and the others take
 * their next page, or none. A person's decision (catalog_category_pages)
 * replaces the match: a page, or none.
 */

/** Site pages read for a brand at most (site_pages keeps 500). */
const MAX_PAGES = 500;
/** Share of a category's words a page must hold for a 'words' match. */
export const WORDS_SHARE = 0.66;
/** Product links read for a brand with no domain stored, to know its site. */
const MAX_PRODUCT_LINKS = 100;

/** "What is …" that asks for something else (the editor's NOT_DEFINED). */
const NOT_DEFINED =
  'best|differences?|costs?|prices?|benefits?|advantages?|disadvantages?|pros|cons|new|latest';

/**
 * The editor's signs a shop's page meets before its categories' (pageTypes.ts,
 * PATH_SIGNS), so never a category page: a size guide, alternatives, a
 * comparison, a definition, a policy, help, a buying guide, a best-of list,
 * a product, a themed collection, a blog's own section.
 */
const NOT_CATEGORY = [
  /(^|[/-])(size-?(guides?|charts?)|sizing-guides?|fit-guides?)([/-]|$)|\/sizing([/-]|$)/,
  /(^|[/-])alternatives?([/-]|$)/,
  /(^|[/-])(vs|versus)([/-]|$)|\/(compare|comparisons?)(\/|$)/,
  new RegExp(
    `\\/(glossary|definitions?|dictionary)([/-]|$)|\\/what-(is|are)(?!-(the-)?(${NOT_DEFINED})([/-]|$))([/-]|$)`,
  ),
  /\/(shipping|delivery|returns?|refunds?|exchanges?|warranty|polic(y|ies)|terms|privacy|legal)([/-]|$)/,
  /\/(docs|documentation|help|help-center|support|faqs?|knowledge-base|kb)(\/|$)/,
  /\/(buying-guides?|buyers?-guides?|how-to-choose)([/-]|$)/,
  /\/(the-)?(best(?!-(practices?|time|ways?|sellers?)([/-]|$))|top-?\d+)([/-]|$)/,
  /\/(products?|p|dp|items?)\/[^/]+/,
  /\/collections?\/(?:[^/]*-)?(gifts?|bundles?|kits?|sets?|best-?sellers?|new-arrivals?|picks|edit|sale|clearance|outlet|deals?|offers?)(?:-|\/|$)|\/collections?\/(?:[^/]*-)?for-[a-z]/,
  /^(\/[a-z]{2}(-[a-z]{2})?)?\/(blogs?|news|articles?|posts?|insights|stories|magazine|journal)\//,
];

/** The words WordPress names its blog's categories with too (/category/, /kategori/…). */
const ARCHIVE_WORDS =
  'categor(?:y|ies)|kategori(?:ler)?|kategorie(?:n)?|categorie(?:s)?|categorias?';
/** WooCommerce's product categories, whose site keeps its blog's at /category/. */
const WOO_WORDS =
  'product-categor(?:y|ies)|urun-kategori(?:si)?|produkt-kategorie|categorie-produit|categoria-(?:producto|prodotto|produto)';
/** The words only a shop names its categories with. */
const SHOP_WORDS = `collections?|${WOO_WORDS}|koleksiyon(?:lar)?|kollektion(?:en)?|c|shop|catalog|departments?`;
const CATEGORY_PATH = new RegExp(`\\/(${SHOP_WORDS}|${ARCHIVE_WORDS})\\/[^/]+`);
const ARCHIVE_WORD = new RegExp(`^(?:${ARCHIVE_WORDS})$`);
const WOO_PATH = new RegExp(`\\/(?:${WOO_WORDS})\\/`);
/** A product page in the words shops use (Wix's /product-page/, IdeaSoft's /urun/…): a host that sells. */
const PRODUCT_PAGE =
  /\/(products?|product-page|p|dp|items?|urun(ler)?|produkte?|produits?|productos?|prodott[oi])\/[^/]+/;
/** A WordPress archive's title: "Hiking Boots Archives", "Category: Hiking Boots". */
const ARCHIVE_TITLE =
  /\barchiv(e|es|os)?\b|arşiv|^\s*(category|kategori|kategorie|catégorie|categoría|categoria)\s*:/i;

/** The lowercased path with no trailing slash or page extension, or null. */
function pathOf(url) {
  try {
    return new URL(url).pathname
      .toLowerCase()
      .replace(/\.(html?|php|aspx?)$/, '')
      .replace(/\/+$/, '');
  } catch {
    return null;
  }
}

/** A path segment as it reads ("%C3%A7" → "ç"); a broken escape ("100%-cotton", Latin-1 "%E9") as it is. */
function decoded(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * A category page's last path segment ("hiking-boots") and the word that
 * makes it one ("collections"), or null when the address isn't one.
 */
function categoryPath(url) {
  const path = pathOf(url);
  if (!path || NOT_CATEGORY.some((sign) => sign.test(path))) return null;
  const found = CATEGORY_PATH.exec(path);
  if (!found) return null;
  return { slug: decoded(path.slice(path.lastIndexOf('/') + 1)), word: found[1] };
}

/** A category page's last path segment ("hiking-boots"), or null when the address isn't one. */
export function categorySlug(url) {
  return categoryPath(url)?.slug ?? null;
}

/** A category's steps: "Shoes > Hiking Boots" → ["Shoes", "Hiking Boots"]. */
function stepsOf(category) {
  return String(category ?? '')
    .split(/[>›/|]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** A category's own name: the last step of "Shoes > Hiking Boots". */
export function leafName(category) {
  const steps = stepsOf(category);
  return steps.length ? steps[steps.length - 1] : '';
}

/** A word's singular, roughly: boots → boot, glasses → glass, boxes → box; dress stays. */
export function singular(word) {
  if (word.length > 4 && /(ss|x|z|ch|sh)es$/.test(word)) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

/** Lowercase words, a plural's "s" dropped: "Hiking Boots" → ["hiking", "boot"]; "Kadın" → ["kadin"]. */
export function wordsOf(text) {
  return foldLetters(text)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && w !== 'and' && w !== 'the' && w !== 'for')
    .map(singular);
}

const RANK = { address: 3, title: 2, words: 1 };
/** The most of a name's or its parent's words matching reads: no category's name runs longer. */
const MAX_NAME_WORDS = 12;
/** The most of a page's title and h1 matching reads. */
const MAX_HEADING_CHARS = 300;

/** What matching reads of a category, once. */
function prepareCategory(category) {
  const steps = stepsOf(category);
  const leaf = wordsOf(steps.length ? steps[steps.length - 1] : '').slice(0, MAX_NAME_WORDS);
  const leafSet = new Set(leaf);
  const parent = new Set(
    wordsOf(steps.slice(0, -1).join(' '))
      .filter((w) => !leafSet.has(w))
      .slice(-MAX_NAME_WORDS),
  );
  return { category, leaf, leafSet, leafKey: leaf.join(' '), parent };
}

/** What matching reads of a page that reads as a category page, once; null for any other page. */
function preparePage(page, order) {
  const found = categoryPath(page.url);
  if (!found) return null;
  const heading = `${String(page.title ?? '').slice(0, MAX_HEADING_CHARS)} ${String(page.h1 ?? '').slice(0, MAX_HEADING_CHARS)}`;
  const slugWords = wordsOf(found.slug);
  const headingWords = wordsOf(heading);
  return {
    page,
    order,
    host: normHost(page.url),
    archive: ARCHIVE_WORD.test(found.word),
    heading,
    slugWords,
    headingText: ` ${headingWords.join(' ')} `,
    words: new Set([...slugWords, ...headingWords]),
  };
}

/** How well a prepared page matches a prepared category, and how many of its parent's words it names; or null. */
function matchPrepared(c, p) {
  if (!c.leaf.length) return null;
  let parentHits = 0;
  for (const w of c.parent) if (p.words.has(w)) parentHits += 1;
  // The address: the name's words in order, with none but the parent's beside
  // them. A slug with more words than the two can't be it.
  if (p.slugWords.length <= c.leaf.length + c.parent.size) {
    const rest = c.parent.size ? p.slugWords.filter((w) => !c.parent.has(w)) : p.slugWords;
    if (rest.join(' ') === c.leafKey) return { how: 'address', parentHits };
  }
  // One word is too wide for a title or a share: "Shoes" isn't /collections/running-shoes.
  if (c.leaf.length === 1) return null;
  if (p.headingText.includes(` ${c.leafKey} `)) return { how: 'title', parentHits };
  let common = 0;
  for (const w of c.leafSet) if (p.words.has(w)) common += 1;
  return common / c.leafSet.size >= WORDS_SHARE ? { how: 'words', parentHits } : null;
}

/**
 * How well a page matches a category, or null: 'address', 'title' or
 * 'words'. The page alone: matchCategoryPages also reads the site's other
 * pages (a /category/ page's host) and the other categories.
 */
export function matchOf(category, page) {
  const p = preparePage(page, 0);
  return p ? (matchPrepared(prepareCategory(category), p)?.how ?? null) : null;
}

/**
 * The site's pages that read as category pages, prepared. A /category/
 * page counts only on a host with a product page and none of WooCommerce's
 * product categories (whose site keeps its blog's at /category/), and when
 * its title isn't an archive's.
 */
function categoryPagesOf(pages) {
  const sells = new Set();
  const woo = new Set();
  for (const page of pages) {
    const path = pathOf(page.url);
    if (!path) continue;
    if (PRODUCT_PAGE.test(path)) sells.add(normHost(page.url));
    if (WOO_PATH.test(path)) woo.add(normHost(page.url));
  }
  const out = [];
  pages.forEach((page, order) => {
    const p = preparePage(page, order);
    if (!p) return;
    if (p.archive && (!sells.has(p.host) || woo.has(p.host) || ARCHIVE_TITLE.test(p.heading))) {
      return;
    }
    out.push(p);
  });
  return out;
}

function compare(a, b) {
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/**
 * Categories on the same page: the ones naming most of their parent's words
 * there keep it, the others move to their next page, until none has to.
 * Categories naming as many share it ("Shoes" under two parents, on a page
 * naming neither).
 */
function settle(choices) {
  for (let moved = true; moved;) {
    moved = false;
    const most = new Map();
    for (const { found, at } of choices) {
      const pick = found[at];
      if (pick) most.set(pick.p, Math.max(most.get(pick.p) ?? 0, pick.parentHits));
    }
    for (const choice of choices) {
      const pick = choice.found[choice.at];
      if (pick && pick.parentHits < most.get(pick.p)) {
        choice.at += 1;
        moved = true;
      }
    }
  }
}

/**
 * Each category's best page among `pages`, or none: `{ category, page, how }`.
 * Pure: `pages` are site_pages rows (url, title, h1, ai_citations, ga_sessions).
 * Each page is read once, and a category only meets the pages holding one
 * of its words.
 */
export function matchCategoryPages(categories, pages) {
  const prepared = categoryPagesOf(pages);
  const byWord = new Map();
  for (const p of prepared) {
    for (const w of p.words) {
      if (!byWord.has(w)) byWord.set(w, []);
      byWord.get(w).push(p);
    }
  }
  const choices = categories.map((category) => {
    const c = prepareCategory(category);
    const met = new Set();
    const found = [];
    for (const w of c.leafSet) {
      for (const p of byWord.get(w) ?? []) {
        if (met.has(p)) continue;
        met.add(p);
        const m = matchPrepared(c, p);
        if (!m) continue;
        const score = [
          RANK[m.how],
          m.parentHits,
          p.page.ai_citations ?? 0,
          p.page.ga_sessions ?? 0,
        ];
        found.push({ p, how: m.how, parentHits: m.parentHits, score });
      }
    }
    // The best first; on a tie, the page listed first.
    found.sort((a, b) => compare(b.score, a.score) || a.p.order - b.p.order);
    return { category, found, at: 0 };
  });
  settle(choices);
  return choices.map(({ category, found, at }) => {
    const best = found[at];
    return {
      category,
      page: best
        ? { url: best.p.page.url, title: best.p.page.title || best.p.page.h1 || null }
        : null,
      how: best?.how ?? null,
    };
  });
}

/**
 * The brand's categories, each with its live products, how many are in
 * stock, and its page: a person's decision first ('manual', or none), else
 * the best match. The categories with the most products first. `how` is
 * 'manual' for a person's decision, a page or none, and null when nothing
 * matched. The site's pages are read only when a category is left to match.
 *
 * @returns {Promise<{ name: string, products: number, inStock: number,
 *   page: { url: string, title: string|null }|null,
 *   how: 'manual'|'address'|'title'|'words'|null }[]>}
 */
export async function categoryPages(brandId, { db = supabaseAdmin } = {}) {
  const [counts, decisions] = await Promise.all([
    db.rpc('catalog_category_counts', { p_brand_id: brandId }),
    db.from('catalog_category_pages').select('category, url').eq('brand_id', brandId),
  ]);
  for (const [what, read] of [
    ['category counts', counts],
    ['category pages', decisions],
  ]) {
    if (read.error) throw new Error(`${what} read: ${read.error.message}`);
  }
  const decided = new Map((decisions.data ?? []).map((d) => [d.category, d.url]));
  const rows = (counts.data ?? [])
    .slice()
    .sort((a, b) => b.products - a.products || a.category.localeCompare(b.category));
  const open = rows.filter((r) => !decided.has(r.category)).map((r) => r.category);
  let pages = [];
  if (open.length) {
    const read = await db
      .from('site_pages')
      .select('url, title, h1, ai_citations, ga_sessions')
      .eq('brand_id', brandId)
      .or('fetch_status.is.null,and(fetch_status.gte.200,fetch_status.lt.400)')
      .limit(MAX_PAGES);
    if (read.error) throw new Error(`site pages read: ${read.error.message}`);
    pages = read.data ?? [];
  }
  const byName = new Map(matchCategoryPages(open, pages).map((m) => [m.category, m]));
  return rows.map((r) => {
    const base = { name: r.category, products: r.products, inStock: r.in_stock };
    if (decided.has(r.category)) {
      const url = decided.get(r.category);
      // A person's decision, a page or none, is 'manual' either way.
      return { ...base, page: url ? { url, title: null } : null, how: 'manual' };
    }
    const m = byName.get(r.category);
    return { ...base, page: m?.page ?? null, how: m?.how ?? null };
  });
}

export class CategoryPageError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'CategoryPageError';
    this.code = code;
    this.status = status;
  }
}

/**
 * The brand's site, as onBrandDomain reads it: its domains (brand_domains),
 * or, for a brand with none stored, the site its catalog's products link to.
 */
export async function brandSite(db, brandId) {
  const { data, error } = await db.from('brand_domains').select('domain').eq('brand_id', brandId);
  if (error) throw new Error(`brand_domains read: ${error.message}`);
  const domains = (data ?? []).map((d) => d.domain).filter(Boolean);
  if (domains.length) return domains;
  const links = await db
    .from('catalog_products')
    .select('url')
    .eq('brand_id', brandId)
    .limit(MAX_PRODUCT_LINKS);
  if (links.error) throw new Error(`catalog_products read: ${links.error.message}`);
  return (links.data ?? []).map((p) => p.url).filter(Boolean);
}

/** Whether `url` is on the brand's site (brandSite). */
async function onBrandSite(db, brandId, url) {
  return onBrandDomain(url, await brandSite(db, brandId));
}

/**
 * A person's decision for a category of the brand's catalog: its page
 * (`url`, on the brand's site), none (`url` null), or back to the
 * automatic match (`url` undefined). The caller has checked the person may.
 */
export async function setCategoryPage(
  { brandId, category, url, userId },
  { db = supabaseAdmin } = {},
) {
  const name = String(category ?? '').trim();
  if (!name || name.length > 750) throw new CategoryPageError('invalid', 'Pick a category.');
  if (url === undefined) {
    const { error } = await db
      .from('catalog_category_pages')
      .delete()
      .eq('brand_id', brandId)
      .eq('category', name);
    if (error) throw new Error(`catalog_category_pages delete: ${error.message}`);
    return;
  }
  let address = null;
  if (url !== null) {
    try {
      const parsed = new URL(String(url).trim());
      if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password)
        throw new Error();
      address = parsed.href;
    } catch {
      throw new CategoryPageError('invalid', "That isn't a web address. Paste the page's address.");
    }
    if (address.length > 2048) throw new CategoryPageError('invalid', 'That address is too long.');
  }
  const known = await db
    .from('catalog_categories')
    .select('id')
    .eq('brand_id', brandId)
    .eq('name', name)
    .maybeSingle();
  if (known.error) throw new Error(`catalog_categories read: ${known.error.message}`);
  if (!known.data) {
    throw new CategoryPageError('not_found', "That category isn't in the brand's catalog.", 404);
  }
  if (address && !(await onBrandSite(db, brandId, address))) {
    throw new CategoryPageError('off_site', "The page must be on the brand's own site.");
  }
  const { error } = await db.from('catalog_category_pages').upsert(
    {
      brand_id: brandId,
      category: name,
      url: address,
      set_by: userId,
      set_at: new Date().toISOString(),
    },
    { onConflict: 'brand_id,category' },
  );
  if (error) throw new Error(`catalog_category_pages write: ${error.message}`);
}
