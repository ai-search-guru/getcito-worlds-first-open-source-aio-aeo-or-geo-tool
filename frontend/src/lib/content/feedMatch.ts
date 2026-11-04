import { factValueText, pagePrices } from './brandFacts';
import type { PageOfferRead } from './pageSchema';
import { sentencesOf } from './readability';

/**
 * A product page against its product feed (Content Editor Quality spec §11,
 * CE-053): "Price and stock match the feed / Merchant Center". The feed is
 * the brand's catalog (00278, #1263), the product the page is for found by
 * its URL or its name. Its price, GTIN and stock are compared (the Rules
 * tab's "Price, GTIN and stock match the feed"), each only where both state
 * it: a page that gives no price, or a feed with no stock, isn't failed for
 * it.
 */

/** Where a brand's product feed is connected: Settings › Integrations' product catalog (#1263). */
export const CATALOG_SETTINGS_PATH = '/dashboard/settings/integrations';

/** A variant of the page's product as the feed gives it. */
export interface FeedVariant {
  price: number | null;
  salePrice: number | null;
  currency: string | null;
  availability: string | null;
  gtin: string | null;
}

/** The page's product in the brand's catalog, and how it was found. */
export interface CatalogProduct {
  title: string;
  url: string | null;
  /** By the page's own URL, or by its title (a new page has no URL yet). */
  via: 'url' | 'name';
  variants: FeedVariant[];
}

/** The catalog read for a draft: none connected, connected with no product for the page, or its product. */
export interface CatalogMatch {
  connected: boolean;
  product: CatalogProduct | null;
}

/** Where the page and the feed differ: Trust's suggestion names both. */
export type FeedMismatch = {
  /** The sentence the page says it in: Show goes there. */
  sentence: string;
} & (
  | {
      kind: 'price';
      /** The page's price as written ("$129"), the feed's as a price ("$119", "$119–$139"). */
      page: string;
      feed: string;
    }
  | { kind: 'stock'; page: 'in' | 'out'; feed: 'in' | 'out' }
  /** A GTIN (EAN, UPC) the page gives that no variant in the feed has; the feed's first. */
  | { kind: 'gtin'; page: string; feed: string }
);

/** A page's address as feeds write it: host without "www.", path without the trailing slash, no query. */
export function pageKey(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    // A path as written ("/ürün"), whether the address has it encoded or not.
    let path = u.pathname.replace(/\/+$/, '');
    try {
      path = decodeURIComponent(path);
    } catch {
      // Not encoded as UTF-8: compared as it is.
    }
    return `${u.hostname.toLowerCase().replace(/^www\./, '')}${path}`.toLowerCase();
  } catch {
    return null;
  }
}

const OUT_OF_STOCK =
  /(?<!\p{L})(?:out\s+of\s+stock|sold\s+out|currently\s+unavailable|(?:not|no\s+longer|isn['’]?t|aren['’]?t)\s+(?:currently\s+)?in\s+stock|(?:notify|email|tell|alert|let)\s+(?:me|us|you)?\s*(?:when|if|once)(?!\p{L})[^.]{0,40}?back\s+in\s+stock|stokta\s+(?:yok|değil|kalma|bulunma|mevcut\s+değil)\p{L}*|tükendi|ausverkauft|nicht\s+(?:mehr\s+)?(?:auf\s+lager|vorrätig|lieferbar)|épuisé|en\s+rupture(?:\s+de\s+stock)?|plus\s+en\s+stock|agotado|sin\s+stock)(?!\p{L})/iu;
const IN_STOCK =
  /(?<!\p{L})(?:in\s+stock|available\s+now|stokta(?!\s+(?:yok|değil|kalma|bulunma|mevcut\s+değil))|stoktan\s+teslim|auf\s+lager|vorrätig|sofort\s+lieferbar|en\s+stock)(?!\p{L})/iu;
