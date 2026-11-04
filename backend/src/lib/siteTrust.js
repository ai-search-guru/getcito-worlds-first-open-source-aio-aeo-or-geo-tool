import * as cheerio from 'cheerio';
import supabaseAdmin from '../config/supabase.js';
import { fetchViaScrapeDo } from './audit/fetcher.js';
import { jsonLd, typesOf } from './audit/signals/helpers.js';
import { PageFetchError, fetchPage } from './safeFetch.js';
import { looksBlocked } from './sitePages.js';

/**
 * A brand's site trust (Content Editor Quality spec §8, CE-043): five
 * site-level checks Site Audit shows as "Site trust {n}/5", and Trust's 5
 * points on every page. Read from the brand's page list (site_pages), its
 * home page and its authors (Settings › Authors), at most once a day or when
 * someone asks again (not more than every few minutes), and kept in
 * site_trust (00259). Only the brand's own site is read. A read a site
 * didn't answer all of (slow, unreachable, a server error, a bot wall) is
 * kept only a few minutes. A home page behind a bot wall is read through
 * Scrape.do, unrendered, as the page list reads one (sitePages.js): at most
 * once a day per brand.
 */

export const SITE_TRUST_CHECKS = [
  'about',
  'contact',
  'editorial',
  'organizationSchema',
  'authorPages',
];
/** How long a read holds, and how soon asking again (or a partial read) reads again. */
export const SITE_TRUST_TTL_MS = 24 * 60 * 60 * 1000;
export const RECHECK_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8_000;
const FETCH_MAX_BYTES = 1024 * 1024;
/** The authors whose page is looked for at the usual addresses, when the page list has none. */
export const MAX_AUTHOR_PROBES = 3;
/** The usual addresses of an author's page: WordPress's, and the common plural. */
const AUTHOR_PROBES = ['/author/', '/authors/'];

/** Between a title's words and the site's name: "About us · Acme". */
export const SEPARATOR = String.raw`(?:\s*[|·•–—:-]|$)`;

/**
 * The pages three checks look for: the last part of the address, in the
 * languages the app reads, or a title that is just that ("About us · Acme",
 * not "About our pricing"); the addresses tried on the site when the page
 * list has none, whose title or H1 must have the word.
 */
export const PAGES = {
  about: {
    part: /^(?:about|about-us|company|who-we-are|our-story|hakkimizda|hakkımızda|uber-uns|ueber-uns|a-propos|sobre-nosotros|quienes-somos)$/i,
    title: new RegExp(
      `^(?:about(?:\\s+us)?|who we are|hakkımızda|über uns|à propos|sobre nosotros|quiénes somos)${SEPARATOR}`,
      'i',
    ),
    probe: ['/about', '/about-us'],
    word: /\babout\b|hakkımızda|über uns|à propos|sobre nosotros|quiénes somos/i,
  },
  contact: {
    part: /^(?:contact|contact-us|contacts|iletisim|iletişim|kontakt|contacto|nous-contacter)$/i,
    title: new RegExp(
      `^(?:contact(?:\\s+us)?|iletişim|kontakt|contacto|nous contacter)${SEPARATOR}`,
      'i',
    ),
    probe: ['/contact', '/contact-us'],
    word: /\bcontact|iletişim|kontakt|contacto/i,
  },
  editorial: {
    part: /^(?:editorial-policy|editorial-guidelines|editorial-standards|editorial-process|how-we-review|how-we-test|review-process|methodology|our-methodology|fact-checking-policy)$/i,
    title: new RegExp(
      `^(?:(?:our )?editorial (?:policy|guidelines|standards|process)|how we (?:review|test)|(?:our )?methodology|fact[- ]checking policy)${SEPARATOR}`,
      'i',
    ),
    probe: ['/editorial-policy', '/how-we-review'],
    word: /editorial|how we (?:review|test)|methodology|fact[- ]check/i,
  },
};

/** The folders an author's page sits in: "/authors/ada-lovelace". */
const AUTHOR_FOLDERS =
  /^(?:author|authors|team|people|staff|writers|contributors|yazar|yazarlar|autor|autoren|auteur|auteurs)$/i;

/** Organization and its kinds, as JSON-LD names them (the commonest local ones too). */
const ORGANIZATION_TYPES = new Set([
  'organization',
  'corporation',
  'store',
  'ngo',
  'professionalservice',
  'restaurant',
  'cafeorcoffeeshop',
  'bakery',
  'dentist',
  'physician',
  'hotel',
  'legalservice',
  'attorney',
  'realestateagent',
  'autodealer',
  'medicalclinic',
  'healthclub',
  'beautysalon',
  'travelagency',
  'insuranceagency',
  'accountingservice',
  'financialservice',
  'bankorcreditunion',
  'collegeoruniversity',
]);

