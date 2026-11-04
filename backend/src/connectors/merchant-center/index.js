import { toItem } from '../../lib/feeds/item.js';
import { ConnectError } from '../errors.js';
import { ConnectorHttpError } from '../http.js';

/**
 * Google Merchant Center (#1270): a brand's Merchant Center account read
 * into its catalog, with the issues Merchant Center reports per product.
 * Google AI Overviews and AI Mode take their product results from it (and
 * ChatGPT Shopping in Europe, it seems), so what it holds, and what it
 * refuses, decides whether a product can show there at all.
 *
 * It reads with the workspace's Google sign-in, made in Settings ›
 * Integrations and kept by Composio: `signIn` names that provider, and the
 * plumbing gives `readCatalog` a request through it (lib/catalog/signIn.js).
 * So it has no fields and no `connect`: a person picks one of the accounts
 * the sign-in opens (`listAccounts`), and `checkAccount` confirms it.
 *
 * The Merchant API v1 (the Content API for Shopping is being retired):
 *   - `GET /accounts/v1/accounts`, and `:listSubaccounts` for an advanced
 *     account's own, for the picker;
 *   - `GET /products/v1/accounts/{id}/products`, paged by `pageToken`: the
 *     products as Merchant Center shows them, with `productStatus`.
 * Read only: it never writes to the account.
 */

export const API = 'https://merchantapi.googleapis.com';
/** Products a page, the API's most. */
export const PAGE_SIZE = 1000;
/** Pages read at most: 50,000 products, about what a 50 MB feed holds. */
export const MAX_PAGES = 50;
/** Issues kept at most for a listing, and for a source's whole read. */
export const MAX_LISTING_ISSUES = 20;
export const MAX_ISSUES = 100_000;
/** Accounts the picker lists at most, and the advanced accounts whose sub-accounts it reads. */
export const MAX_ACCOUNTS = 500;
export const MAX_PARENTS = 20;
/** Countries an issue row keeps at most (00296). */
const MAX_COUNTRIES = 300;

const SEVERITIES = { NOT_IMPACTED: 'not_impacted', DEMOTED: 'demoted', DISAPPROVED: 'disapproved' };

