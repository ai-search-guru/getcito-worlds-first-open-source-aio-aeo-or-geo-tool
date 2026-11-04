import { describe, expect, it } from 'vitest';
import {
  detectResellerPriceAlerts,
  normalizeProductTitle,
  type ShoppingPriceOffer,
} from './shoppingResellerPriceAlert';

function ownStore(price: number, overrides: Partial<ShoppingPriceOffer> = {}): ShoppingPriceOffer {
  return {
    merchantKind: 'own',
    marketplace: null,
    merchantDomain: 'acme.example',
    merchantUrl: 'https://acme.example/products/runner-2',
    listingId: null,
    productTitle: 'Acme Runner 2',
    priceAmount: price,
    priceCurrency: 'USD',
    ...overrides,
  };
}

function amazon(price: number, overrides: Partial<ShoppingPriceOffer> = {}): ShoppingPriceOffer {
  return {
    merchantKind: 'marketplace',
    marketplace: 'amazon',
    merchantDomain: 'amazon.com',
    merchantUrl: 'https://www.amazon.com/dp/B000000001',
    listingId: 'B000000001',
    productTitle: 'Acme Runner 2',
    priceAmount: price,
    priceCurrency: 'USD',
    ...overrides,
  };
}

describe('detectResellerPriceAlerts', () => {
  it('flags an Amazon card at 99 USD against the store at 120 USD', () => {
    expect(detectResellerPriceAlerts([ownStore(120), amazon(99)])).toEqual([
      {
        productTitle: 'Acme Runner 2',
        currency: 'USD',
        ownPrice: 120,
        ownUrl: 'https://acme.example/products/runner-2',
        ownDomain: 'acme.example',
        resellerPrice: 99,
        resellerUrl: 'https://www.amazon.com/dp/B000000001',
        resellerDomain: 'amazon.com',
        resellerKind: 'marketplace',
        marketplace: 'amazon',
        discount: 21 / 120,
      },
    ]);
  });

  it('does not flag equal prices', () => {
    expect(detectResellerPriceAlerts([ownStore(120), amazon(120)])).toEqual([]);
  });

  it('does not compare prices in different currencies', () => {
    expect(
      detectResellerPriceAlerts([ownStore(120), amazon(99, { priceCurrency: 'EUR' })]),
    ).toEqual([]);
  });

  it('flags a gap of exactly 5% despite floating-point error', () => {
    // (19.99 − 18.9905) / 19.99 is 0.049999999999999885 in floating point.
    expect(detectResellerPriceAlerts([ownStore(120), amazon(114)])).toHaveLength(1);
    expect(detectResellerPriceAlerts([ownStore(100), amazon(95)])).toHaveLength(1);
    expect(detectResellerPriceAlerts([ownStore(19.99), amazon(18.9905)])).toHaveLength(1);
  });

  it('does not flag a gap just under 5%', () => {
    expect(detectResellerPriceAlerts([ownStore(120), amazon(114.01)])).toEqual([]);
    expect(detectResellerPriceAlerts([ownStore(100), amazon(95.01)])).toEqual([]);
  });

  it("compares against the store's lowest price", () => {
    const alerts = detectResellerPriceAlerts([ownStore(130), ownStore(104), amazon(99)]);
    // 99 is under 5% below 104, the lowest store price: no alert.
    expect(alerts).toEqual([]);
  });

  it('matches by normalized title when there is no listing id', () => {
    const reseller: ShoppingPriceOffer = {
      merchantKind: 'reseller',
      marketplace: null,
      merchantDomain: 'shoes.example',
      merchantUrl: 'https://shoes.example/acme-runner-2',
      listingId: null,
      productTitle: '  ACME  Runner-2 ',
      priceAmount: 80,
      priceCurrency: 'usd',
    };
    const [alert] = detectResellerPriceAlerts([ownStore(100), reseller]);
    expect(alert).toMatchObject({
      currency: 'USD',
      ownPrice: 100,
      resellerPrice: 80,
      resellerKind: 'reseller',
      resellerDomain: 'shoes.example',
      discount: 0.2,
    });
  });

  it('links a marketplace listing to the store through another card with the same listing id', () => {
    const alerts = detectResellerPriceAlerts([
      ownStore(120),
      amazon(118),
      // Same ASIN, different title: the same product as the card above.
      amazon(90, { productTitle: 'Acme Runner 2 Mens Road Running Shoe' }),
    ]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ resellerPrice: 90, productTitle: 'Acme Runner 2' });
  });

  it('keeps different products apart', () => {
    expect(
      detectResellerPriceAlerts([
        ownStore(120),
        amazon(60, { productTitle: 'Acme Trail 5', listingId: 'B000000002' }),
      ]),
    ).toEqual([]);
  });

  it('raises one alert per product, for its cheapest reseller, biggest gap first', () => {
    const alerts = detectResellerPriceAlerts([
      ownStore(120),
      amazon(99),
      amazon(105, { marketplace: 'walmart', merchantDomain: 'walmart.com', listingId: '123' }),
      ownStore(50, { productTitle: 'Acme Sock', merchantUrl: 'https://acme.example/sock' }),
      amazon(30, { productTitle: 'Acme Sock', listingId: 'B000000003' }),
    ]);
    expect(alerts.map((a) => [a.productTitle, a.resellerPrice])).toEqual([
      ['Acme Sock', 30],
      ['Acme Runner 2', 99],
    ]);
  });

  it('never flags without a store price', () => {
    expect(
      detectResellerPriceAlerts([amazon(99), amazon(50, { listingId: 'B000000009' })]),
    ).toEqual([]);
  });

  it('ignores prices that are missing, zero or have no currency', () => {
    expect(detectResellerPriceAlerts([ownStore(120), amazon(0)])).toEqual([]);
    expect(detectResellerPriceAlerts([ownStore(120), amazon(Number.NaN)])).toEqual([]);
    expect(detectResellerPriceAlerts([ownStore(120), amazon(99, { priceCurrency: ' ' })])).toEqual(
      [],
    );
  });

  it('drops links that are not http(s)', () => {
    const [alert] = detectResellerPriceAlerts([
      ownStore(120),
      amazon(99, { merchantUrl: 'javascript:alert(1)', merchantDomain: null }),
    ]);
    expect(alert.resellerUrl).toBeNull();
    expect(alert.resellerDomain).toBeNull();
  });
});

describe('normalizeProductTitle', () => {
  it('drops case, accents, punctuation and extra spaces', () => {
    expect(normalizeProductTitle('  Café  Crème – 2-Pack! ')).toBe('cafe creme 2 pack');
    expect(normalizeProductTitle(null)).toBe('');
  });
});
