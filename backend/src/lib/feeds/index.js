import * as cheerio from 'cheerio';
import { csvRows } from './csv.js';
import { FEED_ATTRIBUTES, FeedFormatError, REQUIRED_FIELDS, toItem } from './item.js';

export { FeedFormatError } from './item.js';

/**
 * Product feed parsers (#1264): a store's CSV export, a Google product feed
 * (XML) and a Meta (Facebook) catalog CSV, each into the catalog's item shape
 * (`item.js`), for the feed connector and the CSV import (#1263) and the
 * Merchant Center connector. Pure: no network, no database.
 *
 * Each returns `{ items, errors }`. A product missing a required field (id,
 * title, link, price, availability) is left out, with an error naming its row
 * or item, the field and what was there. A product whose id comes again is
 * left out the same way: the catalog keys products by it. A file that isn't
 * the expected format throws one FeedFormatError.
 */

/** Header names read as a feed attribute, besides the attribute's own name. */
const HEADER_ALIASES = {
  url: 'link',
  product_url: 'link',
  image_url: 'image_link',
  additional_image_links: 'additional_image_link',
  name: 'title',
  product_name: 'title',
};

/** "Image Link", "g:image_link", "image-link" → "image_link". */
function headerKey(header) {
  return header
    .trim()
    .toLowerCase()
    .replace(/^g:/, '')
    .replace(/[\s-]+/g, '_');
}

/**
 * The column of each feed attribute: an explicit mapping first (attribute →
 * header, any case), then the attribute's own name, then a common alias.
 */
function columnsOf(header, mapping = {}, fallbacks = {}) {
  const keys = header.map(headerKey);
  const columns = {};
  for (const [index, key] of keys.entries()) {
    const attribute = key in FEED_ATTRIBUTES ? key : HEADER_ALIASES[key];
    if (attribute && !(attribute in columns)) columns[attribute] = index;
  }
  for (const [attribute, fallback] of Object.entries(fallbacks)) {
    const index = keys.indexOf(fallback);
    if (!(attribute in columns) && index >= 0) columns[attribute] = index;
  }
  for (const [attribute, name] of Object.entries(mapping)) {
    if (!(attribute in FEED_ATTRIBUTES)) {
      throw new FeedFormatError(`The mapping names an unknown field: ${attribute}.`);
    }
    const index = keys.indexOf(headerKey(name));
    if (index < 0) throw new FeedFormatError(`The mapping's column "${name}" isn't in the file.`);
    columns[attribute] = index;
  }
  return columns;
}

/** Keeps the first product with each id; a later one is an error. */
function collect(results, unit) {
  const items = [];
  const errors = [];
  const seen = new Set();
  for (const { row, result } of results) {
    if ('error' in result) {
      errors.push(result.error);
    } else if (seen.has(result.item.id)) {
      errors.push({
        row,
        field: 'id',
        found: result.item.id,
        message: `${unit} ${row}: id "${result.item.id}" is already used by an earlier product.`,
      });
    } else {
      seen.add(result.item.id);
      items.push(result.item);
    }
  }
  return { items, errors };
}

function parseCsv(text, mapping, fallbacks) {
  if (typeof text !== 'string' || !text.trim()) throw new FeedFormatError('The file is empty.');
  const rows = csvRows(text);
  const first = rows.next();
  if (first.done) throw new FeedFormatError('The file is empty.');
  const columns = columnsOf(first.value.fields, mapping, fallbacks);
  const missing = REQUIRED_FIELDS.filter((field) => !(field in columns));
  if (missing.length) {
    throw new FeedFormatError(
      `This isn't a product feed CSV: no ${missing.join(', ')} column. Check the header row, or map the columns.`,
    );
  }
  // Rows as a spreadsheet numbers them: the header is row 1.
  let row = 1;
  const results = (function* () {
    for (const { fields } of rows) {
      row++;
      const attrs = {};
      for (const [attribute, index] of Object.entries(columns)) attrs[attribute] = fields[index];
      yield { row, result: toItem(attrs, row, 'Row') };
    }
  })();
  return collect(results, 'Row');
}

/**
 * A CSV with a header row. Columns named after Google's attributes (`id`,
 * `title`, `description`, `link`, `image_link`, `price`, `gtin`, `brand`,
 * `availability`, …) map by themselves; `mapping` names others, e.g.
 * `{ id: 'SKU', title: 'Product name' }`.
 *
 * @param {string} text
 * @param {Record<string, string>} [mapping] feed attribute → header
 * @returns {import('./item.js').FeedResult}
 */
