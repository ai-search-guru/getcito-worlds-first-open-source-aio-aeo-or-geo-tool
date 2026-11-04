import { stripEntityMarkup } from '@/lib/entityMarkup';

/**
 * Finding a brand's or competitor's name in an AI answer the way tracking
 * counts it (backend/src/lib/responseParser.js — keep the two in sync): a
 * case-insensitive whole word, with a Unicode boundary only on a side where
 * the name ends in a letter or number of a space-separated script, in the
 * answer as its reader sees it (ChatGPT's entity tags read as their names,
 * links as their labels, bare URLs dropped).
 */

const WORD_CHAR = /[\p{L}\p{N}_]/u;
// Scripts written without spaces between words, and Korean, whose particles
// attach to the noun: a name there is always flanked by other letters.
const UNSPACED_SCRIPT =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;

function namePattern(term: string): string {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const needsBoundary = (ch: string) => WORD_CHAR.test(ch) && !UNSPACED_SCRIPT.test(ch);
  const chars = [...term];
  const before = needsBoundary(chars[0]) ? '(?<![\\p{L}\\p{N}_])' : '';
  const after = needsBoundary(chars[chars.length - 1]) ? '(?![\\p{L}\\p{N}_])' : '';
  return `${before}${escaped}${after}`;
}

/** One regex for several names, the longest first so "Acme Coffee" wins over "Acme". */
function namesRegex(terms: string[]): RegExp | null {
  const unique = [...new Set(terms.map((t) => t.trim()).filter(Boolean))].sort(
    (a, b) => b.length - a.length,
  );
  return unique.length > 0 ? new RegExp(unique.map(namePattern).join('|'), 'giu') : null;
}

/** Whether a text names one of the terms, as tracking finds a name. */
export function namesAny(text: string, terms: string[]): boolean {
  return namesRegex(terms)?.test(text) ?? false;
}

/** "[label](https://…)" → "label"; bare URLs dropped. */
function stripUrls(text: string): string {
  return text.replace(/\[([^\]]*)\]\([^)]+\)/g, '$1').replace(/https?:\/\/[^\s)>\]]+/g, '');
}

/**
 * The answer as plain prose for a quote: names matched as tracking does, and
 * markdown's own marks dropped (headings, quote and bullet marks at a line
 * start, bold, code), whitespace collapsed. "#1 pick" or "A > B" stay.
 */
export function answerProse(response: string): string {
  return stripUrls(stripEntityMarkup(response))
    .replace(/^[ \t]*(?:#{1,6}[ \t]+|>[ \t]?|[-*+][ \t]+)/gm, '')
    .replace(/\*\*|__|`/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** About this many characters of context each side of the name. */
const EXCERPT_RADIUS = 110;

/**
 * The passage around the brand's first mention in an answer (spec §7,
 * "Mention context"), cut on whole words with "…" where it was cut. Falls back
 * to the answer's opening when no name matches (a rename since the answer).
 */
export function mentionExcerpt(response: string, brandTerms: string[]): string {
  const prose = answerProse(response);
  const match = namesRegex(brandTerms)?.exec(prose);
  if (!match) return cut(prose, 0, EXCERPT_RADIUS * 2);
  return cut(prose, match.index - EXCERPT_RADIUS, match.index + match[0].length + EXCERPT_RADIUS);
}

function cut(text: string, from: number, to: number): string {
  let start = Math.max(0, from);
  let end = Math.min(text.length, to);
  // Move inward to the nearest space so no word is cut.
  if (start > 0) {
    const space = text.indexOf(' ', start);
    start = space === -1 || space >= end ? start : space + 1;
  }
  if (end < text.length) {
    const space = text.lastIndexOf(' ', end);
    end = space > start ? space : end;
  }
  const body = text.slice(start, end).trim();
  return `${start > 0 ? '…' : ''}${body}${end < text.length ? '…' : ''}`;
}

export type MentionKind = 'brand' | 'competitor';

export interface TextSegment {
  text: string;
  /** Set on a name: the brand's or a competitor's. */
  kind?: MentionKind;
}

/**
 * A text split around the names in it, for highlighting: the brand's names
 * and the competitors'. The longer name wins where two overlap, and a name
 * on both lists counts as the brand's.
 */
export function highlightSegments(
  text: string,
  names: { brand: string[]; competitors: string[] },
): TextSegment[] {
  const brand = new Set(names.brand.map((n) => n.trim().toLowerCase()).filter(Boolean));
  const regex = namesRegex([...names.brand, ...names.competitors]);
  if (!regex || !text) return text ? [{ text }] : [];
  const segments: TextSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(regex)) {
    const at = match.index ?? 0;
    if (at > last) segments.push({ text: text.slice(last, at) });
    segments.push({
      text: match[0],
      kind: brand.has(match[0].toLowerCase()) ? 'brand' : 'competitor',
    });
    last = at + match[0].length;
  }
  if (last < text.length) segments.push({ text: text.slice(last) });
  return segments;
}