/** A JSON-LD type without its vocabulary ("https://schema.org/Organization" → "organization"). */
const bareType = (type) => type.replace(/^.*[/:]/, '').toLowerCase();
const isOrganizationType = (type) => {
  const t = bareType(type);
  return ORGANIZATION_TYPES.has(t) || t.endsWith('organization') || t.endsWith('business');
};

export const pathParts = (url) => {
  try {
    return new URL(url).pathname.split('/').filter(Boolean).map(decodeURIComponent);
  } catch {
    return [];
  }
};

/** Whether a page of the list is the one a check looks for: its address's last part, or its title. */
function isPage(p, kind) {
  const { part, title } = PAGES[kind];
  const last = pathParts(p.url).at(-1);
  return (!!last && part.test(last)) || title.test((p.title ?? '').trim());
}

/** The page of the list a check looks for, or null. */
export function findPage(pages, kind) {
  return pages.find((p) => isPage(p, kind))?.url ?? null;
}

/** Whether a page's JSON-LD names an Organization (or a kind of one). */
export function hasOrganization(html) {
  return jsonLd({ $: cheerio.load(html) }).nodes.some((n) => typesOf(n).some(isOrganizationType));
}

/** "Ada Lovelace" → "ada-lovelace": how an author's page address names them. */
export function nameSlug(name) {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ı/g, 'i')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * An author's page on the site: one of the list's in an author folder named
 * for them ("/authors/ada-lovelace"), or titled just their name ("Ada
 * Lovelace · Acme"), or a profile link of theirs on the brand's own site.
 */
export function authorPage(pages, author, onSite) {
  const slug = nameSlug(author.name);
  const title = new RegExp(`^${escapeRegExp(author.name.trim())}${SEPARATOR}`, 'i');
  const found = pages.find((p) => {
    const parts = pathParts(p.url);
    const named = parts.findIndex((x) => x.toLowerCase() === slug);
    return (
      (!!slug && named > 0 && AUTHOR_FOLDERS.test(parts[named - 1])) ||
      title.test((p.title ?? '').trim())
    );
  });
  if (found) return found.url;
  return (author.same_as ?? []).find((link) => onSite(link)) ?? null;
}

const bareHost = (host) => host.toLowerCase().replace(/^www\./, '');

/** The brand's main domain, bare ("acme.com"), or null. */
export function mainDomain(domains) {
  const primary = domains.find((d) => d.is_primary) ?? domains[0];
  if (!primary) return null;
  return bareHost(primary.domain.replace(/^https?:\/\//, '').split('/')[0]);
}

/**
 * Whether a failed read says nothing yet: slow, unreachable, a server error,
 * or a bot wall (401, 403, 429), which may hide a page the site has.
 */
const unsure = (err) =>
  !(err instanceof PageFetchError) ||
  err.code === 'timeout' ||
  err.code === 'unreachable' ||
  (err.code === 'http_error' && ((err.status ?? 0) >= 500 || looksBlocked(err.status, '')));

/** Whether a failed read was turned away by a bot wall, so Scrape.do may try. */
const walledError = (err) =>
  err instanceof PageFetchError && err.code === 'http_error' && looksBlocked(err.status, '');

/** A page's title and H1, to tell it from the home page. */
export function heads(html) {
  const $ = cheerio.load(html);
  return { title: $('title').first().text().trim(), h1: $('h1').first().text().trim() };
}

/**
 * Whether a page that answered is a bot wall's challenge ("Just a moment…",
 * "Access denied"), by its title and H1: the rest of a real page may name a
 * captcha (a contact form's script) without being one.
 */
export function walledPage(html) {
  const { title, h1 } = heads(html);
  return looksBlocked(200, `${title} ${h1}`);
}

/** Whether a title or H1 names the author, as whole words ("Ada Lovelace, Author at Acme"). */
function namesAuthor(text, name) {
  const words = escapeRegExp(name.trim()).replace(/\s+/g, '\\s+');
  return new RegExp(`(?<![\\p{L}\\p{N}])${words}(?![\\p{L}\\p{N}])`, 'iu').test(text);
}

/** The home page through Scrape.do, unrendered: one request, one credit. */
const scrapeHome = (url) => fetchViaScrapeDo(url, { render: false, retries: 0 });

/**
 * Reads the five checks for a brand: each with whether it passes and the page
 * that passes it, whether the site answered all of it (`complete`), and
 * whether its home page went through Scrape.do (`scraped`).
 *
 * `scraper` reads a home page a bot wall turned away (null: none is read);
 * `keptHome` is the kept read's Organization check while a Scrape.do read
 * from today stands: a pass stands while the wall hides the home page.
 */
export async function computeSiteTrust(
  brandId,
  { db = supabaseAdmin, fetcher = fetchPage, scraper = null, keptHome = null } = {},
) {
  const { data: brand, error: brandError } = await db
    .from('brands')
    .select('organization_id')
    .eq('id', brandId)
    .single();
  if (brandError) throw new Error(brandError.message);
  const [domainsRes, pagesRes, authorsRes, draftsRes, defaultRes] = await Promise.all([
    db.from('brand_domains').select('domain, is_primary').eq('brand_id', brandId),
    db.from('site_pages').select('url, title, fetch_status').eq('brand_id', brandId).order('url'),
    db
      .from('content_authors')
      .select('id, name, same_as')
      .eq('organization_id', brand.organization_id)
      .order('name'),
    db
      .from('content_drafts')
      .select('author_id')
      .eq('brand_id', brandId)
      .not('author_id', 'is', null),
    db.from('content_author_defaults').select('author_id').eq('brand_id', brandId),
  ]);
  for (const res of [domainsRes, pagesRes, authorsRes, draftsRes, defaultRes]) {
    if (res.error) throw new Error(res.error.message);
  }
  const domain = mainDomain(domainsRes.data ?? []);
  // A page that answered with an error isn't one the site has.
  const pages = (pagesRes.data ?? []).filter(
    (p) => p.fetch_status == null || (p.fetch_status > 0 && p.fetch_status < 400),
  );
  const onSite = (link) => {
    try {
      const host = bareHost(new URL(link).hostname);
      return !!domain && (host === domain || host.endsWith(`.${domain}`));
    } catch {
      return false;
    }
  };
  let complete = true;
  /** A page of the site, or why not: `walled` when a bot wall turned the read away. */
  const attempt = async (url) => {
    try {
      const page = await fetcher(url, { timeoutMs: FETCH_TIMEOUT_MS, maxBytes: FETCH_MAX_BYTES });
      // Only the brand's own site: a page that lands elsewhere isn't read.
      if (!onSite(page.url)) return { page: null };
      return walledPage(page.html) ? { page: null, walled: true } : { page };
    } catch (err) {
      return { page: null, walled: walledError(err), unsure: unsure(err) };
    }
  };
  const read = async (url) => {
    const { page, walled, unsure: notSure } = await attempt(url);
    if (walled || notSure) complete = false;
    return page;
  };

  // The home page first: a site that answers every address with it has none of the others there.
  const home = domain ? `https://${domain}/` : null;
  let homePage = null;
  let scraped = false;
  let homeCheck = null;
  if (home) {
    const direct = await attempt(home);
    homePage = direct.page;
    if (direct.walled && scraper) {
      // Turned away: read once through Scrape.do, as the page list does.
      scraped = true;
      const proxied = await scraper(home).catch(() => null);
      if (proxied?.ok && proxied.html && !walledPage(proxied.html)) {
        homePage = { url: home, html: proxied.html };
      }
    }
    if (!homePage && (direct.walled || direct.unsure)) {
      // What a Scrape.do read showed earlier today stands; else it isn't known yet.
      if (keptHome?.ok) homeCheck = { ok: true, url: home };
      else complete = false;
    }
  }
  const homeHeads = homePage ? heads(homePage.html) : null;

  // An address the site answers counts when it isn't the home page again, its
  // address or title is the page's ("/about" → "/company/about" too), and its
  // title or H1 says what it is.
  const probe = async (kind) => {
    for (const path of domain ? PAGES[kind].probe : []) {
      const page = await read(`https://${domain}${path}`);
      if (!page) continue;
      const { title, h1 } = heads(page.html);
      if (homeHeads && title === homeHeads.title && h1 === homeHeads.h1) continue;
      if (isPage({ url: page.url, title }, kind) && PAGES[kind].word.test(`${title} ${h1}`)) {
        return page.url;
      }
    }
    return null;
  };
  const found = await Promise.all(
    ['about', 'contact', 'editorial'].map(async (kind) => findPage(pages, kind) ?? probe(kind)),
  );
  const checks = {
    about: { ok: !!found[0], url: found[0] },
    contact: { ok: !!found[1], url: found[1] },
    editorial: { ok: !!found[2], url: found[2] },
    organizationSchema: homeCheck ?? {
      ok: !!homePage && hasOrganization(homePage.html),
      url: home,
    },
  };

  // The brand's authors: the ones its pages are by and its default; else the workspace's.
  const used = new Set([
    ...(draftsRes.data ?? []).map((d) => d.author_id),
    ...(defaultRes.data ?? []).map((d) => d.author_id),
  ]);
  const all = authorsRes.data ?? [];
  const brandAuthors = all.some((a) => used.has(a.id)) ? all.filter((a) => used.has(a.id)) : all;
  const authors = brandAuthors.map((a) => ({ name: a.name, url: authorPage(pages, a, onSite) }));
  // An author the list has no page for: their page at the usual addresses,
  // with the probes' guards (not the home page again, on the site), titled or
  // headed with their name. A few authors only, so a read stays bounded.
  const probeAuthor = async (author) => {
    const slug = nameSlug(author.name);
    for (const folder of slug ? AUTHOR_PROBES : []) {
      const page = await read(`https://${domain}${folder}${slug}`);
      if (!page) continue;
      const { title, h1 } = heads(page.html);
      if (homeHeads && title === homeHeads.title && h1 === homeHeads.h1) continue;
      if (namesAuthor(`${title} ${h1}`, author.name)) return page.url;
    }
    return null;
  };
  const unmatched = domain ? authors.filter((a) => !a.url).slice(0, MAX_AUTHOR_PROBES) : [];
  await Promise.all(
    unmatched.map(async (a) => {
      a.url = await probeAuthor(a);
    }),
  );
  checks.authorPages = { ok: authors.length > 0 && authors.every((a) => a.url), authors };

  return {
    checks,
    score: SITE_TRUST_CHECKS.filter((k) => checks[k].ok).length,
    complete,
    scraped,
  };
}

/** Reads under way, by brand: two asks at once read once. */
const reading = new Map();

/**
 * The brand's site trust: the kept read while it holds (a day; a few minutes
 * when asked again or when the site didn't answer all of it), else a new
 * read, kept. `complete` is false when the site didn't answer all of it: the
 * checks it couldn't read are read again soon, not to be fixed.
 *
 * A home page behind a bot wall goes through Scrape.do once a day per brand
 * (site_trust.scraped_at), whoever asks and however often: a read within the
 * day keeps what that one showed.
 *
 * `keptOnly` (an organization whose plan has ended) answers the kept read
 * however old, and null when none is kept: the site is never read for it.
 *
 * @returns {Promise<{ checks: object, score: number, complete: boolean, checkedAt: string } | null>}
 */
export async function readSiteTrust(
  brandId,
  {
    refresh = false,
    keptOnly = false,
    db = supabaseAdmin,
    fetcher = fetchPage,
    scraper = process.env.SCRAPEDO_API_KEY ? scrapeHome : null,
    now = Date.now(),
  } = {},
) {
  const { data: kept, error } = await db
    .from('site_trust')
    .select('checks, score, complete, checked_at, scraped_at')
    .eq('brand_id', brandId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const keptRead = kept && {
    checks: kept.checks,
    score: kept.score,
    complete: kept.complete !== false,
    checkedAt: kept.checked_at,
  };
  if (keptOnly) return keptRead || null;
  if (kept) {
    const age = now - Date.parse(kept.checked_at);
    const holds = refresh || kept.complete === false ? RECHECK_MS : SITE_TRUST_TTL_MS;
    if (age < holds) return keptRead;
  }
  let pending = reading.get(brandId);
  if (!pending) {
    pending = (async () => {
      const scrapedToday =
        !!kept?.scraped_at && now - Date.parse(kept.scraped_at) < SITE_TRUST_TTL_MS;
      const { checks, score, complete, scraped } = await computeSiteTrust(brandId, {
        db,
        fetcher,
        scraper: scrapedToday ? null : scraper,
        keptHome: scrapedToday ? (kept.checks?.organizationSchema ?? null) : null,
      });
      const checkedAt = new Date(now).toISOString();
      const { error: keepError } = await db.from('site_trust').upsert(
        {
          brand_id: brandId,
          checks,
          score,
          complete,
          checked_at: checkedAt,
          scraped_at: scraped ? checkedAt : (kept?.scraped_at ?? null),
        },
        { onConflict: 'brand_id' },
      );
      if (keepError) throw new Error(keepError.message);
      return { checks, score, complete, checkedAt };
    })().finally(() => reading.delete(brandId));
    reading.set(brandId, pending);
  }
  return pending;
}
