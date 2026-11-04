/**
 * Site page inventory (#857, Phase 2): the pages a brand's site has, so a
 * content opportunity can tell "update the page you have" from "write a new
 * one".
 *
 * The site is not crawled. Pages come from three lists the brand already
 * publishes or we already hold:
 *
 * - the sitemap (robots.txt `Sitemap:` lines, else /sitemap.xml),
 * - the landing pages GA reports traffic for,
 * - the brand's own pages AI answers cite.
 *
 * Up to 500 are kept, pages with AI citations and traffic first. For each,
 * only the title, meta description and first heading are read, and a page is
 * re-read every 30 days. Pages are asked for directly; only a page that
 * answers with a block (403, 429, a bot challenge) goes through Scrape.do,
 * unrendered, so most sites cost no credits at all.
 */

import { gunzipSync } from 'node:zlib';
import supabaseAdmin from '../config/supabase.js';
import { fetchViaScrapeDo } from './audit/fetcher.js';
import { isExcludedPath } from './pagePaths.js';
import { logger } from './logger.js';

export const MAX_PAGES = 500;
const REFRESH_DAYS = 30;
const WINDOW_DAYS = 30;
const MAX_SITEMAP_URLS = 5000;
const MAX_CHILD_SITEMAPS = 20;
const FETCH_TIMEOUT_MS = 10_000;
const CONCURRENCY = 5;
const FIELD_MAX = 300;
const USER_AGENT = 'Mozilla/5.0 (compatible; GetCitoBot/1.0; +https://getcito.com)';

const NON_HTML =
  /\.(pdf|jpe?g|png|gif|webp|svg|ico|mp4|mp3|zip|gz|xml|txt|json|css|js|docx?|xlsx?|pptx?)$/i;

// ─── Pure helpers ────────────────────────────────────────────────────────────

const bareHost = (host) => host.toLowerCase().replace(/^www\./, '');

/**
 * A page URL in one canonical form — https, no www., no query or fragment,
 * no trailing slash except the root — or null when it is not a page of this site worth
 * listing: another host, a file, or a checkout/legal/careers path.
 * Subdomains of the brand's domain count as its site.
 */
export function normalizePageUrl(raw, domain) {
  let url;
  try {
    url = new URL(String(raw).trim(), `https://${domain}`);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol)) return null;
  const host = bareHost(url.hostname);
  const site = bareHost(domain);
  if (host !== site && !host.endsWith(`.${site}`)) return null;
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (NON_HTML.test(path) || isExcludedPath(path)) return null;
  // www. is dropped so the same page listed both ways is one entry; reading
  // it follows the site's redirect.
  return `https://${host}${path === '/' ? '' : path}`;
}

const decode = (s) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();

const tag = (block, name) => {
  const m = block.match(new RegExp(`<(?:[a-z]+:)?${name}>([\\s\\S]*?)</(?:[a-z]+:)?${name}>`, 'i'));
  return m ? decode(m[1]) : null;
};

/** Page entries and child sitemaps of one sitemap (or sitemap index) document. */
export function parseSitemap(xml) {
  const blocks = (name) =>
    [
      ...String(xml).matchAll(
        new RegExp(`<(?:[a-z]+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:[a-z]+:)?${name}>`, 'gi'),
      ),
    ].map((m) => m[1]);
  return {
    sitemaps: blocks('sitemap')
      .map((b) => tag(b, 'loc'))
      .filter(Boolean),
    urls: blocks('url')
      .map((b) => ({ loc: tag(b, 'loc'), lastmod: tag(b, 'lastmod') }))
      .filter((u) => u.loc),
  };
}

/** Sitemap URLs a robots.txt declares. */
export function robotsSitemaps(robots) {
  return [...String(robots).matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((m) => m[1]);
}

const clip = (s) => (s ? decode(s.replace(/<[^>]+>/g, ' ')).slice(0, FIELD_MAX) || null : null);

/** The title, meta description and first h1 of an HTML page. */
export function parseHead(html) {
  const text = String(html);
  const meta = (attr, value) => {
    const re = new RegExp(`<meta[^>]*${attr}\\s*=\\s*["']${value}["'][^>]*>`, 'i');
    const el = text.match(re)?.[0];
    return (
      el
        ?.match(/content\s*=\s*"([^"]*)"|content\s*=\s*'([^']*)'/i)
        ?.slice(1)
        .find(Boolean) ?? null
    );
  };
  return {
    title: clip(text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? null),
    description: clip(meta('name', 'description') ?? meta('property', 'og:description')),
    h1: clip(text.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? null),
  };
}

