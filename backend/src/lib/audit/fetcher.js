/**
 * Page fetching for the Site Audit. The target page goes through Scrape.do
 * (proxy + JS render), so we get the same HTML an AI render bot would. Small
 * auxiliary files (robots.txt, llms.txt) are fetched directly — they're public
 * by convention and not worth a Scrape.do credit each.
 */

import { nestsTooDeep } from '../htmlDepth.js';

const SCRAPEDO_API = 'https://api.scrape.do';

function getToken() {
  const token = process.env.SCRAPEDO_API_KEY;
  if (!token) throw new Error('SCRAPEDO_API_KEY must be configured');
  return token;
}

/**
 * Fetch a URL through Scrape.do and return the rendered HTML. A page nested
 * deeper than any browser keeps comes back not ok, with no HTML and the error
 * 'too_deep', so it isn't parsed (htmlDepth.js).
 *
 * @param {string} targetUrl
 * @param {{ render?: boolean }} [opts]
 * @returns {Promise<{ ok: boolean, status: number, html: string, contentType: string|null, error?: string }>}
 */
export async function fetchViaScrapeDo(targetUrl, { render = true, retries = 1 } = {}) {
  const params = new URLSearchParams({ token: getToken(), url: targetUrl });
  if (render) params.set('render', 'true');
  const endpoint = `${SCRAPEDO_API}/?${params.toString()}`;

  let last = { ok: false, status: 0, html: '', contentType: null };
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const res = await fetch(endpoint);
      const html = await res.text();
      const contentType = res.headers.get('content-type');
      if (res.ok && nestsTooDeep(html)) {
        return { ok: false, status: res.status, html: '', contentType, error: 'too_deep' };
      }
      last = { ok: res.ok, status: res.status, html, contentType };
      // Retry only on proxy-side 5xx (transient); 4xx is the target's verdict.
      if (res.ok || res.status < 500) return last;
    } catch (err) {
      last = { ok: false, status: 0, html: '', contentType: null, error: err.message };
    }
  }
  return last;
}

/**
 * Direct fetch of a small text resource (robots.txt / llms.txt). Returns null
 * on any failure or non-2xx so the caller can decide whether to fall back.
 *
 * @param {string} url
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<string|null>}
 */
async function fetchTextDirect(url, { timeoutMs = 8000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'user-agent': 'GetCitoSiteAudit/1.0 (+https://getcito.com)' },
      redirect: 'follow',
    });
    if (res.ok) return { body: await res.text(), blocked: false };
    // 404 / 410 → the file genuinely isn't there (don't waste a proxy credit).
    // 401/403/405/406/429/503 → smells like an anti-bot block, worth a retry.
    const blocked = [401, 403, 405, 406, 429, 503].includes(res.status);
    return { body: null, blocked };
  } catch {
    // Timeout / TLS / network error — could be a block; let the caller retry.
    return { body: null, blocked: true };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch a small text resource (robots.txt / llms.txt), trying a cheap direct
 * request first and falling back to Scrape.do when the site blocks us (so
 * Cloudflare-style anti-bot doesn't produce a false "absent" reading). Returns
 * null only when both paths fail.
 *
 * @param {string} url
 * @returns {Promise<string|null>}
 */
export async function fetchText(url) {
  const direct = await fetchTextDirect(url);
  if (direct.body !== null) return direct.body;
  // Clean 404 → the file is genuinely absent; no point spending a proxy credit.
  if (!direct.blocked) return null;

  // Direct request looked blocked — retry through Scrape.do (no JS render
  // needed for a text file). Treat HTML error pages as "absent".
  try {
    const viaProxy = await fetchViaScrapeDo(url, { render: false, retries: 0 });
    if (!viaProxy.ok || !viaProxy.html) return null;
    if (/<html[\s>]/i.test(viaProxy.html)) return null;
    return viaProxy.html;
  } catch {
    return null;
  }
}