/** A shipping policy's "items in stock ship in 24 hours": no word on this product's stock. */
const STOCK_POLICY =
  /(?<!\p{L})(?:items?|products?|orders?|articles?)\s+(?:(?:that|which)\s+are\s+)?(?:not\s+|no\s+longer\s+)?in\s+stock(?!\p{L})/iu;

/** What the page says of its stock, and where; none where it says nothing, or both. */
export function stockOnPage(
  texts: readonly string[],
): { stock: 'in' | 'out'; sentence: string } | null {
  let found: { stock: 'in' | 'out'; sentence: string } | null = null;
  for (const sentence of texts.flatMap((text) => sentencesOf(text))) {
    // A shipping policy first: "items not in stock ship in 3 weeks" says nothing of this one.
    const stock = STOCK_POLICY.test(sentence)
      ? null
      : OUT_OF_STOCK.test(sentence)
        ? 'out'
        : IN_STOCK.test(sentence)
          ? 'in'
          : null;
    if (!stock) continue;
    if (found && found.stock !== stock) return null;
    found ??= { stock, sentence };
  }
  return found;
}

/**
 * A variant's stock, as the API's stock.js reads it ("In Stock" is
 * "in_stock"): in, out, or none for pre-orders or none given.
 */
export function variantStock(availability: string | null | undefined): 'in' | 'out' | null {
  const a = (availability ?? '').toLowerCase().replace(/[\s-]+/g, '_');
  return ['in_stock', 'instock', 'available', 'limited_availability'].includes(a)
    ? 'in'
    : ['out_of_stock', 'outofstock', 'sold_out', 'discontinued'].includes(a)
      ? 'out'
      : null;
}

/** The feed's stock: in when a variant is, out when every one is; none for pre-orders or none given. */
export function feedStock(variants: readonly FeedVariant[]): 'in' | 'out' | null {
  const read = variants.map((v) => variantStock(v.availability));
  if (read.includes('in')) return 'in';
  return read.length && read.every((s) => s === 'out') ? 'out' : null;
}

/**
 * "GTIN: 00012345678905", "EAN 4006381333931", "ISBN 978-3-16-148410-0":
 * the code, hyphens allowed, never across a space ("UPC 012345678905 12
 * months" is the UPC alone).
 */
