/** A reseller is flagged when it is at least this much below the brand's store. */
export const RESELLER_PRICE_MIN_DISCOUNT = 0.05;

export type MerchantKind = 'own' | 'marketplace' | 'reseller';

/**
 * The lowest price one merchant showed for one of the brand's own products in
 * the window, as shopping_own_product_offers (00268) returns it.
 */
export interface ShoppingPriceOffer {
  merchantKind: MerchantKind;
  /** Marketplace id (amazon, ebay, …) for marketplace offers, else null. */
  marketplace: string | null;
  merchantDomain: string | null;
  merchantUrl: string | null;
  /** Marketplace-native listing id, such as an Amazon ASIN. */
  listingId: string | null;
  productTitle: string | null;
  priceAmount: number;
  priceCurrency: string | null;
}

export interface ResellerPriceAlert {
  /** The title on the brand's store, else the reseller's. */
  productTitle: string | null;
  currency: string;
  ownPrice: number;
  /** Null when the stored link isn't an http(s) URL. */
  ownUrl: string | null;
  ownDomain: string | null;
  resellerPrice: number;
  resellerUrl: string | null;
  resellerDomain: string | null;
  resellerKind: Exclude<MerchantKind, 'own'>;
  marketplace: string | null;
  /** How far below the store's price the reseller is: 0.175 is 17.5% lower. */
  discount: number;
}

/**
 * Lowercased, accents and punctuation dropped, spaces collapsed: "Acme Runner
 * 2 – Black" and "acme runner 2 black" are the same product.
 */
export function normalizeProductTitle(title: string | null | undefined): string {
  return (title ?? '')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function normalizeCurrency(currency: string | null | undefined): string {
  return (currency ?? '').trim().toUpperCase();
}

/** Only http(s) links are shown; a scheme-less merchant link gets https. */
function safeLink(url: string | null | undefined): string | null {
  const raw = url?.trim();
  if (!raw) return null;
  try {
    const parsed = new URL(/^[a-z][a-z\d+.-]*:/i.test(raw) ? raw : `https://${raw}`);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null;
  } catch {
    return null;
  }
}

function domainOf(offer: ShoppingPriceOffer, link: string | null): string | null {
  if (offer.merchantDomain) return offer.merchantDomain;
  if (!link) return null;
  try {
    return new URL(link).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/**
 * The keys that make two offers the same product: the marketplace listing id,
 * else the normalized title. Every offer here is already one of the brand's
 * own products (matched_brand_role = 'own'), which stands for the brand half
 * of "title plus brand": the cards' product_brand often carries the seller
 * instead ("Marketplace + others"), so it would keep a store and a reseller
 * apart even when they sell the same product.
 */
function matchKeys(offer: ShoppingPriceOffer): string[] {
  const keys: string[] = [];
  const listingId = offer.listingId?.trim();
  if (listingId) keys.push(`listing:${offer.marketplace ?? ''}:${listingId.toUpperCase()}`);
  const title = normalizeProductTitle(offer.productTitle);
  if (title) keys.push(`title:${title}`);
  return keys;
}

/** Group offers that share any key, so a listing id links titles that differ. */
function productGroups(offers: readonly ShoppingPriceOffer[]): ShoppingPriceOffer[][] {
  const parent = offers.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const firstWithKey = new Map<string, number>();
  offers.forEach((offer, i) => {
    for (const key of matchKeys(offer)) {
      const first = firstWithKey.get(key);
      if (first === undefined) firstWithKey.set(key, i);
      else parent[find(i)] = find(first);
    }
  });

  const groups = new Map<number, ShoppingPriceOffer[]>();
  offers.forEach((offer, i) => {
    if (matchKeys(offer).length === 0) return;
    const root = find(i);
    const group = groups.get(root);
    if (group) group.push(offer);
    else groups.set(root, [offer]);
  });
  return [...groups.values()];
}

function cheapest(offers: readonly ShoppingPriceOffer[]): ShoppingPriceOffer | null {
  let best: ShoppingPriceOffer | null = null;
  for (const offer of offers) {
    if (!best || offer.priceAmount < best.priceAmount) best = offer;
  }
  return best;
}

/**
 * Flag the brand's products a reseller or marketplace sells for at least 5%
 * less than the lowest price seen on the brand's own store, in the same
 * currency. Prices in different currencies are never compared. One alert per
 * product and currency, for its cheapest reseller; biggest gaps first.
 */
export function detectResellerPriceAlerts(
  input: readonly ShoppingPriceOffer[],
): ResellerPriceAlert[] {
  const offers = input.filter(
    (offer) =>
      Number.isFinite(offer.priceAmount) &&
      offer.priceAmount > 0 &&
      normalizeCurrency(offer.priceCurrency) !== '',
  );

  const alerts: ResellerPriceAlert[] = [];
  for (const group of productGroups(offers)) {
    const currencies = new Set(group.map((offer) => normalizeCurrency(offer.priceCurrency)));
    for (const currency of currencies) {
      const inCurrency = group.filter(
        (offer) => normalizeCurrency(offer.priceCurrency) === currency,
      );
      const own = cheapest(inCurrency.filter((offer) => offer.merchantKind === 'own'));
      const other = cheapest(inCurrency.filter((offer) => offer.merchantKind !== 'own'));
      if (!own || !other || other.merchantKind === 'own') continue;

      const discount = (own.priceAmount - other.priceAmount) / own.priceAmount;
      // The tolerance keeps an exact 5% gap (19.99 → 18.9905) from missing on float error.
      if (discount < RESELLER_PRICE_MIN_DISCOUNT - 1e-9) continue;

      const ownUrl = safeLink(own.merchantUrl);
      const resellerUrl = safeLink(other.merchantUrl);
      alerts.push({
        productTitle: own.productTitle?.trim() || other.productTitle?.trim() || null,
        currency,
        ownPrice: own.priceAmount,
        ownUrl,
        ownDomain: domainOf(own, ownUrl),
        resellerPrice: other.priceAmount,
        resellerUrl,
        resellerDomain: domainOf(other, resellerUrl),
        resellerKind: other.merchantKind,
        marketplace: other.marketplace,
        discount,
      });
    }
  }

  return alerts.sort(
    (a, b) => b.discount - a.discount || (a.productTitle ?? '').localeCompare(b.productTitle ?? ''),
  );
}
