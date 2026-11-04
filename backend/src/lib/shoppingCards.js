/**
 * Normalize shopping cards captured into `prompt_results.shopping_cards`.
 *
 * Four providers feed this column today with four different raw shapes:
 *
 *   - **Perplexity** (`platform = 'perplexity-web'`) — snake_case keys
 *     (`image_url`, `review_count`, …).
 *   - **Google AI Mode** (`platform = 'google-aimode'`) — camelCase keys
 *     (`imageUrl`, `reviewCount`, …). NB: the live response is camelCase
 *     even though the docs show snake_case — verified in #86.
 *   - **Microsoft Copilot** (`platform = 'copilot-web'`) — camelCase keys.
 *   - **ChatGPT Shopping** (`platform = 'chatgpt-shopping'`) — snake_case
 *     keys inside `{ products: [ … ], tags }` wrappers; rich product
 *     objects with formatted price strings ("₺2.699,99") and an `offers`
 *     array (#399).
 *
 * The downstream `prompt_result_shopping_cards` table flattens those onto
 * a single set of analytical columns. Each normalizer here pulls the
 * fields we care about, parses the price into amount + currency, and
 * leaves the original card under `raw` so we can re-derive columns later
 * without going back to the provider.
 *
 * Field-name lookups are intentionally lenient — both providers we've
 * looked at have shipped silent renames before (#49 retro on AI Mode),
 * and the cost of `?? otherName` is tiny.
 */

import { logger } from './logger.js';
import { extractDomain } from './citationRows.js';

// Loose set of currency codes Perplexity / Copilot embed in price strings
// like "$29.99", "EUR 19,90", "₺499". Anything else falls back to null —
// we still capture the numeric amount and the symbol stays in `raw`.
const CURRENCY_SYMBOLS = {
  $: 'USD',
  '€': 'EUR',
  '£': 'GBP',
  '¥': 'JPY',
  '₺': 'TRY',
  '₹': 'INR',
  '₩': 'KRW',
};

const CURRENCY_CODES = new Set([
  'USD',
  'EUR',
  'GBP',
  'JPY',
  'TRY',
  'INR',
  'KRW',
  'CAD',
  'AUD',
  'CHF',
  'CNY',
  'SEK',
  'NOK',
  'DKK',
  'MXN',
  'BRL',
]);

/**
 * @param {unknown} value
 * @returns {{ amount: number|null, currency: string|null }}
 */
function parsePrice(value) {
  if (value == null) return { amount: null, currency: null };

  // Object form: { amount, currency } or { value, currency }
  if (typeof value === 'object' && !Array.isArray(value)) {
    const amount =
      typeof value.amount === 'number'
        ? value.amount
        : typeof value.value === 'number'
          ? value.value
          : Number.parseFloat(value.amount ?? value.value ?? '');
    let currency =
      typeof value.currency === 'string'
        ? value.currency.toUpperCase()
        : typeof value.currencyCode === 'string'
          ? value.currencyCode.toUpperCase()
          : null;
    // Providers (e.g. Copilot) often leave `currency` null but ship a
    // `currencySymbol` like "₺" / "$". Map the symbol to an ISO code.
    if (!currency && typeof value.currencySymbol === 'string') {
      currency = CURRENCY_SYMBOLS[value.currencySymbol.trim()] ?? null;
    }
    return {
      amount: Number.isFinite(amount) ? Math.round(amount * 100) / 100 : null,
      currency: currency && CURRENCY_CODES.has(currency) ? currency : currency || null,
    };
  }

  // Numeric form (rare, but tolerate)
  if (typeof value === 'number' && Number.isFinite(value)) {
    return { amount: Math.round(value * 100) / 100, currency: null };
  }

  // String form — the common case. Examples we see in the wild:
  //   "$29.99", "USD 29.99", "29.99 USD", "₺499,90", "€19,90"
  if (typeof value === 'string') {
    const trimmed = value.trim();

    // Currency by leading symbol
    let currency = null;
    for (const [symbol, code] of Object.entries(CURRENCY_SYMBOLS)) {
      if (trimmed.includes(symbol)) {
        currency = code;
        break;
      }
    }

    // Currency by 3-letter code anywhere in the string
    if (!currency) {
      const codeMatch = trimmed.match(/\b([A-Z]{3})\b/);
      if (codeMatch && CURRENCY_CODES.has(codeMatch[1])) {
        currency = codeMatch[1];
      }
    }

    // Amount — first number-looking run, then disambiguate separators.
    // Providers ship every locale convention: "29.99", "29,99" (EU decimal),
    // "1,299.99" (US thousands) and "₺2.699,99" (TR thousands — ChatGPT
    // Shopping, #399). Rule: when both separators appear, the LAST one is
    // the decimal point; a lone separator is decimal only when it's the
    // only one of its kind and is followed by 1-2 digits, else thousands.
    const amountMatch = trimmed.replace(/\s+/g, '').match(/-?\d[\d.,]*/);
    let amount = null;
    if (amountMatch) {
      let s = amountMatch[0];
      const lastDot = s.lastIndexOf('.');
      const lastComma = s.lastIndexOf(',');
      if (lastDot !== -1 && lastComma !== -1) {
        const thousands = lastDot > lastComma ? ',' : '.';
        s = s.split(thousands).join('');
        if (thousands === '.') s = s.replace(',', '.');
      } else if (lastComma !== -1) {
        const frac = s.length - lastComma - 1;
        s =
          frac >= 1 && frac <= 2 && s.indexOf(',') === lastComma
            ? s.replace(',', '.')
            : s.split(',').join('');
      } else if (lastDot !== -1) {
        const frac = s.length - lastDot - 1;
        if (!(frac >= 1 && frac <= 2 && s.indexOf('.') === lastDot)) {
          s = s.split('.').join('');
        }
      }
      const parsed = Number.parseFloat(s);
      amount = Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : null;
    }

    return {
      amount,
      currency,
    };
  }

  return { amount: null, currency: null };
}

