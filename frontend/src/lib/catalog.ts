/**
 * A brand's catalog sources (#1263, 00279, 00282), as Settings › Integrations
 * shows them: a feed URL the API reads daily, the file a person uploads, or
 * a store connected with its sign-in, whose kind is its connector's.
 */

export type CatalogSourceKind = 'feed_url' | 'upload' | (string & {});
export type CatalogFormat = 'auto' | 'google_xml' | 'csv' | 'meta_csv';
/** `auth_failed`: the store refused the saved sign-in. */
export type CatalogSyncStatus = 'ok' | 'failed' | 'format_error' | 'auth_failed';

/** A Google Merchant Center account's kind (#1270), read with the workspace's Google sign-in. */
export const MERCHANT_CENTER_KIND = 'merchant_center';
export const MERCHANT_CENTER_LABEL = 'Google Merchant Center';

/**
 * The platforms read with the workspace's sign-in, named by their kind: the
 * name a source's row keeps when the API's connectors can't be read.
 */
export const SIGN_IN_PLATFORM_LABELS: Readonly<Partial<Record<string, string>>> = {
  [MERCHANT_CENTER_KIND]: MERCHANT_CENTER_LABEL,
};

/** Whether a source is a store, read with its sign-in, rather than a feed or an upload. */
export function isStoreSource(kind: CatalogSourceKind): boolean {
  return kind !== 'feed_url' && kind !== 'upload';
}

/** What a sync did, as the API records it on the source (`last_counts`). */
export interface CatalogCounts {
  /** A feed's format, or a store's kind. */
  format: string;
  items: number;
  skipped: number;
  /** The first products skipped, and why ("Row 3: price is missing."). */
  errors: string[];
  products: { added: number; changed: number; removed: number; unchanged: number };
  variants: { added: number; changed: number; removed: number; unchanged: number };
  /**
   * The issues a platform reports per item (Google Merchant Center, #1270,
   * 00296): the items with at least one, and the issues per severity.
   */
  issues?: { items: number; disapproved: number; demoted: number; not_impacted: number };
  /**
   * The listings of an item read already, under another language or feed
   * label (Google Merchant Center, #1270): kept once, not skipped. Not on
   * syncs before it was counted.
   */
  repeated?: number;
  /** Products past the plan's cap, not in the catalog (ECOM-019); absent when none. */
  overLimit?: number;
  /** The plan's cap on the workspace's products, when some were past it. */
  limit?: number;
}

export interface CatalogSource {
  id: string;
  kind: CatalogSourceKind;
  format: CatalogFormat;
  url: string | null;
  /** A store's account as the person knows it (a shop's domain); null for feeds and uploads. */
  account: string | null;
  /** A store's name, as the store gave it when connected. */
  label: string | null;
  lastSyncedAt: string | null;
  lastStatus: CatalogSyncStatus | null;
  lastError: string | null;
  lastCounts: CatalogCounts | null;
  /** Its products in the catalog now (not removed). */
  products: number;
}

/** The largest file an upload takes: what the API's proxy takes in one request. */
export const CATALOG_UPLOAD_MAX_BYTES = 4 * 1024 * 1024;

/** The catalog's `source` for a source: `src_` and its id without dashes, as 00279 keys it. */
export function catalogSourceKey(id: string): string {
  return `src_${id.replace(/-/g, '')}`;
}
