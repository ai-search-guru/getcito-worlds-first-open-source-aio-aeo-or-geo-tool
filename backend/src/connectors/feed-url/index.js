import { parseFeed } from '../../lib/feeds/index.js';
import { fetchPage } from '../../lib/safeFetch.js';

/**
 * The product feed URL connector (#1263): a Google product feed (XML), a Meta
 * catalog CSV or a store's CSV export at a public address, read daily.
 *
 * The feed is fetched like any page the server reads (lib/safeFetch.js):
 * public addresses only, checked again on every redirect, standard ports, no
 * credentials. It may be up to 50 MB and take up to a minute.
 */

export const FEED_MAX_BYTES = 50 * 1024 * 1024;
export const FEED_TIMEOUT_MS = 60_000;

/** What a feed is served as: XML, CSV or text, or a generic file type. */
export const FEED_TYPES =
  /^\s*$|^\s*(text\/(xml|csv|plain|tab-separated-values)|application\/(xml|rss\+xml|atom\+xml|csv|octet-stream|vnd\.ms-excel))\b/i;
const FEED_ACCEPT = 'application/xml,text/xml,text/csv,text/plain;q=0.9,*/*;q=0.1';

export default {
  kind: 'feed_url',

  /**
   * @param {{ url: string, format: string }} source
   * @param {{ fetch?: typeof fetchPage }} [ctx] `fetch` is the tests' stand-in
   */
  async readCatalog(source, { fetch = fetchPage } = {}) {
    const { html: text } = await fetch(source.url, {
      timeoutMs: FEED_TIMEOUT_MS,
      maxBytes: FEED_MAX_BYTES,
      types: FEED_TYPES,
      accept: FEED_ACCEPT,
    });
    return parseFeed(text, source.format);
  },
};
