import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { csvRows } from './csv.js';
import {
  FeedFormatError,
  detectFormat,
  parseCsvFeed,
  parseFacebookCatalogCsv,
  parseFeed,
  parseGoogleFeedXml,
} from './index.js';
import { parseMoney } from './item.js';

const fixture = (name) => readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8');

describe('csvRows', () => {
  it('reads quoted fields with commas, doubled quotes and line breaks, and CRLF', () => {
    const rows = [...csvRows('a,b,c\r\n1,"x, ""y""\nz",3\r\n\r\n4,5,6')];
    expect(rows).toEqual([
      { line: 1, fields: ['a', 'b', 'c'] },
      { line: 2, fields: ['1', 'x, "y"\nz', '3'] },
      { line: 5, fields: ['4', '5', '6'] },
    ]);
  });

  it('reads a tab-separated text feed', () => {
    expect([...csvRows('id\ttitle\n1\tBoot, red')].map((r) => r.fields)).toEqual([
      ['id', 'title'],
      ['1', 'Boot, red'],
    ]);
  });
});

describe('parseMoney', () => {
  it('reads a price with or without a currency, either decimal mark', () => {
    expect(parseMoney('15.00 USD')).toEqual({ amount: 15, currency: 'USD' });
    expect(parseMoney('usd 15.5')).toEqual({ amount: 15.5, currency: 'USD' });
    expect(parseMoney('18.50')).toEqual({ amount: 18.5, currency: null });
    expect(parseMoney('1,249.90 TRY')).toEqual({ amount: 1249.9, currency: 'TRY' });
    expect(parseMoney('1.249,90 EUR')).toEqual({ amount: 1249.9, currency: 'EUR' });
    expect(parseMoney('15,00 EUR')).toEqual({ amount: 15, currency: 'EUR' });
    expect(parseMoney('€39')).toEqual({ amount: 39, currency: 'EUR' });
  });

  it("isn't a price when it says something else", () => {
    expect(parseMoney('')).toBeNull();
    expect(parseMoney('free')).toBeNull();
    expect(parseMoney('15.00 USD EUR')).toBeNull();
    expect(parseMoney('USD 15 EUR')).toBeNull();
    expect(parseMoney('-5 USD')).toBeNull();
  });
});

describe('parseGoogleFeedXml', () => {
  it('reads an RSS 2.0 feed: a variant group, repeated images, CDATA and entities', () => {
    const { items, errors } = parseGoogleFeedXml(fixture('google-feed.xml'));
    expect(errors).toEqual([]);
    expect(items.map((i) => i.id)).toEqual(['TR-100-RED', 'TR-100-BLUE', 'TR-100-GREEN', 'SOCK-1']);
    // One item group, three colors.
    const group = items.filter((i) => i.itemGroupId === 'TR-100');
    expect(group.map((i) => i.color)).toEqual(['Red', 'Blue', 'Green']);
    expect(items[0]).toEqual({
      id: 'TR-100-RED',
      itemGroupId: 'TR-100',
      title: 'Trailrunner Hiking Boot - Red',
      description: 'Waterproof leather & mesh. <b>Grips wet rock.</b>',
      link: 'https://shop.example/trailrunner?color=red',
      imageLink: 'https://shop.example/img/tr-red.jpg',
      additionalImageLinks: [
        'https://shop.example/img/tr-red-2.jpg',
        'https://shop.example/img/tr-red-3.jpg',
      ],
      brand: 'Acme',
      gtin: '4006381333931',
      mpn: null,
      price: { amount: 129, currency: 'USD' },
      salePrice: { amount: 99, currency: 'USD' },
      availability: 'in_stock',
      condition: 'new',
      color: 'Red',
      size: '42',
      material: 'Leather',
      productType: 'Shoes > Hiking Boots',
    });
    // A price with no currency, and no group.
    expect(items[3]).toMatchObject({
      itemGroupId: null,
      price: { amount: 18.5, currency: null },
      availability: 'preorder',
      condition: null,
    });
  });

  it('reads the same products from an Atom feed', () => {
    expect(parseGoogleFeedXml(fixture('google-feed-atom.xml'))).toEqual(
      parseGoogleFeedXml(fixture('google-feed.xml')),
    );
  });

  it('skips an item missing a required field, naming its item number', () => {
    const xml = `<rss xmlns:g="http://base.google.com/ns/1.0" version="2.0"><channel>
      <item><g:id>A</g:id><title>A</title><link>https://s.example/a</link><g:price>1 USD</g:price><g:availability>in stock</g:availability></item>
      <item><g:id>B</g:id><title>B</title><link>https://s.example/b</link><g:availability>in stock</g:availability></item>
      <item><g:id>A</g:id><title>A again</title><link>https://s.example/a2</link><g:price>2 USD</g:price><g:availability>in stock</g:availability></item>
    </channel></rss>`;
    const { items, errors } = parseGoogleFeedXml(xml);
    expect(items.map((i) => i.id)).toEqual(['A']);
    expect(errors).toEqual([
      { row: 2, field: 'price', found: '', message: 'Item 2: price is missing.' },
      {
        row: 3,
        field: 'id',
        found: 'A',
        message: 'Item 3: id "A" is already used by an earlier product.',
      },
    ]);
  });

  it("fails once on a file that isn't a feed", () => {
    expect(() => parseGoogleFeedXml('<html><body>Not a feed</body></html>')).toThrow(
      FeedFormatError,
    );
    expect(() => parseGoogleFeedXml('')).toThrow('The file is empty.');
  });
});