export function parseCsvFeed(text, mapping) {
  return parseCsv(text, mapping, {});
}

/**
 * A Meta (Facebook) catalog CSV. Its columns share Google's names; a
 * catalog with only `rich_text_description` uses it as the description.
 *
 * @param {string} text
 * @returns {import('./item.js').FeedResult}
 */
export function parseFacebookCatalogCsv(text) {
  return parseCsv(text, undefined, { description: 'rich_text_description' });
}

/**
 * The format a feed's text is in: XML when it starts with a tag, a Meta
 * catalog CSV when its header has Meta's own columns, else a plain CSV.
 *
 * @param {string} text
 * @returns {'google_xml' | 'meta_csv' | 'csv'}
 */
export function detectFormat(text) {
  const start = text.replace(/^\uFEFF/, '').trimStart();
  if (start.startsWith('<')) return 'google_xml';
  const header = start.slice(0, start.search(/\r?\n|$/)).toLowerCase();
  return /(^|[,\t"])(fb_product_category|rich_text_description|quantity_to_sell_on_facebook)\b/.test(
    header,
  )
    ? 'meta_csv'
    : 'csv';
}

/**
 * A feed in any of the formats read here: `format` names it, or 'auto'
 * reads it from the text (`detectFormat`).
 *
 * @param {string} text
 * @param {'auto' | 'google_xml' | 'csv' | 'meta_csv'} [format]
 * @returns {import('./item.js').FeedResult & { format: string }}
 */
export function parseFeed(text, format = 'auto') {
  if (typeof text !== 'string' || !text.trim()) throw new FeedFormatError('The file is empty.');
  const read = format === 'auto' ? detectFormat(text) : format;
  const result =
    read === 'google_xml'
      ? parseGoogleFeedXml(text)
      : read === 'meta_csv'
        ? parseFacebookCatalogCsv(text)
        : parseCsvFeed(text);
  return { ...result, format: read };
}

const ITEM = /<item(?:\s[^>]*)?>([\s\S]*?)<\/item\s*>/g;
const ENTRY = /<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry\s*>/g;

/** An item's or entry's attributes, by feed attribute name. */
function xmlAttrs(block) {
  const $ = cheerio.load(block, { xml: true });
  const attrs = {};
  $.root()
    .children()
    .each((_, el) => {
      const key = headerKey(el.tagName ?? '');
      const attribute = key === 'summary' || key === 'content' ? 'description' : key;
      if (!(attribute in FEED_ATTRIBUTES)) return;
      const node = $(el);
      // Atom: <link href="…"/>, the product's own page (rel alternate, or none).
      const value =
        attribute === 'link' && node.attr('href') !== undefined
          ? ['', 'alternate'].includes(node.attr('rel') ?? '')
            ? node.attr('href')
            : undefined
          : node.text();
      if (value === undefined || !value.trim()) return;
      if (attribute === 'additional_image_link') {
        attrs[attribute] = [...(attrs[attribute] ?? []), value];
      } else if (attrs[attribute] === undefined) {
        attrs[attribute] = value;
      }
    });
  return attrs;
}

/**
 * A Google product feed in XML: RSS 2.0 with the `g:` namespace, or Atom.
 * Items are read one at a time, so a large feed isn't held twice.
 *
 * @param {string} text
 * @returns {import('./item.js').FeedResult}
 */
export function parseGoogleFeedXml(text) {
  if (typeof text !== 'string' || !text.trim()) throw new FeedFormatError('The file is empty.');
  const head = text.slice(0, 4096);
  const atom = /<feed[\s>]/.test(head);
  if (!atom && !/<rss[\s>]/.test(head)) {
    throw new FeedFormatError(
      "This isn't a Google product feed: it has no <rss> or <feed> element.",
    );
  }
  const pattern = new RegExp(atom ? ENTRY : ITEM);
  let item = 0;
  const results = (function* () {
    for (let m = pattern.exec(text); m; m = pattern.exec(text)) {
      item++;
      yield { row: item, result: toItem(xmlAttrs(m[1]), item, 'Item') };
    }
  })();
  return collect(results, 'Item');
}
