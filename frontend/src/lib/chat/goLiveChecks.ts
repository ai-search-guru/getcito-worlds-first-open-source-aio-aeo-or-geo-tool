import { linksToSites, type PageSites } from './pageSites';
import { looksLikeInjection, stripHidden } from './untrusted';

/**
 * What an agent's page must pass to go live on its own (AUTONOMOUS-GO-LIVE
 * §6.3 Part B, owner's Q1 answer B): checked on the page as it will be sent,
 * not on the run's taint, which every content agent has (it reads drafts and
 * AI answers). Outside text may shape the page; it may not instruct, hide
 * words, be copied in whole runs, or pick where the page links.
 *
 *   - instructions: text aimed at AI in the page, its hidden parts or its
 *     structured data;
 *   - hidden_text: what a reader can't see (zero-width or tag characters,
 *     comments, hidden elements);
 *   - copied: 30 words or more in a row that an untrusted read of this run
 *     returned. The engine keeps 64-bit hashes of each 12-word run of those
 *     reads (keepShingles), 32 KB at most; past that the check can't tell,
 *     and holds the page;
 *   - foreign_link: a link to a site that isn't the brand's, a source the
 *     draft lists, or a page a read listed in a structured field.
 *
 * Any of these makes the step a click card. Pure.
 */

export type GoLiveTextHold = 'instructions' | 'hidden_text' | 'copied';

/** Words in a hashed run. */
export const SHINGLE_WORDS = 12;
/** Words in a row that make a copy. */
export const COPY_MIN_WORDS = 30;
/** The kept hashes' size at most, in characters. */
export const SHINGLES_MAX_CHARS = 32 * 1024;
/** Characters a hash takes: 64 bits in base64url. */
const HASH_CHARS = 11;

/** The untrusted reads' word runs a run keeps (RunProgress.untrustedShingles). */
export interface UntrustedShingles {
  /** 64-bit hashes, HASH_CHARS characters each, end to end. */
  hashes: string;
  /** Some weren't kept: past SHINGLES_MAX_CHARS. */
  full: boolean;
}