describe('parseFacebookCatalogCsv', () => {
  it('reads the same products as the Google feed', () => {
    expect(parseFacebookCatalogCsv(fixture('facebook-catalog.csv'))).toEqual(
      parseGoogleFeedXml(fixture('google-feed.xml')),
    );
  });

  it('uses rich_text_description when there is no description column', () => {
    const csv =
      'id,title,rich_text_description,availability,price,link\n' +
      '1,Boot,<p>Waterproof</p>,in stock,10 USD,https://s.example/1';
    expect(parseFacebookCatalogCsv(csv).items[0].description).toBe('<p>Waterproof</p>');
  });
});

describe('parseCsvFeed', () => {
  it("reads a store's export: its header names, a BOM, quoted fields, and a row missing its price", () => {
    const { items, errors } = parseCsvFeed(fixture('store-export.csv'));
    expect(items.map((i) => i.id)).toEqual(['B-1', 'B-3']);
    expect(items[0]).toMatchObject({
      title: 'Summit Backpack 30L',
      description: 'Roomy, light and\nrain-proof: "ready for anything".',
      imageLink: 'https://shop.example/img/summit.jpg',
      gtin: '8690000000017',
      price: { amount: 1249.9, currency: 'TRY' },
      availability: 'in_stock',
    });
    expect(items[1]).toMatchObject({
      imageLink: null,
      price: { amount: 39, currency: 'EUR' },
      availability: 'in_stock',
    });
    // Row 3: the header is row 1, and B-1's quoted line break doesn't count as a row.
    expect(errors).toEqual([
      { row: 3, field: 'price', found: '', message: 'Row 3: price is missing.' },
    ]);
  });

  it('reads other headers through a mapping', () => {
    const csv =
      'SKU,Product name,URL,Cost,Stock\n' + 'S-1,Camp Mug,https://s.example/mug,7.5 USD,in stock';
    const { items } = parseCsvFeed(csv, {
      id: 'SKU',
      title: 'Product name',
      price: 'Cost',
      availability: 'stock',
    });
    expect(items[0]).toMatchObject({
      id: 'S-1',
      title: 'Camp Mug',
      link: 'https://s.example/mug',
      price: { amount: 7.5, currency: 'USD' },
    });
  });

  it('names a value that is there but invalid', () => {
    const csv = 'id,title,link,price,availability\n1,Mug,https://s.example/m,free,in stock';
    expect(parseCsvFeed(csv).errors).toEqual([
      {
        row: 2,
        field: 'price',
        found: 'free',
        message: 'Row 2: price "free" isn\'t a valid price.',
      },
    ]);
  });

  it("fails once on a file that isn't a product feed", () => {
    expect(() => parseCsvFeed('name,email\nAda,ada@example.com')).toThrow(
      /no id, link, price, availability column/,
    );
    expect(() => parseCsvFeed('id,title\n1,x', { colour: 'id' })).toThrow(FeedFormatError);
    expect(() => parseCsvFeed('id,title\n1,x', { link: 'Url' })).toThrow(
      'The mapping\'s column "Url" isn\'t in the file.',
    );
    expect(() => parseCsvFeed('   ')).toThrow('The file is empty.');
  });

  it('reads a 10,000-row export', () => {
    const rows = ['id,title,link,price,availability'];
    for (let i = 0; i < 10_000; i++) {
      rows.push(`P-${i},"Product ${i}, blue",https://s.example/p/${i},${i}.99 USD,in stock`);
    }
    const { items, errors } = parseCsvFeed(rows.join('\n'));
    expect(errors).toEqual([]);
    expect(items).toHaveLength(10_000);
    expect(items[9_999]).toMatchObject({
      title: 'Product 9999, blue',
      price: { amount: 9999.99, currency: 'USD' },
    });
  });
});

describe('detectFormat and parseFeed', () => {
  it('reads XML, a Meta catalog CSV and a plain CSV by their text', () => {
    expect(detectFormat(fixture('google-feed.xml'))).toBe('google_xml');
    expect(detectFormat(fixture('google-feed-atom.xml'))).toBe('google_xml');
    expect(detectFormat(fixture('facebook-catalog.csv'))).toBe('meta_csv');
    expect(detectFormat(fixture('store-export.csv'))).toBe('csv');
  });

  it('parses in the format named, or the one it reads, and says which', () => {
    const auto = parseFeed(fixture('facebook-catalog.csv'));
    expect(auto.format).toBe('meta_csv');
    expect(auto.items).toHaveLength(4);
    expect(parseFeed(fixture('store-export.csv'), 'csv').format).toBe('csv');
    expect(() => parseFeed('   ')).toThrow('The file is empty.');
    expect(() => parseFeed(fixture('store-export.csv'), 'google_xml')).toThrow(FeedFormatError);
  });
});
