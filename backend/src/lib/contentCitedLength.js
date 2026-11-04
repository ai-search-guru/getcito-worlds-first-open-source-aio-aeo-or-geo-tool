import supabaseAdmin from '../config/supabase.js';
import { linkKey } from './contentLinks.js';
import { logger } from './logger.js';
import { MAX_CONTENT_LENGTH, extractPageContent, textLength } from './pageContent.js';
import { fetchPage } from './safeFetch.js';
import { FEATURE_CHECKS, pageFeatures } from './action-center/pageFeatures.js';
import { describeSignal } from './audit/rubric.js';

/**
 * The cited pages' length (Content Editor v1.1, CE-030): the brief's Length
 * says "From the rules · a typical cited page has 4,300 characters", a benchmark
 * read when the brief is rebuilt. The first few cited pages kept in Sources
 * are read, their main text counted as the Rules tab counts length.
 *
 * Only addresses AI answers cited for the brand are read — never one a
 * request names alone — and only public ones (safe-fetch). Nothing read is
 * kept but the figure.
 */

/** How many cited pages a rebuild reads, and how long each may take. */
export const CITED_LENGTH_PAGES = 5;
const READ_TIMEOUT_MS = 8_000;
/** Fewer read than this, and one page would stand for "cited pages": no benchmark. */
export const CITED_MIN_PAGES = 2;
/** Shorter than this, what was read is a wall (a sign-in, a consent page), not the page. */
export const CITED_MIN_CHARACTERS = 500;

/**
 * One page's main text length, and what Site Audit's checks find on it
 * (learning C2) from the same read; it throws when the page can't be read,
 * or `signal` ends it.
 */
async function readLength(url, signal) {
  const page = await fetchPage(url, { timeoutMs: READ_TIMEOUT_MS, signal });
  const content = extractPageContent(page.html, page.url);
  // Past what a page brought into the editor may be (contentPages.js): no benchmark.
  if (content.html.length > MAX_CONTENT_LENGTH) return null;
  return {
    length: textLength(content.html),
    features: await pageFeatures(page.url, page.html).catch(() => null),
  };
}

/**
 * The checks at least half the pages read pass (learning C2), the most
 * passed first; none from fewer than CITED_MIN_PAGES pages with features.
 */
export function citedFeatures(reads) {
  const read = reads.filter((r) => r.features?.checks);
  if (read.length < CITED_MIN_PAGES) return null;
  const needed = Math.ceil(read.length / 2);
  const checks = FEATURE_CHECKS.map((key) => ({
    key,
    label: describeSignal(key)?.label ?? key,
    pages: read.filter((r) => r.features.checks[key] === 'pass').length,
  }))
    .filter((check) => check.pages >= needed)
    .sort((a, b) => b.pages - a.pages);
  return { pages: read.length, checks };
}

/**
 * The first few addresses, in their order, that AI answers cited for the
 * brand: checked a few at a time, until enough are found.
 */
async function brandCited(brandId, urls) {
  const found = [];
  for (
    let at = 0;
    at < urls.length && found.length < CITED_LENGTH_PAGES;
    at += CITED_LENGTH_PAGES
  ) {
    const batch = urls.slice(at, at + CITED_LENGTH_PAGES);
    const { data, error } = await supabaseAdmin
      .from('citation_urls')
      .select('id, url')
      .in('url', batch);
    if (error) throw error;
    const cited = await Promise.all(
      (data ?? []).map(async (row) => {
        const { data: hit, error: hitError } = await supabaseAdmin
          .from('prompt_result_citations')
          .select('url_id')
          .eq('url_id', row.id)
          .eq('brand_id', brandId)
          .limit(1);
        if (hitError) throw hitError;
        return hit?.length ? row.url : null;
      }),
    );
    found.push(...batch.filter((url) => cited.includes(url)));
  }
  return found.slice(0, CITED_LENGTH_PAGES);
}

/** The middle of the lengths: one very long page (an encyclopedia's) doesn't set the bar. */
function median(lengths) {
  const sorted = [...lengths].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * How long the cited pages kept are: the median of those read, rounded to a
 * hundred, and how many were read; null when fewer than two could be (no
 * number is made up). With them, what Site Audit's checks find on the same
 * pages (citedFeatures, learning C2), from the same reads. The page the draft optimizes is left out, however its address
 * was cited (www, tracking parameters): it is no benchmark for itself.
 *
 * @param {{ brandId: string, pages: { url: string }[], ownUrl?: string | null, signal?: AbortSignal | null }} input
 *   `signal`: the run's Stop, which settles it on null at once.
 * @param {{ read?: (url: string) => Promise<number | { length: number, features: object | null } | null> }} [deps]
 *   tests replace the read
 * @returns {Promise<{ characters: number, pages: number, features?: object } | null>}
 */
export async function citedPagesLength(
  { brandId, pages, ownUrl = null, signal = null },
  { read = readLength } = {},
) {
  // The run's Stop ends the reads, and the wait for them, at once.
  const stopped = new Promise((resolve) => {
    if (signal?.aborted) resolve(null);
    signal?.addEventListener('abort', () => resolve(null), { once: true });
  });
  return Promise.race([stopped, measure({ brandId, pages, ownUrl, signal }, read)]);
}

async function measure({ brandId, pages, ownUrl, signal }, read) {
  try {
    const own = ownUrl ? linkKey(ownUrl) : null;
    // One page cited under two addresses (www, tracking parameters) is read
    // once, at the first: twice, it would count as two of the cited pages.
    const seen = new Set();
    const urls = pages
      .map((p) => p.url)
      .filter((url) => {
        const key = linkKey(url) ?? url;
        if ((own && key === own) || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    if (!urls.length) return null;
    const picked = await brandCited(brandId, urls);
    const reads = (await Promise.all(picked.map((url) => read(url, signal).catch(() => null))))
      .map((r) => (typeof r === 'number' ? { length: r } : r))
      .filter((r) => Number.isFinite(r?.length) && r.length >= CITED_MIN_CHARACTERS);
    if (reads.length < CITED_MIN_PAGES) return null;
    const features = citedFeatures(reads);
    return {
      characters: Math.round(median(reads.map((r) => r.length)) / 100) * 100,
      pages: reads.length,
      ...(features ? { features } : {}),
    };
  } catch (err) {
    // A benchmark is never worth the brief: it goes without one.
    logger.warn({ err }, 'cited pages length read failed');
    return null;
  }
}