/** A text's words as compared: NFKC, lower case, letters and digits only. */
export function wordsOf(text: string): string[] {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/['’]/g, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

// BigInt() rather than literals: the web's TypeScript targets below ES2020.
const FNV_OFFSET = BigInt('0xcbf29ce484222325');
const FNV_PRIME = BigInt('0x100000001b3');
const MASK = (BigInt(1) << BigInt(64)) - BigInt(1);
const SIX_BITS = BigInt(63);
const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** FNV-1a, 64 bits, over a word's code points. */
function wordHash(word: string): bigint {
  let h = FNV_OFFSET;
  for (const ch of word) {
    h ^= BigInt(ch.codePointAt(0) ?? 0);
    h = (h * FNV_PRIME) & MASK;
  }
  return h;
}

function encode(h: bigint): string {
  let out = '';
  for (let i = 0; i < HASH_CHARS; i++) out += BASE64URL[Number((h >> BigInt(i * 6)) & SIX_BITS)];
  return out;
}

/** Each run of SHINGLE_WORDS words of a text, hashed, in order. */
export function shinglesOf(text: string): string[] {
  const words = wordsOf(text).map(wordHash);
  const out: string[] = [];
  for (let start = 0; start + SHINGLE_WORDS <= words.length; start++) {
    let h = FNV_OFFSET;
    for (let i = start; i < start + SHINGLE_WORDS; i++) {
      h ^= words[i];
      h = (h * FNV_PRIME) & MASK;
    }
    out.push(encode(h));
  }
  return out;
}

const hashesIn = (kept: UntrustedShingles | undefined) => {
  const set = new Set<string>();
  const text = kept?.hashes ?? '';
  for (let i = 0; i + HASH_CHARS <= text.length; i += HASH_CHARS) {
    set.add(text.slice(i, i + HASH_CHARS));
  }
  return set;
};

/** The run's kept hashes with those of an untrusted read's texts, each once, up to the cap. */
export function keepShingles(
  kept: UntrustedShingles | undefined,
  texts: string[],
): UntrustedShingles {
  const seen = hashesIn(kept);
  let hashes = kept?.hashes ?? '';
  let full = kept?.full ?? false;
  for (const text of texts) {
    for (const hash of shinglesOf(text)) {
      if (seen.has(hash)) continue;
      if (hashes.length + HASH_CHARS > SHINGLES_MAX_CHARS) {
        full = true;
        continue;
      }
      seen.add(hash);
      hashes += hash;
    }
  }
  return { hashes, full };
}

/** Every text in a read's result, for keepShingles. */
export function textsOf(value: unknown, depth = 0): string[] {
  if (typeof value === 'string') return [value];
  if (depth > 8 || !value || typeof value !== 'object') return [];
  const items = Array.isArray(value) ? value : Object.values(value);
  return items.flatMap((item) => textsOf(item, depth + 1));
}

/** Whether a text has COPY_MIN_WORDS words in a row from the kept reads. */
export function copiedFrom(text: string, kept: UntrustedShingles | undefined): boolean {
  const known = hashesIn(kept);
  if (known.size === 0) return false;
  const needed = COPY_MIN_WORDS - SHINGLE_WORDS + 1;
  let inRow = 0;
  for (const hash of shinglesOf(text)) {
    inRow = known.has(hash) ? inRow + 1 : 0;
    if (inRow >= needed) return true;
  }
  return false;
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === '#') {
      const code =
        name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1));
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

/** What a reader reads of a page: its text, without scripts, styles or tags. */
export function readerText(html: string): string {
  return decodeEntities(
    html.replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, ' ').replace(/<[^>]*>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

/** All a page's text, its scripts' (structured data) included. */
const allText = (html: string) => decodeEntities(html.replace(/<[^>]*>/g, ' '));

/**
 * Why a page can't go live on its own for its text, or null when it can.
 * `html` is the page as it will be sent (publishable, with its added
 * structured data); `kept` the run's untrusted reads.
 */
export function outgoingTextCheck(
  html: string,
  kept: UntrustedShingles | undefined,
): GoLiveTextHold | null {
  const stripped = stripHidden(html);
  if (
    looksLikeInjection(readerText(html)) ||
    looksLikeInjection(allText(html)) ||
    looksLikeInjection(allText(stripped))
  ) {
    return 'instructions';
  }
  if (stripped !== html) return 'hidden_text';
  // Past the cap, a copy can't be told apart: the page waits on a click.
  if (kept?.full || copiedFrom(readerText(html), kept)) return 'copied';
  return null;
}

const HREF = /<(?:a|area)\b[^>]*?\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;

/**
 * The first link of a page that goes where an agent may not send a reader on
 * its own, named (a host, a mail domain or a scheme), or null. Allowed: a
 * link inside the page or the site (#part, a relative path), an http(s)
 * page on the list (the brand's domains, the draft's Sources, the pages a
 * read listed: linksToSites), a mail address on the brand's domains, a phone
 * number.
 */
export function foreignLink(html: string, sites: PageSites): string | null {
  for (const match of html.matchAll(HREF)) {
    const href = decodeEntities(match[1] ?? match[2] ?? match[3] ?? '').trim();
    if (!href || href.startsWith('#')) continue;
    const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(href)?.[1]?.toLowerCase() ?? null;
    if (scheme === null) {
      // A path on the site, or //host/… with the page's own scheme.
      if (!href.startsWith('//')) continue;
      if (!linksToSites(`https:${href}`, sites)) return hostOf(`https:${href}`) ?? href;
      continue;
    }
    if (scheme === 'tel') continue;
    if (scheme === 'mailto') {
      const domain = href.slice(7).split('?')[0].split('@')[1]?.toLowerCase() ?? '';
      if (domain && linksToSites(`https://${domain}/`, { ...sites, hosts: [], urls: [] })) {
        continue;
      }
      return domain || 'mailto:';
    }
    if (scheme !== 'http' && scheme !== 'https') return `${scheme}:`;
    if (!linksToSites(href, sites)) return hostOf(href) ?? href;
  }
  return null;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}