/**
 * @param {unknown} value
 * @returns {number|null}
 */
function toNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = Number.parseFloat(value.replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * @param {unknown} value
 * @returns {number|null}
 */
function toInteger(value) {
  const n = toNumber(value);
  return n == null ? null : Math.round(n);
}

/**
 * @param {unknown} value
 * @returns {string|null}
 */
function toStringOrNull(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Perplexity card normalizer. Snake_case provider shape:
 *
 *   { title, brand, price, image_url, url, rating, review_count, merchant, … }
 *
 * @param {object} card
 * @param {number} position
 */
export function parsePerplexityCard(card, position) {
  const price = parsePrice(card.price);
  const merchantUrl = toStringOrNull(card.url ?? card.link);
  return {
    position,
    product_title: toStringOrNull(card.title ?? card.name),
    product_brand: toStringOrNull(card.brand ?? card.merchant),
    price_amount: price.amount,
    price_currency: price.currency,
    image_url: toStringOrNull(card.image_url ?? card.image),
    merchant_url: merchantUrl,
    merchant_domain: extractDomain(merchantUrl),
    rating: toNumber(card.rating),
    review_count: toInteger(card.review_count ?? card.reviews),
    raw: card,
  };
}

/**
 * Google AI Mode card normalizer. CamelCase provider shape:
 *
 *   { title, brand, price, imageUrl, url, rating, reviewCount, merchant, … }
 *
 * @param {object} card
 * @param {number} position
 */
export function parseAiModeCard(card, position) {
  const price = parsePrice(card.price);
  const merchantUrl = toStringOrNull(card.url ?? card.link);
  return {
    position,
    product_title: toStringOrNull(card.title ?? card.name ?? card.productName),
    product_brand: toStringOrNull(card.brand ?? card.merchant),
    price_amount: price.amount,
    price_currency: price.currency,
    image_url: toStringOrNull(card.imageUrl ?? card.image),
    merchant_url: merchantUrl,
    merchant_domain: extractDomain(merchantUrl),
    rating: toNumber(card.rating),
    review_count: toInteger(card.reviewCount ?? card.reviews),
    raw: card,
  };
}

/**
 * Microsoft Copilot product normalizer. Per the Cloro docs, Copilot ships
 * shopping data as wrapper objects `{ type, layout, products: [ … ] }`;
 * `normalizeShoppingCards` flattens those, so this receives an individual
 * product:
 *
 *   { product, position, offerId, url, name, description, images,
 *     specifications, tags, price, discountPrice, seller, sellerLogoUrl,
 *     brandName, rating: { value, count }, canTrackPrice }
 *
 * Older fallbacks (`productName`, `imageUrl`, numeric `rating`) are kept so a
 * shape change doesn't silently null the columns.
 *
 * @param {object} card
 * @param {number} position
 */
export function parseCopilotCard(card, position) {
  const price = parsePrice(card.price ?? card.discountPrice);
  const merchantUrl = toStringOrNull(card.url ?? card.link ?? card.productUrl);
  // Images ship as `[{ title, url }]`; older shapes used a flat `imageUrl`.
  const imageUrl =
    toStringOrNull(card.imageUrl ?? card.image) ??
    (Array.isArray(card.images) ? toStringOrNull(card.images[0]?.url) : null);
  // Rating is an object `{ value, count }` in the documented shape, but
  // tolerate a bare number from older/other shapes.
  const ratingObj = card.rating && typeof card.rating === 'object' ? card.rating : null;
  return {
    // The provider's own `position` is a flat 1-indexed rank across every
    // card in the response — unique per result, so prefer it over the array
    // index (which resets once we flatten the `products[]` wrappers).
    position: toInteger(card.position) ?? position,
    product_title: toStringOrNull(card.name ?? card.productName ?? card.title),
    product_brand: toStringOrNull(
      card.brandName ?? card.productBrand ?? card.brand ?? card.seller ?? card.merchantName,
    ),
    price_amount: price.amount,
    price_currency: price.currency,
    image_url: imageUrl,
    merchant_url: merchantUrl,
    merchant_domain: extractDomain(merchantUrl),
    rating: ratingObj ? toNumber(ratingObj.value) : toNumber(card.rating),
    review_count: ratingObj
      ? toInteger(ratingObj.count)
      : toInteger(card.reviewCount ?? card.reviewsCount ?? card.reviews ?? card.review),
    raw: card,
  };
}

/**
 * ChatGPT Shopping product normalizer (#399). Cloro ships shopping data as
 * `{ products: [ … ], tags }` wrappers; `normalizeShoppingCards` flattens
 * those, so this receives an individual product (snake_case, derived from
 * captured production payloads):
 *
 *   { id, title, url, price: "₺2.699,99", image_urls: [ … ],
 *     merchants: "kayra.com", rating, num_reviews, position, query,
 *     offers: [{ url, price, brand, tag, details, … }], variants, specs,
 *     price_history, … }
 *
 * Unlike the other parsers, `raw` keeps only a compact subset: a single
 * ChatGPT product runs to tens of KB (variants, price_history, specs,
 * analytics metadata), and the full original is already persisted on
 * `prompt_results.shopping_cards` — which is what the backfill script
 * re-derives from, so nothing is lost by trimming here.
 *
 * @param {object} card
 * @param {number} position
 */
export function parseChatgptCard(card, position) {
  const firstOffer =
    Array.isArray(card.offers) && card.offers[0] && typeof card.offers[0] === 'object'
      ? card.offers[0]
      : null;
  const price = parsePrice(card.price ?? firstOffer?.price);
  const merchantUrl = toStringOrNull(card.url) ?? toStringOrNull(firstOffer?.url);
  // `merchants` is a bare string in captured payloads; tolerate an array.
  const merchant = Array.isArray(card.merchants)
    ? toStringOrNull(card.merchants[0])
    : toStringOrNull(card.merchants);
  return {
    position: toInteger(card.position) ?? position,
    product_title: toStringOrNull(card.title ?? card.name),
    product_brand: toStringOrNull(firstOffer?.brand) ?? merchant,
    price_amount: price.amount,
    price_currency: price.currency,
    image_url: Array.isArray(card.image_urls)
      ? toStringOrNull(card.image_urls[0])
      : toStringOrNull(card.image_url ?? card.image),
    merchant_url: merchantUrl,
    merchant_domain: extractDomain(merchantUrl),
    rating: toNumber(card.rating),
    review_count: toInteger(card.num_reviews ?? card.review_count),
    raw: {
      id: card.id ?? null,
      title: card.title ?? null,
      url: card.url ?? null,
      price: card.price ?? null,
      merchants: card.merchants ?? null,
      rating: card.rating ?? null,
      num_reviews: card.num_reviews ?? null,
      position: card.position ?? null,
      query: card.query ?? null,
      offers: firstOffer
        ? [
            {
              url: firstOffer.url ?? null,
              price: firstOffer.price ?? null,
              brand: firstOffer.brand ?? null,
            },
          ]
        : [],
    },
  };
}

/**
 * Pick the right normalizer for a platform / scraper id.
 *
 * NB: `chatgpt-shopping` matches exactly — plain `chatgpt-web` answers never
 * carry shopping cards, and keeping it unmatched preserves the "unsupported
 * platform → []" behavior for it.
 *
 * @param {string|null|undefined} platform
 */
function pickParser(platform) {
  if (!platform || typeof platform !== 'string') return null;
  const p = platform.toLowerCase();
  if (p.startsWith('perplexity')) return parsePerplexityCard;
  if (p.startsWith('google-aimode') || p === 'google-ai-mode') return parseAiModeCard;
  if (p.startsWith('copilot')) return parseCopilotCard;
  if (p === 'chatgpt-shopping') return parseChatgptCard;
  return null;
}

/**
 * Some providers (Microsoft Copilot, ChatGPT Shopping) return shopping data
 * as wrapper objects — `{ type: 'shoppingProducts', layout, products: [ … ] }`
 * or `{ products: [ … ], tags }` — rather than a flat array of product cards.
 * Flatten any such wrapper into its `products` so each product becomes its
 * own normalized card. Elements that are already flat product objects pass
 * through untouched.
 *
 * @param {unknown[]} cards
 * @returns {object[]}
 */
function flattenProductWrappers(cards) {
  const out = [];
  for (const card of cards) {
    if (!card || typeof card !== 'object') continue;
    if (Array.isArray(card.products)) {
      for (const product of card.products) {
        if (product && typeof product === 'object') out.push(product);
      }
    } else {
      out.push(card);
    }
  }
  return out;
}

/**
 * Normalize the raw `shopping_cards` array off a prompt_results row into
 * an array of analytical-column-shaped objects ready for insert.
 *
 * Returns `[]` for any platform without a parser or for empty input —
 * the worker can safely call this on every result without branching.
 *
 * @param {string} platform
 * @param {unknown} cards
 */
export function normalizeShoppingCards(platform, cards) {
  if (!Array.isArray(cards) || cards.length === 0) return [];
  const parser = pickParser(platform);
  if (!parser) return [];
  return flattenProductWrappers(cards)
    .map((card, i) => {
      try {
        return parser(card, i);
      } catch (err) {
        // A bad card shouldn't kill the whole batch — log and drop.
        logger.error({ err, platform, position: i }, '[shopping-cards] parser failed');
        return null;
      }
    })
    .filter(Boolean);
}

/**
 * Normalize ChatGPT's single in-answer products (`prompt_results.inline_products`,
 * each `{ product, … }`) into the same rows as its carousel cards.
 *
 * They take the positions after `afterPosition`, the carousel's last, so the
 * two never collide on (prompt_result_id, position), and `raw.surface` tells
 * them apart. Only ChatGPT Shopping has inline products; any other platform
 * returns `[]`.
 *
 * @param {string} platform
 * @param {unknown} items
 * @param {number} [afterPosition]
 */
export function normalizeInlineProducts(platform, items, afterPosition = 0) {
  if (platform !== 'chatgpt-shopping' || !Array.isArray(items)) return [];
  const products = items
    .map((item) => item?.product)
    .filter((product) => product && typeof product === 'object');
  return products
    .map((product, i) => {
      try {
        const card = parseChatgptCard(product, 0);
        return {
          ...card,
          position: afterPosition + i + 1,
          raw: { ...card.raw, surface: 'inline' },
        };
      } catch (err) {
        logger.error({ err, platform, position: i }, '[shopping-cards] inline parser failed');
        return null;
      }
    })
    .filter(Boolean);
}

/**
 * Match a normalized card against the tracked brand and competitors.
 * Returns `{ matched_brand_id, matched_brand_role }`.
 *
 *   - `own` when the product brand, product title, or merchant domain
 *     contains the tracked brand name OR matches one of its domains.
 *     `matched_brand_id` is the brand's uuid.
 *   - `competitor` when those same fields contain a tracked competitor's
 *     name or merchant domain. `matched_brand_id` is the competitor's uuid.
 *   - `other` otherwise. `matched_brand_id` is null.
 *
 * Substring matching mirrors the citations matcher in responseParser.js —
 * keeps the two surfaces aligned without an extra dependency.
 *
 * @param {ReturnType<typeof parsePerplexityCard>} card
 * @param {{ brandId: string, brandName: string, domains: string[] }} brand
 * @param {Array<{ id: string, name: string, domain: string|null }>} competitors
 */
export function matchCardBrand(card, brand, competitors) {
  const blob = [card.product_brand, card.product_title, card.merchant_domain]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  const brandName = brand.brandName?.toLowerCase() ?? '';
  if (brandName && blob.includes(brandName)) {
    return { matched_brand_id: brand.brandId, matched_brand_role: 'own' };
  }
  for (const domain of brand.domains ?? []) {
    const d = domain?.toLowerCase();
    if (d && card.merchant_domain === d) {
      return { matched_brand_id: brand.brandId, matched_brand_role: 'own' };
    }
  }

  for (const comp of competitors ?? []) {
    const compName = comp.name?.toLowerCase();
    if (compName && blob.includes(compName)) {
      return { matched_brand_id: comp.id, matched_brand_role: 'competitor' };
    }
    const compDomain = comp.domain?.toLowerCase();
    if (compDomain && card.merchant_domain === compDomain) {
      return { matched_brand_id: comp.id, matched_brand_role: 'competitor' };
    }
  }

  return { matched_brand_id: null, matched_brand_role: 'other' };
}
