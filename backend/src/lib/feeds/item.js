/**
 * One product from a feed, in the catalog's shape (#1263): every parser in
 * this folder returns these, whatever the format.
 *
 * @typedef {{ amount: number, currency: string | null }} Money
 *
 * @typedef {{
 *   id: string,
 *   itemGroupId: string | null,
 *   title: string,
 *   description: string | null,
 *   link: string,
 *   imageLink: string | null,
 *   additionalImageLinks: string[],
 *   brand: string | null,
 *   gtin: string | null,
 *   sku?: string | null,
 *   mpn: string | null,
 *   price: Money,
 *   salePrice: Money | null,
 *   availability: string,
 *   condition: string | null,
 *   color: string | null,
 *   size: string | null,
 *   material: string | null,
 *   productType: string | null,
 *   productTypes?: string[],
 * }} FeedItem
 *
 * A product the feed lists but that can't be kept: its row (CSV) or item
 * (XML) number, counted from 1, the field, and what was there.
 * @typedef {{ row: number, field: string, found: string, message: string }} FeedError
 *
 * @typedef {{ items: FeedItem[], errors: FeedError[] }} FeedResult
 */

/** The fields a product must have to be kept. */
export const REQUIRED_FIELDS = ['id', 'title', 'link', 'price', 'availability'];

/**
 * The feed attributes read, by their Google / Meta name, and the item field
 * each fills. `additional_image_link` may repeat (XML) or hold several
 * addresses (CSV).
 */
export const FEED_ATTRIBUTES = {
  id: 'id',
  item_group_id: 'itemGroupId',
  title: 'title',
  description: 'description',
  link: 'link',
  image_link: 'imageLink',
  additional_image_link: 'additionalImageLinks',
  brand: 'brand',
  gtin: 'gtin',
  sku: 'sku',
  mpn: 'mpn',
  price: 'price',
  sale_price: 'salePrice',
  availability: 'availability',
  condition: 'condition',
  color: 'color',
  size: 'size',
  material: 'material',
  product_type: 'productType',
};

/** A format the parser doesn't read: one error for the whole file. */
export class FeedFormatError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FeedFormatError';
  }
}

const SYMBOL_CURRENCY = { '€': 'EUR', '£': 'GBP', '₺': 'TRY', '¥': 'JPY', '₹': 'INR' };

/** A decimal written with either separator, thousands grouped or not: "1,234.50", "1.234,50", "15,00". */
function amountOf(raw) {
  // \s covers the no-break space too.
  const digits = raw.replace(/[\s']/g, '');
  if (!/^\d[\d.,]*$/.test(digits)) return null;
  const lastDot = digits.lastIndexOf('.');
  const lastComma = digits.lastIndexOf(',');
  let normalized;
  if (lastDot >= 0 && lastComma >= 0) {
    // Both: the later one is the decimal mark.
    const decimal = lastDot > lastComma ? '.' : ',';
    const thousands = decimal === '.' ? ',' : '.';
    normalized = digits.split(thousands).join('').replace(decimal, '.');
  } else {
    const sep = lastDot >= 0 ? '.' : lastComma >= 0 ? ',' : null;
    if (!sep) normalized = digits;
    else {
      const parts = digits.split(sep);
      const tail = parts[parts.length - 1];
      // One mark with one or two digits after it is a decimal; groups of three are thousands.
      normalized = parts.length === 2 && tail.length !== 3 ? parts.join('.') : parts.join('');
    }
  }
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

/**
 * A price as feeds write it: "15.00 USD", "USD 15.00", "15.00" (no
 * currency), "€15,00". Null when it isn't one.
 *
 * @param {string | null | undefined} value
 * @returns {Money | null}
 */
export function parseMoney(value) {
  let text = String(value ?? '').trim();
  if (!text) return null;
  let currency = null;
  const symbol = text.match(/^[€£₺¥₹$]|[€£₺¥₹$]$/u);
  if (symbol) {
    currency = SYMBOL_CURRENCY[symbol[0]] ?? null;
    text = text.replace(symbol[0], '').trim();
  }
  const m = /^(?:([A-Za-z]{3})\s*)?(.+?)(?:\s*([A-Za-z]{3}))?$/.exec(text);
  if (!m) return null;
  const [, before, number, after] = m;
  const code = (before ?? after)?.toUpperCase() ?? null;
  if (before && after && before.toUpperCase() !== after.toUpperCase()) return null;
  const amount = amountOf(number);
  if (amount === null) return null;
  return { amount, currency: code ?? currency };
}

/** "in stock", "In-Stock", "in_stock" → "in_stock". */
export function normalizeAvailability(value) {
  const text = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  return text || null;
}

/** Several image addresses in one field, split where the next address starts. */
export function splitImageLinks(value) {
  return String(value ?? '')
    .split(/[,\s]+(?=https?:\/\/)/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

const clean = (value) => {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || null;
};

/**
 * A product from its feed attributes, or the first required field it lacks.
 *
 * @param {Record<string, string | string[] | undefined>} attrs by feed attribute name
 * @param {number} row
 * @param {'Row' | 'Item'} unit how the message names it: a CSV's row, an XML feed's item
 * @returns {{ item: FeedItem } | { error: FeedError }}
 */
export function toItem(attrs, row, unit = 'Row') {
  const first = (name) => {
    const value = attrs[name];
    return clean(Array.isArray(value) ? value[0] : value);
  };
  const price = parseMoney(first('price'));
  const values = {
    id: first('id'),
    title: first('title'),
    link: first('link'),
    price,
    availability: normalizeAvailability(first('availability')),
  };
  for (const field of REQUIRED_FIELDS) {
    if (values[field] === null) {
      const found = first(field);
      return {
        error: {
          row,
          field,
          found: found ?? '',
          message: found
            ? `${unit} ${row}: ${field} "${found}" isn't a valid ${field}.`
            : `${unit} ${row}: ${field} is missing.`,
        },
      };
    }
  }
  const extra = attrs.additional_image_link;
  const additional = (Array.isArray(extra) ? extra : [extra ?? '']).flatMap(splitImageLinks);
  const productTypes = [
    ...new Set(
      (Array.isArray(attrs.product_types) ? attrs.product_types : []).map(clean).filter(Boolean),
    ),
  ];
  return {
    item: {
      id: values.id,
      itemGroupId: first('item_group_id'),
      title: values.title,
      description: first('description'),
      link: values.link,
      imageLink: first('image_link'),
      additionalImageLinks: [...new Set(additional)],
      brand: first('brand'),
      gtin: first('gtin'),
      ...(first('sku') ? { sku: first('sku') } : {}),
      mpn: first('mpn'),
      price: values.price,
      salePrice: parseMoney(first('sale_price')),
      availability: values.availability,
      condition: first('condition')?.toLowerCase() ?? null,
      color: first('color'),
      size: first('size'),
      material: first('material'),
      productType: productTypes[0] ?? first('product_type'),
      ...(productTypes.length ? { productTypes } : {}),
    },
  };
}
