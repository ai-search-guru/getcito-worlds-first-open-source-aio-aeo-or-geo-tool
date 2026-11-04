import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../config/supabase.js', () => ({ default: {} }));

import {
  htmlBlockElement,
  insertProductGrid,
  priceText,
  productBlockHtml,
} from './shoppingBlocks.js';

/** The product grid a new page gets from its shopping path (shopping path, part 5). */

// The editor's productBlock.test.ts reads the same products and expects the same markup.
const SAME_AS_THE_EDITOR = JSON.parse(
  readFileSync(
    new URL('../../../frontend/src/lib/content/__fixtures__/product-block.json', import.meta.url),
    'utf8',
  ),
);

const product = (id, title, extra = {}) => ({
  id,
  title,
  url: `https://shop.example/products/${id}`,
  price: 189,
  salePrice: null,
  currency: 'USD',
  availability: 'in_stock',
  image: null,
  issues: [],
  score: 9,
  ...extra,
});

describe('priceText', () => {
  it('writes a price in its currency, the sale price when it is under the price', () => {
    expect(priceText({ price: 189, salePrice: null, currency: 'USD' })).toBe('$189.00');
    expect(priceText({ price: 149, salePrice: 129, currency: 'EUR' })).toBe('€129.00');
    expect(priceText({ price: null, salePrice: null, currency: 'USD' })).toBeNull();
  });

  it('reads a price of 0 as none, a sale price not under the price as no sale, and a sale price alone as the price', () => {
    expect(priceText({ price: 0, salePrice: null, currency: 'USD' })).toBeNull();
    expect(priceText({ price: 149, salePrice: 0, currency: 'USD' })).toBe('$149.00');
    expect(priceText({ price: 149, salePrice: 149, currency: 'USD' })).toBe('$149.00');
    expect(priceText({ price: 149, salePrice: 159, currency: 'USD' })).toBe('$149.00');
    expect(priceText({ price: null, salePrice: 129, currency: 'USD' })).toBe('$129.00');
    expect(priceText({ price: null, salePrice: null, currency: 'USD' })).toBeNull();
  });
});

describe('productBlockHtml', () => {
  it("writes the editor's markup: picture, name and price, linked over https without tracking, escaped", () => {
    expect(productBlockHtml(SAME_AS_THE_EDITOR.products)).toBe(SAME_AS_THE_EDITOR.html);
    expect(productBlockHtml([])).toBe('');
  });

  it('shows four at most, the first that have a page', () => {
    const many = [
      { title: 'No page', url: 'http://s.example/p0', image: null, price: null },
      ...Array.from({ length: 5 }, (_, i) => ({
        title: `P${i + 1}`,
        url: `https://s.example/p${i + 1}`,
        image: null,
        price: null,
      })),
    ];
    const code = productBlockHtml(many);
    expect(code.match(/class="getcito-product"/g)).toHaveLength(4);
    expect(code).toContain('>P4</strong>');
    expect(code).not.toContain('>P5</strong>');
  });
});

describe('htmlBlockElement', () => {
  it('stores the code as the editor does: UTF-8 in base64', () => {
    const element = htmlBlockElement('<p>Bot – ü</p>');
    const encoded = /data-html-block="([^"]+)"/.exec(element)[1];
    expect(Buffer.from(encoded, 'base64').toString('utf8')).toBe('<p>Bot – ü</p>');
  });
});

