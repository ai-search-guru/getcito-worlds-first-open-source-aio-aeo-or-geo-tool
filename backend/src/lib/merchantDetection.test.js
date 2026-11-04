import { describe, expect, it } from 'vitest';
import { classifyMerchant } from './merchantDetection.js';

describe('classifyMerchant', () => {
  it.each([
    ['exact brand domain', 'https://acme.example/products/coat?utm_source=ai', ['acme.example']],
    ['brand subdomain', 'https://shop.acme.example/products/coat', ['acme.example']],
    ['scheme-less brand domain', 'shop.acme.example/products/coat', ['acme.example']],
    ['www-prefixed brand domain', 'https://www.acme.example/products/coat', ['www.acme.example']],
  ])('classifies %s as own', (_label, url, brandDomains) => {
    expect(classifyMerchant(url, { brandDomains })).toEqual({
      kind: 'own',
      marketplace: null,
      listingId: null,
    });
  });

  it('does not treat a lookalike suffix as the brand domain', () => {
    expect(
      classifyMerchant('https://notacme.example/product', { brandDomains: ['acme.example'] }),
    ).toEqual({
      kind: 'reseller',
      marketplace: null,
      listingId: null,
    });
  });

  it.each([
    ['Amazon US', 'https://www.amazon.com/dp/B0C123ABCD?tag=tracked', 'amazon', 'B0C123ABCD'],
    [
      'Amazon slugged detail path',
      'https://www.amazon.com/a-product-slug/dp/B0C123ABCD/ref=detail?tag=tracked',
      'amazon',
      'B0C123ABCD',
    ],
    ['Amazon Belgium', 'https://www.amazon.com.be/dp/B0C123ABCD', 'amazon', 'B0C123ABCD'],
    ['Amazon South Africa', 'https://www.amazon.co.za/dp/B0C123ABCD', 'amazon', 'B0C123ABCD'],
    ['Amazon short link', 'https://amzn.to/3example', 'amazon', null],
    ['Amazon EU short link', 'https://amzn.eu/d/3example', 'amazon', null],
    ['Amazon generic short link', 'https://a.co/d/3example', 'amazon', null],
    [
      'Amazon country domain',
      'https://amazon.de/gp/product/1234567890/ref=detail?campaign=x',
      'amazon',
      '1234567890',
    ],
    ['Amazon subdomain', 'https://affiliate.amazon.co.uk/dp/abc123def4', 'amazon', 'ABC123DEF4'],
    ['eBay Austria', 'https://www.ebay.at/itm/123456789012', 'ebay', '123456789012'],
    ['eBay Switzerland', 'https://www.ebay.ch/itm/123456789012', 'ebay', '123456789012'],
    ['eBay US short link', 'https://ebay.us/abc123', 'ebay', null],
    [
      'eBay direct item path',
      'https://www.ebay.com/itm/123456789012?campid=abc',
      'ebay',
      '123456789012',
    ],
    [
      'eBay slugged item path',
      'https://www.ebay.co.uk/itm/vintage-lamp/123456789012?var=1',
      'ebay',
      '123456789012',
    ],
    [
      'Walmart item path',
      'https://www.walmart.com/ip/Blue-Wool-Coat/123456789?athbdg=x',
      'walmart',
      '123456789',
    ],
    ['Walmart item-only path', 'https://business.walmart.com/ip/987654321', 'walmart', '987654321'],
    [
      'Etsy listing',
      'https://www.etsy.com/listing/123456789/handmade-coat?ref=shop',
      'etsy',
      '123456789',
    ],
    [
      'AliExpress country host',
      'https://www.aliexpress.us/item/1005001.html?spm=x',
      'aliexpress',
      null,
    ],
    ['Temu', 'https://www.temu.com/product.html?goods_id=123', 'temu', null],
    ['Trendyol', 'https://www.trendyol.com/brand/p-123?boutiqueId=2', 'trendyol', null],
    ['Hepsiburada', 'https://www.hepsiburada.com/product-p-123', 'hepsiburada', null],
  ])('classifies %s', (_label, url, marketplace, listingId) => {
    expect(classifyMerchant(url)).toEqual({ kind: 'marketplace', marketplace, listingId });
  });

  it('follows the AliExpress dl_target_url affiliate redirect', () => {
    const url =
      'https://s.click.aliexpress.com/deep_link.htm?dl_target_url=' +
      encodeURIComponent('https://www.aliexpress.com/item/1005001234567890.html?spm=track');

    expect(classifyMerchant(url)).toEqual({
      kind: 'marketplace',
      marketplace: 'aliexpress',
      listingId: null,
    });
  });

  it('resolves a relative Walmart redirect path against the marketplace host', () => {
    expect(classifyMerchant('https://goto.walmart.com/?u=%2Fip%2FBlue-Coat%2F123456789')).toEqual({
      kind: 'marketplace',
      marketplace: 'walmart',
      listingId: '123456789',
    });
  });

  it('does not interpret a non-URL redirect parameter as a destination host', () => {
    expect(classifyMerchant('https://goto.walmart.com/?u=foo')).toEqual({
      kind: 'marketplace',
      marketplace: 'walmart',
      listingId: null,
    });
  });

  it('follows the Walmart u affiliate redirect and extracts the listing id', () => {
    const destination = 'https://www.walmart.com/ip/Blue-Coat/987654321?tracking=1';
    const url = `https://goto.walmart.com/c/123?u=${encodeURIComponent(destination)}`;

    expect(classifyMerchant(url)).toEqual({
      kind: 'marketplace',
      marketplace: 'walmart',
      listingId: '987654321',
    });
  });

  it('classifies known redirect hosts without a valid destination as their marketplace', () => {
    expect(classifyMerchant('https://goto.walmart.com/c/123?other=x')).toEqual({
      kind: 'marketplace',
      marketplace: 'walmart',
      listingId: null,
    });
  });

  it('uses the final redirect destination to identify the brand store', () => {
    const destination = 'https://shop.acme.example/products/coat';
    const url = `https://goto.walmart.com/?u=${encodeURIComponent(destination)}`;

    expect(classifyMerchant(url, { brandDomains: ['acme.example'] })).toEqual({
      kind: 'own',
      marketplace: null,
      listingId: null,
    });
  });

  it.each([
    'https://www.unknown-store.example/products/1?utm_campaign=tracked',
    'https://redirector.example/?url=https%3A%2F%2Famazon.com%2Fdp%2FB0C123ABCD',
  ])('classifies unknown hosts as reseller: %s', (url) => {
    expect(classifyMerchant(url)).toEqual({
      kind: 'reseller',
      marketplace: null,
      listingId: null,
    });
  });

  it.each([
    null,
    undefined,
    '',
    '::::',
    'not a url with spaces',
    'javascript:alert(1)',
    'https://',
  ])('returns a safe reseller fallback for malformed input: %s', (url) => {
    expect(() => classifyMerchant(url)).not.toThrow();
    expect(classifyMerchant(url)).toEqual({
      kind: 'reseller',
      marketplace: null,
      listingId: null,
    });
  });
});
