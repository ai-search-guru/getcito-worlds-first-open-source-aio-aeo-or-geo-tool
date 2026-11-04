import { describe, expect, it } from 'vitest';
import {
  feedCheck,
  feedStock,
  pageKey,
  stockOnPage,
  variantStock,
  type FeedVariant,
} from './feedMatch';

/** A product page against its product feed (Quality spec §11, CE-053). */

const variant = (over: Partial<FeedVariant> = {}): FeedVariant => ({
  price: 129,
  salePrice: null,
  currency: 'USD',
  availability: 'in_stock',
  gtin: null,
  ...over,
});

describe('pageKey', () => {
  it('reads an address as feeds write it: no www, trailing slash or query', () => {
    expect(pageKey('https://www.Acme.com/products/Ridge-28/?variant=42#specs')).toBe(
      'acme.com/products/ridge-28',
    );
    expect(pageKey('http://acme.com/products/ridge-28')).toBe('acme.com/products/ridge-28');
    expect(pageKey('https://acme.com.tr/%C3%BCr%C3%BCn/')).toBe('acme.com.tr/ürün');
    expect(pageKey('https://acme.com.tr/ürün')).toBe('acme.com.tr/ürün');
    expect(pageKey('ftp://acme.com/x')).toBeNull();
    expect(pageKey('not a url')).toBeNull();
    expect(pageKey(null)).toBeNull();
  });
});

describe('stockOnPage', () => {
  it('reads what the page says of its stock, and none where it says both', () => {
    expect(stockOnPage(['Ships in 2 days.', 'In stock and ready to ship.'])).toEqual({
      stock: 'in',
      sentence: 'In stock and ready to ship.',
    });
    expect(stockOnPage(['Sorry, this one is sold out.'])?.stock).toBe('out');
    expect(stockOnPage(['Stokta yok.'])?.stock).toBe('out');
    expect(stockOnPage(['Stokta, hemen kargoda.'])?.stock).toBe('in');
    expect(stockOnPage(['Derzeit ausverkauft.'])?.stock).toBe('out');
    expect(stockOnPage(['Black is in stock.', 'Blue is out of stock.'])).toBeNull();
    // Out, however it's said: not, no longer, "email me when it's back in stock".
    for (const out of [
      'Email me when it is back in stock.',
      'Not in stock right now.',
      'No longer in stock.',
      'Bu ürün stokta değil.',
      'Stokta kalmadı.',
      'Ürün stokta yoktur.',
      'Stokta bulunmamaktadır.',
      'Stokta mevcut değil.',
      'Plus en stock.',
      'Nicht mehr vorrätig.',
    ]) {
      expect(stockOnPage([out])?.stock, out).toBe('out');
    }
    // Back in stock is in stock.
    expect(stockOnPage(['Back in stock!'])?.stock).toBe('in');
    expect(stockOnPage(['In stock, back in stock alerts available.'])?.stock).toBe('in');
    // A shipping policy says nothing of this product's stock.
    expect(stockOnPage(['Orders for items in stock ship within 24 hours.'])).toBeNull();
    expect(stockOnPage(['Items not in stock ship within 3 weeks.'])).toBeNull();
    expect(stockOnPage(['Ships today.'])).toBeNull();
    expect(stockOnPage(['A daypack for wet hikes.'])).toBeNull();
  });
});

describe('feedStock', () => {
  it('is in when a variant is, out when every one is, and none for pre-orders', () => {
    expect(feedStock([variant({ availability: 'out_of_stock' }), variant()])).toBe('in');
    expect(feedStock([variant({ availability: 'out of stock' })])).toBe('out');
    expect(feedStock([variant({ availability: 'preorder' })])).toBeNull();
    expect(feedStock([variant({ availability: null })])).toBeNull();
    expect(feedStock([])).toBeNull();
  });
});

describe('variantStock', () => {
  it("reads a variant's stock as the API does, whatever its case, spaces or hyphens", () => {
    expect(variantStock('In Stock')).toBe('in');
    expect(variantStock('Limited-Availability')).toBe('in');
    expect(variantStock('SOLD OUT')).toBe('out');
    expect(variantStock('preorder')).toBeNull();
    expect(variantStock('')).toBeNull();
    expect(variantStock(null)).toBeNull();
  });
});