/** A Merchant Center account id ("123456789"), from what a person or the API gives: "accounts/123…" too. */
export function accountId(value) {
  const id = String(value ?? '')
    .trim()
    .replace(/^accounts\//, '');
  return /^\d{1,20}$/.test(id) ? id : null;
}

/** A price as the feeds write it ("12.99 USD"), from the API's micros. */
export function moneyText(price) {
  const micros = Number(price?.amountMicros);
  if (!Number.isFinite(micros) || micros < 0) return undefined;
  // Two decimals when they hold it; else six, never three: the feeds' parser reads
  // one mark followed by three digits as thousands ("1.234").
  const amount = (micros / 1e6).toFixed(Number.isInteger(micros / 1e4) ? 2 : 6);
  return `${amount} ${price.currencyCode ?? ''}`.trim();
}

/** A product's feed attributes (lib/feeds/item.js), from its `productAttributes`. */
export function attributesOf(product) {
  const a = product.productAttributes ?? {};
  return {
    id: product.offerId,
    item_group_id: a.itemGroupId,
    title: a.title,
    description: a.description,
    link: a.link,
    image_link: a.imageLink,
    additional_image_link: a.additionalImageLinks,
    brand: a.brand,
    gtin: a.gtins?.[0],
    mpn: a.mpn,
    price: moneyText(a.price),
    sale_price: moneyText(a.salePrice),
    availability: a.availability,
    condition: a.condition,
    color: a.color,
    size: a.size,
    material: a.material,
    product_type: a.productTypes?.[0],
  };
}

const text = (value, max) =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;

/** A product's issues, as `catalog_item_issues` (00296) keeps them. Unknown severities are left out. */
export function issuesOf(product) {
  const externalId = text(product.offerId, 200);
  if (!externalId) return [];
  const out = [];
  for (const issue of product.productStatus?.itemLevelIssues ?? []) {
    if (out.length >= MAX_LISTING_ISSUES) break;
    const severity = SEVERITIES[issue?.severity];
    const code = text(issue?.code, 200);
    if (!severity || !code) continue;
    out.push({
      externalId,
      code,
      severity,
      attribute: text(issue.attribute, 200),
      reportingContext: text(issue.reportingContext, 100),
      description: text(issue.description, 1000),
      detail: text(issue.detail, 2000),
      documentation: text(issue.documentation, 2048),
      resolution: text(issue.resolution, 100),
      countries: (issue.applicableCountries ?? [])
        .filter((c) => typeof c === 'string' && /^[A-Z]{2}$/.test(c))
        .slice(0, MAX_COUNTRIES),
    });
  }
  return out;
}

/** A listing's place among its offer's others (listingOrder). */
function rankOf(product) {
  return {
    disapproved: (product?.productStatus?.itemLevelIssues ?? []).some(
      (issue) => issue?.severity === 'DISAPPROVED',
    ),
    feedLabel: String(product?.feedLabel ?? ''),
    contentLanguage: String(product?.contentLanguage ?? ''),
  };
}

const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The order of an offer's listings, the one the catalog keeps first, when
 * Merchant Center lists the offer again under another language or feed
 * label (the same offer id: the catalog keys items by id, so it keeps one):
 * a listing with no disapproved issue first, then the first by feed label,
 * then by content language, alphabetically (by code point, whatever the
 * server's locale). The API names no two listings of an offer with the same
 * feed label and language, so every sync keeps the same one, whatever order
 * the API pages them in.
 */
export function listingOrder(a, b) {
  return (
    Number(a.disapproved) - Number(b.disapproved) ||
    compare(a.feedLabel, b.feedLabel) ||
    compare(a.contentLanguage, b.contentLanguage)
  );
}

/**
 * The issues of every listing of every offer, one row per issue: the same
 * issue (code, destination, attribute and severity) of the same offer under
 * another language or feed label adds its countries to the row. The row's
 * words are its first listing's (listingOrder), and its countries come first.
 *
 * @param {{ rank: object, issue: ReturnType<typeof issuesOf>[number] }[]} found
 */
export function mergeIssues(found) {
  const groups = new Map();
  for (const entry of found) {
    const { externalId, code, reportingContext, attribute, severity } = entry.issue;
    const key = JSON.stringify([externalId, code, reportingContext, attribute, severity]);
    const group = groups.get(key);
    if (group) group.push(entry);
    else groups.set(key, [entry]);
  }
  return [...groups.values()].map((group) => {
    group.sort((a, b) => listingOrder(a.rank, b.rank));
    const countries = [...new Set(group.flatMap((entry) => entry.issue.countries))];
    return { ...group[0].issue, countries: countries.slice(0, MAX_COUNTRIES) };
  });
}

/** The accounts on one page of `accounts.list` or `:listSubaccounts`. */
const accountsOf = (data) =>
  (data?.accounts ?? [])
    .map((a) => ({ id: accountId(a.accountId ?? a.name), name: text(a.accountName, 200) }))
    .filter((a) => a.id);

async function listPages(request, url, max) {
  const out = [];
  let pageToken;
  do {
    const { data } = await request(url, { query: { pageSize: 500, pageToken } });
    out.push(...accountsOf(data));
    pageToken = data?.nextPageToken || undefined;
  } while (pageToken && out.length < max);
  return out.slice(0, max);
}

export default {
  kind: 'merchant_center',
  label: 'Google Merchant Center',
  signIn: 'google-merchant-center',
  hosts: ['merchantapi.googleapis.com'],

  /**
   * The Merchant Center accounts the sign-in opens, for the person to pick
   * the one that sells this brand's products: the ones it is added to, and
   * the sub-accounts of the first MAX_PARENTS (an advanced account's own,
   * which `accounts.list` doesn't return unless the person is added to them).
   *
   * @returns {Promise<{ id: string, name: string|null }[]>}
   */
  async listAccounts({ request }) {
    const direct = await listPages(request, `${API}/accounts/v1/accounts`, MAX_ACCOUNTS);
    const seen = new Map(direct.map((a) => [a.id, a]));
    for (const parent of direct.slice(0, MAX_PARENTS)) {
      if (seen.size >= MAX_ACCOUNTS) break;
      try {
        const subs = await listPages(
          request,
          `${API}/accounts/v1/accounts/${parent.id}:listSubaccounts`,
          MAX_ACCOUNTS,
        );
        for (const sub of subs) if (!seen.has(sub.id)) seen.set(sub.id, sub);
      } catch (err) {
        // A standalone account has no sub-accounts to list: Google answers that account with
        // an error. Anything else ends the listing: the sign-in gone or refused, this server's
        // setup refused or Composio not reached (no status), the time up, or Google asking
        // to wait, which the next account's call would only make worse.
        const ownAnswer =
          err instanceof ConnectorHttpError &&
          err.status &&
          err.code !== 'auth' &&
          err.code !== 'rate_limited';
        if (!ownAnswer) throw err;
      }
    }
    return [...seen.values()].slice(0, MAX_ACCOUNTS);
  },

  /** The account the person picked, checked with the sign-in: `{ account, label, url }`. */
  async checkAccount(value, { request }) {
    const id = accountId(value);
    if (!id) throw new ConnectError("That isn't a Merchant Center account id.");
    let data;
    try {
      ({ data } = await request(`${API}/accounts/v1/accounts/${id}`));
    } catch (err) {
      if (err instanceof ConnectorHttpError && (err.status === 403 || err.status === 404)) {
        throw new ConnectError("This Google sign-in can't open that Merchant Center account.");
      }
      throw err;
    }
    return {
      account: id,
      label: text(data?.accountName, 200),
      url: `https://merchants.google.com/mc/overview?a=${id}`,
    };
  },

  /**
   * The account's products as the catalog's items, and their issues. An
   * offer listed again under another language or feed label (the same offer
   * id) is one item: its listing first by listingOrder, whatever page it's
   * on. The others are counted (`repeated`), not skipped, and their issues
   * are kept with the item's (mergeIssues). Past MAX_PAGES the rest isn't
   * read, and the first error says so.
   */
  async readCatalog(source, { request }) {
    const id = accountId(source.account);
    if (!id) throw new ConnectError('The source has no Merchant Center account id.');
    // Per offer id, its first listing so far (listingOrder), as an item or the error it makes.
    // A listing with no offer id makes an error of its own.
    const listings = new Map();
    const found = [];
    let repeated = 0;
    let row = 0;
    let issuesLeft = 0;
    let pageToken;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const { data } = await request(`${API}/products/v1/accounts/${id}/products`, {
        query: { pageSize: PAGE_SIZE, pageToken },
      });
      // Google leaves `products` out for an account with none; any other shape isn't an answer.
      const isObject = data !== null && typeof data === 'object' && !Array.isArray(data);
      if (!isObject || (data.products !== undefined && !Array.isArray(data.products))) {
        throw new ConnectorHttpError(
          'bad_response',
          'Merchant Center answered with no product list.',
        );
      }
      for (const product of data.products ?? []) {
        row += 1;
        const rank = rankOf(product);
        // Its issues are kept even when the product can't be: a missing price is one.
        const issues = issuesOf(product);
        const room = Math.max(0, MAX_ISSUES - found.length);
        issuesLeft += Math.max(0, issues.length - room);
        found.push(...issues.slice(0, room).map((issue) => ({ rank, issue })));
        const listing = { rank, ...toItem(attributesOf(product), row, 'Item') };
        const key = text(product?.offerId, 200) ?? Symbol('no offer id');
        const kept = listings.get(key);
        if (!kept) {
          listings.set(key, listing);
          continue;
        }
        repeated += 1;
        if (listingOrder(rank, kept.rank) < 0) listings.set(key, listing);
      }
      pageToken = data.nextPageToken || undefined;
      if (!pageToken) break;
    }
    const items = [];
    const errors = [];
    for (const listing of listings.values()) {
      if (listing.item) items.push(listing.item);
      else errors.push(listing.error);
    }
    errors.sort((a, b) => a.row - b.row);
    if (issuesLeft) {
      errors.unshift({
        row: 0,
        field: 'issues',
        found: '',
        message: `Only the first ${MAX_ISSUES.toLocaleString('en-US')} issues were kept: ${issuesLeft.toLocaleString('en-US')} more weren't.`,
      });
    }
    if (pageToken) {
      // First, so it's among the errors the source keeps. The products not read are marked
      // removed by the sync, like any the account no longer lists.
      errors.unshift({
        row: 0,
        field: 'pages',
        found: '',
        message: `Only the first ${(MAX_PAGES * PAGE_SIZE).toLocaleString('en-US')} products were read: the rest aren't in the catalog.`,
      });
    }
    return { items, errors, issues: mergeIssues(found), repeated, format: 'merchant_center' };
  },

  /** Merchant Center has no orders. */
  async syncOrders() {
    return { orders: [] };
  },
};
