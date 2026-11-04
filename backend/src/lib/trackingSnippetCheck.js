import supabaseAdmin from '../config/supabase.js';
import { logger } from './logger.js';
import { fetchPage } from './safeFetch.js';
import { brandHost } from './siteTypeDetect.js';

/**
 * Whether a brand's tracking snippet is on its site (AI Traffic's "Tracking
 * code not detected"), read without a request from the customer's pages:
 * the snippet itself still sends nothing for a visitor who didn't come from
 * an AI assistant. When a person asks (Check again) and when the brand is
 * set up, the server reads the brand's home page once, through safe-fetch
 * (public addresses only), and looks for the snippet: its tag (t.js with a
 * data-t) or the brand's tracking code. The result is kept on the brand
 * (00433): snippet_checked_at, and snippet_found_at when the check found it
 * (cleared when one doesn't). A home page that can't be read changes
 * nothing. A snippet added through a tag manager isn't in the page's HTML:
 * the first AI visit shows it's there.
 */

/** The home page read, at most: the snippet sits in its head, or before the body ends. */
const PAGE_BYTES = 2 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 10_000;

/** Postgres' code for a column that doesn't exist (00433 not applied yet). */
const UNDEFINED_COLUMN = '42703';

/** The snippet's tag: a script loading t.js with a tracking code (data-t). */
const SNIPPET_TAG =
  /<script\b(?=[^>]*\bsrc\s*=\s*["']?[^"'\s>]*\/t\.js(?:[?#][^"'\s>]*)?["'\s>])(?=[^>]*\bdata-t\s*=)[^>]*>/i;

/**
 * Whether a page's HTML carries the brand's snippet: its tag, or its tracking
 * code anywhere (a loader that sets it by script).
 * @param {string} html
 * @param {string} trackingCode
 */
export function snippetOnPage(html, trackingCode) {
  const page = String(html ?? '');
  if (trackingCode && page.includes(trackingCode)) return true;
  return SNIPPET_TAG.test(page);
}

/** The home page's HTML, at the host as added and then with "www.": null when neither answers. */
async function readHomePage(host, fetcher) {
  for (const h of host.startsWith('www.') ? [host] : [host, `www.${host}`]) {
    try {
      const { html } = await fetcher(`https://${h}/`, {
        truncate: true,
        maxBytes: PAGE_BYTES,
        timeoutMs: FETCH_TIMEOUT_MS,
      });
      return html;
    } catch (err) {
      logger.info({ code: err.code ?? err.message }, '[snippet-check] home page unread');
    }
  }
  return null;
}

/**
 * Checks a brand's home page for its tracking snippet and keeps the result.
 * `status`: 'found', 'not_found', 'no_domain' (the brand has no site to
 * read) or 'unreachable' (its home page didn't answer: nothing kept).
 *
 * @param {string} brandId
 * @returns {Promise<{ status: 'found'|'not_found'|'no_domain'|'unreachable',
 *   domain: string|null, checkedAt: string|null, foundAt: string|null }>}
 */
export async function checkTrackingSnippet(
  brandId,
  { db = supabaseAdmin, fetcher = fetchPage, now = new Date() } = {},
) {
  const [brandRes, domainsRes] = await Promise.all([
    db.from('brands').select('tracking_code').eq('id', brandId).single(),
    db.from('brand_domains').select('domain, is_primary').eq('brand_id', brandId),
  ]);
  if (brandRes.error) throw new Error(brandRes.error.message);
  if (domainsRes.error) throw new Error(domainsRes.error.message);
  const domain = brandHost(domainsRes.data ?? []);
  if (!domain) return { status: 'no_domain', domain: null, checkedAt: null, foundAt: null };

  const html = await readHomePage(domain, fetcher);
  if (html === null) return { status: 'unreachable', domain, checkedAt: null, foundAt: null };

  const found = snippetOnPage(html, brandRes.data.tracking_code);
  const checkedAt = now.toISOString();
  const foundAt = found ? checkedAt : null;
  const { error } = await db
    .from('brands')
    .update({ snippet_checked_at: checkedAt, snippet_found_at: foundAt })
    .eq('id', brandId);
  // Before 00433 the result can't be kept: it is still the answer.
  if (error && error.code !== UNDEFINED_COLUMN) throw new Error(error.message);
  return { status: found ? 'found' : 'not_found', domain, checkedAt, foundAt };
}