describe('feedCheck', () => {
  const texts = ['The Ridge 28 costs $129.', 'In stock.'];

  it('passes a page whose price and stock are the feed’s', () => {
    expect(
      feedCheck({ texts, offer: { price: 129, currency: 'USD' }, variants: [variant()] }),
    ).toEqual({ compared: 2, mismatches: [] });
    // A range is the feed's low and high; a sale price is the price now.
    expect(
      feedCheck({
        texts: ['Sizes run $119–$139.'],
        offer: { low: 119, high: 139, currency: 'USD' },
        variants: [variant({ price: 149, salePrice: 119 }), variant({ price: 139 })],
      }),
    ).toEqual({ compared: 1, mismatches: [] });
  });

  it('names a price, a GTIN or a stock that differs, with the sentence to show', () => {
    expect(
      feedCheck({
        texts,
        offer: { price: 129, currency: 'USD' },
        variants: [variant({ price: 119, availability: 'out_of_stock' })],
      }),
    ).toEqual({
      compared: 2,
      mismatches: [
        { kind: 'price', page: '$129', feed: '$119', sentence: 'The Ridge 28 costs $129.' },
        { kind: 'stock', page: 'in', feed: 'out', sentence: 'In stock.' },
      ],
    });
    // A range at the regular prices while the feed keeps an old sale.
    expect(
      feedCheck({
        texts: ['$139–$149.'],
        offer: { low: 139, high: 149, currency: 'USD' },
        variants: [variant({ price: 139, salePrice: 119 }), variant({ price: 149 })],
      }).mismatches,
    ).toEqual([]);
    // On sale in the feed: the sale price, or the regular one (the sale may be over).
    const onSale = [variant({ salePrice: 99.5 })];
    expect(
      feedCheck({ texts: ['$99.50.'], offer: { price: 99.5, currency: 'USD' }, variants: onSale })
        .mismatches,
    ).toEqual([]);
    expect(
      feedCheck({ texts: ['$129.'], offer: { price: 129, currency: 'USD' }, variants: onSale })
        .mismatches,
    ).toEqual([]);
    expect(
      feedCheck({ texts: ['$139.'], offer: { price: 139, currency: 'USD' }, variants: onSale })
        .mismatches[0],
    ).toMatchObject({ kind: 'price', page: '$139', feed: '$99.50' });
    // A GTIN's code alone, never the number after it; one that fails its check digit says nothing.
    expect(
      feedCheck({
        texts: ['UPC: 012345678905 12 months warranty.'],
        offer: null,
        variants: [variant({ gtin: '012345678905' })],
      }),
    ).toEqual({ compared: 1, mismatches: [] });
    expect(
      feedCheck({
        texts: ['EAN 1234567890123.'],
        offer: null,
        variants: [variant({ gtin: '4006381333931' })],
      }),
    ).toEqual({ compared: 0, mismatches: [] });
    // An EAN-8 by its label; all zeros is no product's code.
    expect(
      feedCheck({
        texts: ['EAN-8 96385074.'],
        offer: null,
        variants: [variant({ gtin: '96385074' })],
      }),
    ).toEqual({ compared: 1, mismatches: [] });
    expect(
      feedCheck({
        texts: ['EAN 0000000000000.'],
        offer: null,
        variants: [variant({ gtin: '4006381333931' })],
      }),
    ).toEqual({ compared: 0, mismatches: [] });
    // A GTIN the feed doesn't have; a UPC's leading zeros don't count.
    expect(
      feedCheck({
        texts: ['GTIN: 00012345678905.'],
        offer: null,
        variants: [variant({ gtin: '012345678905' })],
      }),
    ).toEqual({ compared: 1, mismatches: [] });
    expect(
      feedCheck({
        texts: ['EAN 4006381333931.'],
        offer: null,
        variants: [variant({ gtin: '4006381333948' })],
      }).mismatches,
    ).toEqual([
      {
        kind: 'gtin',
        page: '4006381333931',
        feed: '4006381333948',
        sentence: 'EAN 4006381333931.',
      },
    ]);
  });

  it('compares only what both state: no price, several, another currency, no stock', () => {
    const none = { compared: 0, mismatches: [] };
    expect(feedCheck({ texts: ['A daypack.'], offer: null, variants: [variant()] })).toEqual(none);
    expect(
      feedCheck({
        texts: ['$119. $139.'],
        offer: { several: ['$119', '$139'] },
        variants: [variant()],
      }),
    ).toEqual(none);
    expect(
      feedCheck({
        texts: ['€119.'],
        offer: { price: 119, currency: 'EUR' },
        variants: [variant({ availability: null })],
      }),
    ).toEqual(none);
  });
});
