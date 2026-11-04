import { describe, expect, it } from 'vitest';
import { bestInStock, priceAmount } from './offer.js';

/** The price a catalog product is shown with, one rule everywhere (#1607 follow-up). */

describe('priceAmount', () => {
  it('takes the sale price under the price, else the price', () => {
    expect(priceAmount({ price: 199, salePrice: 149 })).toBe(149);
    expect(priceAmount({ price: 199, salePrice: 249 })).toBe(199);
    expect(priceAmount({ price: '199.00', salePrice: null })).toBe(199);
  });

  it('keeps a sale price when there is no price, and reads 0 as none', () => {
    expect(priceAmount({ price: null, salePrice: 149 })).toBe(149);
    expect(priceAmount({ price: 0, salePrice: 149 })).toBe(149);
    expect(priceAmount({ price: 199, salePrice: 0 })).toBe(199);
    expect(priceAmount({ price: 0, salePrice: null })).toBeNull();
  });
});

const variant = (price, availability, sale_price = null) => ({ price, sale_price, availability });

describe('bestInStock', () => {
  it('prefers in stock to low stock, whatever the price', () => {
    const inStock = variant(199, 'in stock');
    expect(bestInStock([variant(149, 'limited_availability'), inStock])).toBe(inStock);
  });

  it('takes the lowest price at the best stock, a sale counted, one with no price last', () => {
    const onSale = variant(220, 'in_stock', 150);
    expect(bestInStock([variant(null, 'in stock'), variant(180, 'In Stock'), onSale])).toBe(onSale);
    const priced = variant(90, 'limited availability');
    expect(bestInStock([variant(null, 'limited_availability'), priced])).toBe(priced);
  });

  it('is null with none in stock: pre-order, back-order and none given are not', () => {
    expect(
      bestInStock([variant(10, 'preorder'), variant(12, 'backorder'), variant(14, null)]),
    ).toBeNull();
  });
});