const GTIN_ON_PAGE =
  /(?<!\p{L})(?:gtin(?:-?(?:8|12|13|14))?|ean(?:-?(?:8|13))?|upc|isbn(?:-?13)?)\s*[:#]?\s*((?:\d-?){7,13}\d)(?![\d-])/iu;

/** A GTIN's own check: 8, 12, 13 or 14 digits, the last one GS1's check digit. */
function validGtin(digits: string): boolean {
  // All zeros pass the check digit, and are no product's.
  if (![8, 12, 13, 14].includes(digits.length) || !/[1-9]/.test(digits)) return false;
  const body = [...digits.slice(0, -1)].reverse().map(Number);
  const sum = body.reduce((total, d, i) => total + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === Number(digits.at(-1));
}

/** A GTIN as a number reads it: digits, leading zeros dropped (a UPC is a GTIN-14 with two). */
const gtinKey = (code: string) => code.replace(/\D/g, '').replace(/^0+/, '');

/** The GTINs the page gives, each with its sentence. */
function gtinsOnPage(texts: readonly string[]): { code: string; sentence: string }[] {
  return texts
    .flatMap((text) => sentencesOf(text))
    .flatMap((sentence) => {
      const m = GTIN_ON_PAGE.exec(sentence);
      const code = m?.[1].replace(/-/g, '') ?? '';
      // A number that isn't a GTIN's (its length or check digit) says nothing.
      return validGtin(code) ? [{ code, sentence }] : [];
    });
}

/** A variant's price now: its sale price under its price, else its price. */
const priceNow = (v: FeedVariant) =>
  v.salePrice !== null && (v.price === null || v.salePrice < v.price) ? v.salePrice : v.price;

const same = (a: number, b: number) => Math.abs(a - b) < 0.005;

/** An amount as a person reads it ("$119"), as brand facts write theirs. */
const money = (amount: number, currency: string) =>
  factValueText('price', { plan: '', amount, currency, period: null, billed: null, per: null });

/** The first sentence that gives an amount, as the page writes it. */
function priceSentence(
  texts: readonly string[],
  amount: number,
): { text: string; sentence: string } | null {
  for (const sentence of texts.flatMap((text) => sentencesOf(text))) {
    const price = pagePrices(sentence, { rangeEnds: true }).find((p) => same(p.amount, amount));
    if (price) return { text: price.text, sentence };
  }
  return null;
}

/**
 * The page against its product in the feed: its price (one, or the low and
 * high of a range, in the feed's currency, a sale price counting as the
 * price now), the GTINs it gives and its stock, each compared only where
 * both state it.
 */
export function feedCheck({
  texts,
  offer,
  variants,
}: {
  /** The page's blocks' text. */
  texts: readonly string[];
  /** The page's price (pageOffer). */
  offer: PageOfferRead;
  variants: readonly FeedVariant[];
}): { compared: number; mismatches: FeedMismatch[] } {
  const mismatches: FeedMismatch[] = [];
  let compared = 0;

  const priced = variants.flatMap((v) => {
    const now = priceNow(v);
    return now !== null && v.currency
      ? [{ now, regular: v.price, currency: v.currency.toUpperCase() }]
      : [];
  });
  if (offer && !('several' in offer)) {
    const inCurrency = priced.filter((p) => p.currency === offer.currency);
    const nows = inCurrency.map((p) => p.now);
    const regulars = inCurrency.flatMap((p) => (p.regular === null ? [] : [p.regular]));
    // Another currency is another market's feed: not compared.
    if (inCurrency.length) {
      compared += 1;
      const low = Math.min(...nows);
      const high = Math.max(...nows);
      const page = 'price' in offer ? offer.price : offer.low;
      // A sale price the feed keeps after the sale may be over: the regular
      // price matches too.
      const matches =
        'price' in offer
          ? inCurrency.some(
              (p) =>
                same(p.now, offer.price) || (p.regular !== null && same(p.regular, offer.price)),
            )
          : (same(offer.low, low) && same(offer.high, high)) ||
            (regulars.length > 0 &&
              same(offer.low, Math.min(...regulars)) &&
              same(offer.high, Math.max(...regulars)));
      if (!matches) {
        const at = priceSentence(texts, page);
        mismatches.push({
          kind: 'price',
          page:
            'price' in offer
              ? (at?.text ?? money(offer.price, offer.currency))
              : `${money(offer.low, offer.currency)}–${money(offer.high, offer.currency)}`,
          feed: same(low, high)
            ? money(low, offer.currency)
            : `${money(low, offer.currency)}–${money(high, offer.currency)}`,
          sentence: at?.sentence ?? '',
        });
      }
    }
  }

  const fedGtins = variants.flatMap((v) => (v.gtin ? [v.gtin] : []));
  const pageGtins = gtinsOnPage(texts);
  if (pageGtins.length && fedGtins.length) {
    compared += 1;
    const known = new Set(fedGtins.map(gtinKey));
    const wrong = pageGtins.find((g) => !known.has(gtinKey(g.code)));
    if (wrong) {
      mismatches.push({
        kind: 'gtin',
        page: wrong.code,
        feed: fedGtins[0],
        sentence: wrong.sentence,
      });
    }
  }

  const said = stockOnPage(texts);
  const fed = feedStock(variants);
  if (said && fed) {
    compared += 1;
    if (said.stock !== fed) {
      mismatches.push({ kind: 'stock', page: said.stock, feed: fed, sentence: said.sentence });
    }
  }
  return { compared, mismatches };
}
