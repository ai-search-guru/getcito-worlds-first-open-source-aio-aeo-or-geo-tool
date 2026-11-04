import { describe, expect, it } from 'vitest';
import SAME_AS_THE_SERVER from './__fixtures__/product-block.json';
import { MAX_BLOCK_PRODUCTS, productBlockHtml, productHref } from './productBlock';

/** Product card and product grid (shopping path, part 5). */

describe('productBlockHtml', () => {
  // backend/src/lib/shoppingBlocks.test.js reads the same products and expects the same markup.
  it('writes picture, name and price, linked over https without tracking, escaped, and leaves out what has no page', () => {
    expect(productBlockHtml(SAME_AS_THE_SERVER.products)).toBe(SAME_AS_THE_SERVER.html);
  });

  it('shows four at most, the first that have a page, and nothing with none', () => {
    const many = [
      { title: 'No page', url: 'http://s.example/p0', image: null, price: null },
      ...Array.from({ length: 6 }, (_, i) => ({
        title: `P${i + 1}`,
        url: `https://s.example/p${i + 1}`,
        image: null,
        price: null,
      })),
    ];
    const code = productBlockHtml(many);
    expect(code.match(/class="getcito-product"/g)).toHaveLength(MAX_BLOCK_PRODUCTS);
    expect(code).toContain('>P4</strong>');
    expect(productBlockHtml([])).toBe('');
  });
});

describe('productHref', () => {
  it('links an https page without tracking or a hash, and nothing else', () => {
    expect(productHref('https://shop.example/p?utm_medium=x&gclid=1&size=9#top')).toBe(
      'https://shop.example/p?size=9',
    );
    expect(productHref('http://shop.example/p')).toBeNull();
    expect(productHref('javascript:alert(1)')).toBeNull();
    expect(productHref('/p')).toBeNull();
    expect(productHref(null)).toBeNull();
  });
});
