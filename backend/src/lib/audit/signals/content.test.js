import { describe, expect, it } from 'vitest';
import * as cheerio from 'cheerio';
import { productDescriptionOpening } from './content.js';

/**
 * #1279: on a product page, the description's first 40 words or 250
 * characters name the product type and two key attributes; other pages
 * don't count.
 */

const page = (head, body = '') => ({
  $: cheerio.load(`<html><head>${head}</head><body>${body}</body></html>`),
});

const productLd = (product) =>
  `<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Product',
    ...product,
  })}</script>`;

describe('productDescriptionOpening', () => {
  it('passes a product page whose description opens with the type and attributes', () => {
    const result = productDescriptionOpening.evaluate(
      page(
        productLd({
          name: 'Acme Ridge Men’s Trail Running Shoe',
          brand: { '@type': 'Brand', name: 'Acme' },
          description:
            'Men’s trail running shoe, 268 g, 6 mm drop, with a grippy outsole for wet rock and mud.',
        }),
      ),
    );
    expect(result.status).toBe('pass');
    expect(result.score).toBe(1);
    expect(result.evidence.attributes).toEqual(expect.arrayContaining(['268 g', '6 mm']));
    expect(result.evidence.reason).toContain('Product type named there: yes');
  });

  it('fails a brand-story opening, and says where the opening ends', () => {
    const description =
      'Since 1987, our family has crafted every pair by hand in a small workshop at the foot of the Alps. ' +
      'We believe the mountains belong to everyone, and every step you take carries a little of our story. ' +
      'This men’s trail running shoe weighs 268 g and has a 6 mm drop.';
    const result = productDescriptionOpening.evaluate(
      page(productLd({ name: 'Acme Men’s Trail Running Shoe', brand: 'Acme', description })),
    );
    expect(result.status).toBe('fail');
    expect(result.score).toBe(0);
    expect(result.evidence.cut).toBeLessThan(description.indexOf('trail running shoe'));
    expect(result.evidence.reason).toContain('Product type named there: no');
    expect(result.evidence.reason).toContain('Key attributes there: none');
  });

  it('warns when the opening names the type but only one attribute', () => {
    const result = productDescriptionOpening.evaluate(
      page(
        productLd({
          name: 'Summit Daypack Backpack',
          brand: 'Summit',
          description: 'A lightweight backpack for every adventure, made by people who care.',
        }),
      ),
    );
    expect(result.status).toBe('warn');
    expect(result.score).toBe(0.5);
  });

  it('reads the microdata description when the schema has none', () => {
    const result = productDescriptionOpening.evaluate(
      page(
        productLd({ name: 'Northwind Crew Neck T-Shirt', brand: 'Northwind' }),
        '<div itemprop="description"><p>Slim fit organic cotton crew neck t-shirt.</p></div>',
      ),
    );
    expect(result.status).toBe('pass');
  });

  it('is n/a on a page with no Product structured data, or no description', () => {
    expect(productDescriptionOpening.evaluate(page('<title>Blog</title>')).status).toBe('na');
    expect(
      productDescriptionOpening.evaluate(page(productLd({ name: 'Acme Trail Shoe' }))).status,
    ).toBe('na');
  });
});