/** Whether a direct request was turned away by a bot wall, so Scrape.do should try. */
export function looksBlocked(status, html) {
  if ([401, 403, 429, 503].includes(status)) return true;
  return /cf-challenge|just a moment\.\.\.|captcha|access denied/i.test(
    String(html).slice(0, 5000),
  );
}

/**
 * The pages to keep: merged from the three sources, pages with AI citations
 * first, then traffic, then sitemap order.
 *
 * @param {{ sitemap: {loc: string, lastmod: string|null}[], ga: [string, number][], citations: {url: string, cur_citations: number}[] }} sources
 */
export function selectPages({ sitemap, ga, citations }, domain, limit = MAX_PAGES) {
  const pages = new Map();
  const add = (raw, source, fields = {}) => {
    const url = normalizePageUrl(raw, domain);
    if (!url) return;
    const page = pages.get(url) || {
      url,
      sources: [],
      lastmod: null,
      ga_sessions: 0,
      ai_citations: 0,
      order: pages.size,
    };
    if (!page.sources.includes(source)) page.sources.push(source);
    if (fields.lastmod && !page.lastmod) page.lastmod = fields.lastmod;
    page.ga_sessions += fields.ga_sessions || 0;
    page.ai_citations += fields.ai_citations || 0;
    pages.set(url, page);
  };

  for (const c of citations) add(c.url, 'citation', { ai_citations: Number(c.cur_citations) || 0 });
  for (const [path, sessions] of ga) add(path, 'ga', { ga_sessions: Number(sessions) || 0 });
  for (const u of sitemap) {
    const lastmod =
      u.lastmod && !Number.isNaN(Date.parse(u.lastmod)) ? new Date(u.lastmod).toISOString() : null;
    add(u.loc, 'sitemap', { lastmod });
  }

  return [...pages.values()]
    .sort(
      (a, b) =>
        b.ai_citations - a.ai_citations || b.ga_sessions - a.ga_sessions || a.order - b.order,
    )
    .slice(0, limit)
    .map(({ order: _order, ...page }) => page);
}

// ─── Fetching ────────────────────────────────────────────────────────────────

