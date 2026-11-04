/**
 * Readable opportunity text (CONTENT-005).
 *
 * The generator shows the model its inputs by bracketed index — clusters as
 * [0], pages as [P0], existing opportunities as [E0] — and asks it never to
 * repeat them. It sometimes does anyway, and the older per-prompt generator
 * often did: "targeting prompt [0] to close the gap", "improve [P2] by …
 * from [P1]". Competitor names also come back misspelled ("Profund").
 *
 * New opportunities are cleaned before they're saved, with the run's own
 * clusters, pages and opportunities to resolve each index. Stored ones are
 * cleaned when they're read, with what the row itself records, so old text
 * reads properly without being rewritten. A past year in a stored title or
 * question reads as this year (currentYear.js).
 */

import { refreshYears } from './currentYear.js';

/**
 * "prompt [0]", "cluster [1]", "page [P2]" and bare "[P2]" / "[E0]", with the
 * leading noun so "prompt [0]" becomes the prompt itself rather than
 * "prompt "…"". A bare "[3]" is only an index when the caller says so
 * (`bare`): in stored text it may as well be ordinary writing.
 */
const NAMED = /\b(?:prompts?|clusters?|pages?|opportunit(?:y|ies))\s*\[(P|E)?(\d+)\]/gi;
const PREFIXED = /\s?\[(P|E)(\d+)\]/gi;
const BARE = /\s?\[()(\d+)\]/g;

/** A leaked index of any kind, for checks and tests. */
export const LEAKED_REFERENCE = /\[(?:P|E)?\d+\]/i;

const quote = (text) => `"${String(text).trim()}"`;

/**
 * Replaces every bracketed index with what it stood for: a cluster's label, a
 * page's title or URL, an existing opportunity's title. Without that list (or
 * past its end) a prompt index becomes `prompt` (the opportunity's own prompt)
 * or "this prompt", and the others a neutral word ("the page"). The spacing
 * around it is tidied.
 *
 * @param {string} text
 * @param {{
 *   clusters?: string[],
 *   pages?: { title?: string|null, h1?: string|null, url?: string }[],
 *   existing?: string[],
 *   prompt?: string|null,
 *   bare?: boolean,
 * }} ctx - `bare`: also treat a lone "[3]" as a cluster index
 */
export function resolveReferences(
  text,
  { clusters = [], pages = [], existing = [], prompt = null, bare = false } = {},
) {
  if (!text || !LEAKED_REFERENCE.test(text)) return text;
  const resolve = (match, kind, digits) => {
    const n = Number(digits);
    const lead = /^\s/.test(match) ? ' ' : '';
    if (kind?.toUpperCase() === 'P') {
      const page = pages[n];
      return `${lead}${page ? page.title || page.h1 || page.url : 'the page'}`;
    }
    if (kind?.toUpperCase() === 'E') {
      return existing[n] ? `${lead}${quote(existing[n])}` : `${lead}an existing opportunity`;
    }
    if (clusters[n]) return `${lead}${quote(clusters[n])}`;
    return `${lead}${prompt ? quote(prompt) : 'this prompt'}`;
  };
  let replaced = text.replace(NAMED, resolve).replace(PREFIXED, resolve);
  if (bare) replaced = replaced.replace(BARE, resolve);
  return replaced
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim();
}

/** Edit distance, with an early exit once it exceeds `max`. */
export function distance(a, b, max = Infinity) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, row[j]);
    }
    if (best > max) return max + 1;
    prev = row;
  }
  return prev[b.length];
}

/** Typos allowed for a name: one for short names, two from eight letters. */
const allowedTypos = (name) => (name.length >= 8 ? 2 : 1);

const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’.-]*/gu;

/**
 * Corrects misspelled competitor names to the brand's configured spelling:
 * "Profund" becomes "Profound". Only words close to a configured name are
 * touched — capitalized like a name, at most one typo (two for names of
 * eight letters or more), and never names shorter than five letters, where
 * a typo is too likely to be another word — and a word that already matches
 * (in any case) stays.
 *
 * @param {string} text
 * @param {string[]} names - the brand's competitor names
 */
export function fixCompetitorNames(text, names = []) {
  const targets = names
    .map((n) => String(n ?? '').trim())
    .filter((n) => n.replace(/\s/g, '').length >= 5)
    .map((name) => ({ name, lower: name.toLowerCase(), words: name.split(/\s+/).length }));
  if (!text || targets.length === 0) return text;

  const words = [...text.matchAll(WORD)].map((m) => ({
    start: m.index,
    end: m.index + m[0].length,
    text: m[0].replace(/[.'’-]+$/, ''),
  }));
  const edits = [];
  for (let i = 0; i < words.length; i++) {
    for (const t of targets) {
      const span = words.slice(i, i + t.words);
      if (span.length < t.words) continue;
      const candidate = span.map((w) => w.text).join(' ');
      // Names are written as names: a lowercase word ("writes") is never
      // taken for a competitor ("Writer").
      if (candidate[0] !== candidate[0].toUpperCase()) continue;
      const lower = candidate.toLowerCase();
      if (lower === t.lower) continue;
      if (distance(lower, t.lower, allowedTypos(t.lower)) <= allowedTypos(t.lower)) {
        edits.push({ start: span[0].start, end: span[0].start + candidate.length, name: t.name });
        break;
      }
    }
  }
  let out = text;
  for (const e of edits.reverse()) out = out.slice(0, e.start) + e.name + out.slice(e.end);
  return out;
}

/** Both cleanups, references first. */
export function cleanOpportunityText(text, { competitors = [], ...refs } = {}) {
  if (!text) return text;
  return fixCompetitorNames(resolveReferences(text, refs), competitors);
}

/**
 * A stored opportunity row with readable title, description and asset titles,
 * and its titles and question (source_data.promptText) in this year.
 * The lists an index pointed into weren't stored — [P2] numbered the run's
 * candidate pages, not the target pages kept — so nothing is matched by
 * position: a page reads "the page", and a prompt index the prompt a
 * single-prompt opportunity was written for (or "this prompt"). Only certain
 * leaks are touched; a bare "[3]" may be ordinary writing. The stored row is
 * not changed.
 */
export function cleanStoredOpportunity(row, competitors = []) {
  if (!row) return row;
  const sd = row.source_data || {};
  const ctx = {
    competitors,
    prompt: row.cluster_id ? null : sd.promptText || null,
  };
  const clean = (t) => cleanOpportunityText(t, ctx);
  const titled = (t) => refreshYears(clean(t));
  const question = refreshYears(sd.promptText);
  const changed = Array.isArray(sd.assets) || question !== sd.promptText;
  return {
    ...row,
    title: titled(row.title),
    description: clean(row.description),
    source_data: changed
      ? {
          ...sd,
          ...(question !== sd.promptText ? { promptText: question } : {}),
          ...(Array.isArray(sd.assets)
            ? { assets: sd.assets.map((a) => ({ ...a, title: titled(a.title) })) }
            : {}),
        }
      : row.source_data,
  };
}