describe('insertProductGrid', () => {
  const path = {
    pageType: 'buying_guide',
    products: [product('p1', 'Summit GTX Boot'), product('p2', 'Trail Mid')],
  };
  const link = (id) => `<a href="https://shop.example/products/${id}">x</a>`;
  const decoded = (html) =>
    [...html.matchAll(/data-html-block="([^"]+)"/g)].map((m) =>
      Buffer.from(m[1], 'base64').toString('utf8'),
    );

  it('puts the grid at the end of the section that links the products most', () => {
    const html =
      '<h1>T</h1><p>Intro</p><h2>Choose</h2><p>How.</p>' +
      `<h2>Picks</h2><p>${link('p1')}</p><ul><li><p>${link('p2')}</p></li></ul>` +
      `<h2>FAQ</h2><h3>Q?</h3><p>${link('p1')}</p>`;
    const out = insertProductGrid(html, path);
    expect(out.indexOf('data-html-block')).toBeGreaterThan(out.indexOf('</ul>'));
    expect(out.indexOf('data-html-block')).toBeLessThan(out.indexOf('<h2>FAQ</h2>'));
    expect(decoded(out)[0]).toContain('https://shop.example/products/p2');
  });

  it('picks the section that links them most wherever it is, not the first or the last that links one', () => {
    // One link before it, one after, and the FAQ last: only the count decides.
    const html =
      `<h1>T</h1><h2>Brands</h2><p>${link('p1')}</p>` +
      `<h2>Picks</h2><p>${link('p1')} ${link('p2')}</p><p>Why.</p>` +
      `<h2>Compare</h2><p>${link('p2')}</p>` +
      '<h2>Care</h2><p>c</p><h2>FAQ</h2><p>q</p>';
    expect(insertProductGrid(html, path)).toMatch(
      /<p>Why\.<\/p><div data-html-block="[^"]+"><\/div><h2>Compare<\/h2>/,
    );
    // Two sections link them as often: the first of them.
    const tie =
      `<h1>T</h1><h2>Intro</h2><p>i</p><h2>Picks</h2><p>${link('p1')} ${link('p2')}</p>` +
      `<h2>More</h2><p>${link('p2')} ${link('p1')}</p><h2>FAQ</h2><p>q</p>`;
    expect(insertProductGrid(tie, path)).toMatch(
      /p2">x<\/a><\/p><div data-html-block="[^"]+"><\/div><h2>More<\/h2>/,
    );
  });

  it("counts only links to the grid's products, not to other pages", () => {
    const html =
      '<h1>T</h1><h2>Brands</h2>' +
      '<p><a href="https://other.example/a">a</a> <a href="https://shop.example/about">b</a></p>' +
      `<h2>Picks</h2><p>${link('p1')}</p><h2>FAQ</h2><p>q</p>`;
    const out = insertProductGrid(html, path);
    expect(out).toMatch(
      /<a href="https:\/\/shop\.example\/products\/p1">x<\/a><\/p><div data-html-block=/,
    );
  });

  it('puts it before the last H2 when no section links them, a lone one too, or at the end with none', () => {
    const out = insertProductGrid('<h1>T</h1><h2>A</h2><p>a</p><h2>FAQ</h2><p>q</p>', path);
    expect(out).toMatch(/<p>a<\/p><div data-html-block="[^"]+"><\/div><h2>FAQ<\/h2>/);
    // One H2, linking none of them: before it, not after its section.
    expect(insertProductGrid('<h1>T</h1><p>a</p><h2>FAQ</h2><p>q</p>', path)).toMatch(
      /<p>a<\/p><div data-html-block="[^"]+"><\/div><h2>FAQ<\/h2><p>q<\/p>$/,
    );
    expect(insertProductGrid('<h1>T</h1><p>a</p>', path)).toMatch(/<p>a<\/p><div data-html-block=/);
  });

  it('shows only the products in stock, as the catalog has them now', () => {
    const withOut = (availability) => ({
      ...path,
      products: [...path.products, product('p3', 'Ridge Low', { availability })],
    });
    for (const availability of ['out_of_stock', '']) {
      const code = decoded(insertProductGrid('<h1>T</h1><p>a</p>', withOut(availability)))[0];
      expect(code).toContain('Summit GTX Boot');
      expect(code).not.toContain('Ridge Low');
    }
    expect(
      decoded(insertProductGrid('<h1>T</h1><p>a</p>', withOut('limited_availability')))[0],
    ).toContain('Ridge Low');
    // One left in stock: no grid.
    const html = '<h1>T</h1><p>a</p>';
    expect(
      insertProductGrid(html, {
        ...path,
        products: [path.products[0], { ...path.products[1], availability: 'out_of_stock' }],
      }),
    ).toBe(html);
  });

  it("writes each one's price as the path has it, and links only https pages", () => {
    const code = decoded(
      insertProductGrid('<h1>T</h1><p>a</p>', {
        ...path,
        products: [
          product('p1', 'Summit GTX Boot', { price: 149, salePrice: 129 }),
          product('p2', 'Trail Mid', { price: 0 }),
          product('p3', 'Ridge Low', { url: 'http://shop.example/products/p3' }),
        ],
      }),
    )[0];
    expect(code).toContain('$129.00');
    expect(code).not.toContain('$149.00');
    expect(code).not.toContain('$0.00');
    expect(code).not.toContain('Ridge Low');
  });

  it('leaves a page type without a grid, or a path with one product, as it is', () => {
    const html = '<h1>T</h1><h2>A</h2><p>a</p>';
    expect(insertProductGrid(html, { ...path, pageType: 'blog_post' })).toBe(html);
    expect(insertProductGrid(html, { ...path, products: [product('p1', 'One')] })).toBe(html);
    expect(insertProductGrid(html, null)).toBe(html);
  });
});