async function fetchDirect(url, { binary = false } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xml;q=0.9,*/*;q=0.8' },
      redirect: 'follow',
      signal: controller.signal,
    });
    const body = binary ? Buffer.from(await res.arrayBuffer()) : await res.text();
    return { ok: res.ok, status: res.status, body };
  } catch {
    return { ok: false, status: 0, body: binary ? Buffer.alloc(0) : '' };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchSitemap(url) {
  const gz = /\.gz$/i.test(new URL(url).pathname);
  const res = await fetchDirect(url, { binary: gz });
  if (!res.ok) return null;
  try {
    return gz ? gunzipSync(res.body).toString('utf8') : res.body;
  } catch {
    return null;
  }
}

/** Page entries from the site's sitemaps, following one level of sitemap index. */
async function readSitemaps(domain) {
  const robots = await fetchDirect(`https://${domain}/robots.txt`);
  let queue = robots.ok ? robotsSitemaps(robots.body) : [];
  if (!queue.length)
    queue = [`https://${domain}/sitemap.xml`, `https://${domain}/sitemap_index.xml`];

  const urls = [];
  const seen = new Set();
  let children = 0;
  while (queue.length && urls.length < MAX_SITEMAP_URLS) {
    const next = queue.shift();
    if (seen.has(next)) continue;
    seen.add(next);
    const xml = await fetchSitemap(next);
    if (!xml) continue;
    const parsed = parseSitemap(xml);
    urls.push(...parsed.urls);
    for (const child of parsed.sitemaps) {
      if (children >= MAX_CHILD_SITEMAPS) break;
      children += 1;
      queue.push(child);
    }
  }
  return urls.slice(0, MAX_SITEMAP_URLS);
}

/** Read one page's head: directly, then through Scrape.do if the direct request was blocked. */
async function readPage(url) {
  const direct = await fetchDirect(url);
  if (direct.ok) return { status: direct.status, via: 'direct', head: parseHead(direct.body) };
  if (!looksBlocked(direct.status, direct.body) || !process.env.SCRAPEDO_API_KEY) {
    return { status: direct.status, via: 'direct', head: null };
  }
  const proxied = await fetchViaScrapeDo(url, { render: false });
  return {
    status: proxied.status,
    via: 'scrapedo',
    head: proxied.ok ? parseHead(proxied.html) : null,
  };
}

// ─── Refresh ─────────────────────────────────────────────────────────────────

/**
 * Brings a brand's page inventory up to date: re-selects the 500 pages and
 * reads the ones never read or read more than 30 days ago.
 */
export async function refreshSitePages(brandId) {
  const { data: domains } = await supabaseAdmin
    .from('brand_domains')
    .select('domain, is_primary')
    .eq('brand_id', brandId);
  const primary = (domains || []).find((d) => d.is_primary) || domains?.[0];
  if (!primary) return;
  const domain = bareHost(primary.domain.replace(/^https?:\/\//, '').split('/')[0]);

  const now = Date.now();
  const since = new Date(now - WINDOW_DAYS * 86_400_000);
  const [sitemap, gaRes, citeRes, existingRes] = await Promise.all([
    readSitemaps(domain),
    supabaseAdmin.rpc('brand_landing_page_sessions', {
      p_brand_id: brandId,
      p_since: since.toISOString().slice(0, 10),
    }),
    supabaseAdmin.rpc('ae_owned_citations', {
      p_brand_id: brandId,
      p_cur_from: since.toISOString(),
      p_prev_from: since.toISOString(),
    }),
    supabaseAdmin.from('site_pages').select('id, url, fetched_at').eq('brand_id', brandId),
  ]);
  for (const r of [gaRes, citeRes, existingRes]) if (r.error) throw new Error(r.error.message);

  const selected = selectPages(
    { sitemap, ga: gaRes.data || [], citations: citeRes.data || [] },
    domain,
  );
  const existing = new Map((existingRes.data || []).map((p) => [p.url, p]));
  const keep = new Set(selected.map((p) => p.url));

  const dropped = [...existing.values()].filter((p) => !keep.has(p.url)).map((p) => p.id);
  if (dropped.length) {
    const { error } = await supabaseAdmin.from('site_pages').delete().in('id', dropped);
    if (error) throw new Error(error.message);
  }
  if (selected.length) {
    const stamp = new Date(now).toISOString();
    const { error } = await supabaseAdmin.from('site_pages').upsert(
      selected.map((p) => ({ brand_id: brandId, ...p, updated_at: stamp })),
      { onConflict: 'brand_id,url' },
    );
    if (error) throw new Error(error.message);
  }

  const stale = selected.filter((p) => {
    const fetchedAt = existing.get(p.url)?.fetched_at;
    return !fetchedAt || now - Date.parse(fetchedAt) > REFRESH_DAYS * 86_400_000;
  });
  const counts = { direct: 0, scrapedo: 0, failed: 0 };
  for (let i = 0; i < stale.length; i += CONCURRENCY) {
    await Promise.all(
      stale.slice(i, i + CONCURRENCY).map(async (p) => {
        const read = await readPage(p.url);
        if (read.head) counts[read.via] += 1;
        else counts.failed += 1;
        const { error } = await supabaseAdmin
          .from('site_pages')
          .update({
            ...(read.head || {}),
            fetch_status: read.status,
            fetched_via: read.via,
            fetched_at: new Date().toISOString(),
          })
          .eq('brand_id', brandId)
          .eq('url', p.url);
        if (error) logger.error({ err: error, brandId, url: p.url }, '[site-pages] write failed');
      }),
    );
  }

  logger.info(
    {
      brandId,
      domain,
      sitemapUrls: sitemap.length,
      pages: selected.length,
      dropped: dropped.length,
      read: stale.length,
      ...counts,
    },
    '[site-pages] refreshed',
  );
}
