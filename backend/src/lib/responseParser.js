/**
 * Parses an AI response to extract brand visibility metrics.
 * Mentions and citations are computed locally; sentiment comes from AI.
 */

import { stripEntityMarkup } from './entityMarkup.js';

/**
 * Strip markdown link URLs so only display text remains.
 * "[label](https://example.com/path)" → "label"
 * Also removes bare URLs (https://...) that aren't inside markdown links.
 */
function stripUrls(text) {
  let cleaned = text.replace(/\[([^\]]*)\]\([^)]+\)/g, '$1');
  cleaned = cleaned.replace(/https?:\/\/[^\s)>\]]+/g, '');
  return cleaned;
}

/**
 * The answer as its reader sees it, for matching names: ChatGPT's entity tags
 * replaced by the names they stand for (their other attributes would count as
 * mentions), URLs stripped.
 */
function matchableText(text) {
  return stripUrls(stripEntityMarkup(text));
}

const WORD_CHAR = /[\p{L}\p{N}_]/u;
// Scripts written without spaces between words (Chinese, Japanese, Thai…) and
// Korean, whose particles attach to the noun: a name there is always flanked
// by other letters, so a boundary check would never let it match.
const UNSPACED_SCRIPT =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;

/**
 * Case-insensitive regex matching a name as a whole word (#871).
 *
 * `\b` only knows ASCII word characters, so a name starting or ending with an
 * accented letter ("Ümit") or punctuation ("C++") never matched. The boundary
 * is now a Unicode letter/number lookaround, applied only on a side where the
 * name ends in a word character of a space-separated script.
 */
function nameRegex(term, flags) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const needsBoundary = (ch) => WORD_CHAR.test(ch) && !UNSPACED_SCRIPT.test(ch);
  const chars = [...term];
  const before = needsBoundary(chars[0]) ? '(?<![\\p{L}\\p{N}_])' : '';
  const after = needsBoundary(chars[chars.length - 1]) ? '(?![\\p{L}\\p{N}_])' : '';
  return new RegExp(`${before}${escaped}${after}`, `${flags}u`);
}

/**
 * Count case-insensitive occurrences of a term in text.
 */
function countOccurrences(text, term) {
  if (!term) return 0;
  return (text.match(nameRegex(term, 'gi')) || []).length;
}

/**
 * A short quote of the answer around the brand's first mention, for the
 * Action Center's mention evidence (AC-001): the same name and domain
 * matching as the mention count, on the answer stripped of links and
 * markdown marks, cut to about `radius` characters on each side. Null when
 * the answer does not name the brand.
 */
export function mentionExcerpt(text, brand, radius = 110) {
  // Markdown's marks only: headings, quotes and list bullets at the start of
  // a line, bold and code anywhere. A "#1" or "A > B" in a sentence stays.
  const clean = stripUrls(String(text ?? ''))
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '')
    .replace(/^[ \t]*>[ \t]?/gm, '')
    .replace(/^[ \t]*[*+-][ \t]+/gm, '')
    .replace(/\*\*|__|`/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  let at = -1;
  let length = 0;
  for (const term of [brand?.brandName, ...(brand?.domains ?? [])].filter(Boolean)) {
    const index = firstOccurrenceIndex(clean, term);
    if (index >= 0 && (at < 0 || index < at)) {
      at = index;
      length = term.length;
    }
  }
  if (at < 0) return null;
  // Cut on spaces, so the quote starts and ends on whole words.
  let start = Math.max(0, at - radius);
  if (start > 0) {
    const space = clean.indexOf(' ', start);
    start = space >= 0 && space < at ? space + 1 : start;
  }
  let end = Math.min(clean.length, at + length + radius);
  if (end < clean.length) {
    const space = clean.lastIndexOf(' ', end);
    end = space > at + length ? space : end;
  }
  return `${start > 0 ? '…' : ''}${clean.slice(start, end).trim()}${end < clean.length ? '…' : ''}`;
}

/**
 * Normalized hostname of a URL ("https://www.FOO.com/bar" → "foo.com").
 * Mirrors extractHostname in frontend/src/lib/citations/classify.ts — keep the two
 * in sync: citation_count must agree with the Citations page's read-time
 * classification, or the same metric shows different numbers per surface.
 */
export function extractHostname(rawUrl) {
  if (!rawUrl) return null;
  try {
    const url = new URL(String(rawUrl).trim());
    let host = url.hostname.toLowerCase();
    if (host.startsWith('www.')) host = host.slice(4);
    return host || null;
  } catch {
    const match = String(rawUrl).match(/^(?:https?:\/\/)?(?:www\.)?([^/\s?#]+)/i);
    return match ? match[1].toLowerCase() : null;
  }
}

/**
 * Whether a URL is on one of the brand's own domains: exact host or
 * subdomain match, same rule as the web classifier's 'you' category. The old
 * substring check (url.includes(domain)) also matched the brand's domain
 * inside another site's path or query string, and disagreed with the
 * Citations page over www/subdomain variants.
 */
export function ownDomainMatcher(brandDomains) {
  const normalized = (brandDomains || [])
    .map(
      (d) =>
        extractHostname(d) ??
        String(d ?? '')
          .trim()
          .toLowerCase(),
    )
    .filter(Boolean);
  return (url) => {
    const host = extractHostname(url || '');
    return Boolean(host) && normalized.some((d) => host === d || host.endsWith(`.${d}`));
  };
}

/** Count the citations that point at one of the brand's own domains. */
export function countOwnDomainCitations(citations, brandDomains) {
  const isOwn = ownDomainMatcher(brandDomains);
  let count = 0;
  for (const cite of citations || []) {
    if (isOwn(cite?.url)) count++;
  }
  return count;
}

/**
 * Count how many times the brand (name or any of its domains) is mentioned
 * in an AI response. URL-stripped to avoid double-counting citations.
 * Used to short-circuit sentiment analysis when the brand isn't mentioned.
 */
export function countBrandMentions(text, brand) {
  const cleanText = matchableText(text);
  let count = countOccurrences(cleanText, brand.brandName);
  for (const domain of brand.domains) {
    count += countOccurrences(cleanText, domain);
  }
  return count;
}

/**
 * Where the brand (name or any of its domains) appears in the text, as
 * [start, end) character ranges in order. Same matching as countBrandMentions,
 * but on the text as given, so the ranges index into it.
 */
export function brandMentionRanges(text, brand) {
  const ranges = [];
  for (const term of [brand.brandName, ...(brand.domains || [])]) {
    if (!term) continue;
    for (const match of text.matchAll(nameRegex(term, 'gi'))) {
      ranges.push([match.index, match.index + match[0].length]);
    }
  }
  return ranges.sort((a, b) => a[0] - b[0]);
}

/**
 * First word-boundary occurrence index of a term (case-insensitive), or -1.
 */
function firstOccurrenceIndex(text, term) {
  if (!term) return -1;
  const match = nameRegex(term, 'i').exec(text);
  return match ? match.index : -1;
}

/**
 * Where each tracked entity (the brand and its competitors) lands in the
 * answer's mention order. Deterministic: earliest word-boundary occurrence
 * of each entity's name/domain in the URL-stripped answer text; an entity's
 * rank is 1 + the number of other mentioned entities named before it.
 *
 * @returns {{
 *   mentionPosition: number | null,
 *   mentionedEntityCount: number,
 *   competitorPositions: Map<string, number>,
 * }}
 *   mentionPosition — 1-based rank of the brand's first mention (1 = named
 *   first), null when the brand isn't mentioned at all.
 *   mentionedEntityCount — how many of the tracked entities the answer
 *   mentions; 0 marks "computed, nothing found", while NULL in the database
 *   means "not computed yet" (backfill marker).
 *   competitorPositions — competitor id → 1-based rank, only for
 *   competitors the answer actually mentions.
 */
export function computeMentionPosition(text, brand, competitors = []) {
  const cleanText = matchableText(text);

  const entityFirstIndex = (names) => {
    let best = -1;
    for (const name of names) {
      const idx = firstOccurrenceIndex(cleanText, name);
      if (idx >= 0 && (best === -1 || idx < best)) best = idx;
    }
    return best;
  };

  const brandIndex = entityFirstIndex([brand.brandName, ...(brand.domains || [])]);
  const mentionedCompetitors = (competitors || [])
    .map((comp) => ({
      id: comp.id,
      index: entityFirstIndex([comp.name, ...(comp.domain ? [comp.domain] : [])]),
    }))
    .filter((comp) => comp.index >= 0);

  const allIndexes = [
    ...mentionedCompetitors.map((comp) => comp.index),
    ...(brandIndex >= 0 ? [brandIndex] : []),
  ];
  const rankOf = (index) => allIndexes.filter((other) => other < index).length + 1;

  return {
    mentionPosition: brandIndex >= 0 ? rankOf(brandIndex) : null,
    mentionedEntityCount: allIndexes.length,
    competitorPositions: new Map(mentionedCompetitors.map((comp) => [comp.id, rankOf(comp.index)])),
  };
}

/**
 * Parse the AI response and compute visibility metrics for a brand.
 * Sentiment must be provided externally (from AI analysis).
 * @param {{ text: string, citations: Array<{ url: string, title: string, startIndex: number, endIndex: number }> }} response
 * @param {{ brandName: string, domains: string[] }} brand
 * @param {'positive'|'neutral'|'negative'} sentiment - AI-analyzed sentiment
 * @param {Array<{ id: string, name: string, domain: string }>} [competitors] - Optional competitor list
 * @returns {{ mentionCount: number, citationCount: number, sentiment: string, visibilityScore: number, competitorMentions: Array, mentionPosition: number | null, mentionedEntityCount: number }}
 */
export function parseResponse(response, brand, sentiment = 'neutral', competitors = []) {
  const { text, citations } = response;
  const cleanText = matchableText(text);

  // --- Brand mention count (on URL-stripped text to avoid double-counting) ---
  let mentionCount = countOccurrences(cleanText, brand.brandName);
  for (const domain of brand.domains) {
    mentionCount += countOccurrences(cleanText, domain);
  }

  // --- Brand citation count (hostname-based, see countOwnDomainCitations) ---
  const citationCount = countOwnDomainCitations(citations, brand.domains);

  // --- Visibility Score (0-100) ---
  const visibilityScore = computeVisibilityScore({
    mentionCount,
    citationCount,
    totalCitations: citations.length,
    sentiment,
  });

  // --- Mention order among brand + competitors (position signal) ---
  const { mentionPosition, mentionedEntityCount, competitorPositions } = computeMentionPosition(
    text,
    brand,
    competitors,
  );

  // --- Competitor mentions (on URL-stripped text) ---
  const competitorMentions = competitors.map((comp) => {
    let compMentions = countOccurrences(cleanText, comp.name);
    if (comp.domain) {
      compMentions += countOccurrences(cleanText, comp.domain);
    }

    let compCitations = 0;
    if (comp.domain) {
      for (const cite of citations) {
        const url = (cite.url || '').toLowerCase();
        if (url.includes(comp.domain.toLowerCase())) {
          compCitations++;
        }
      }
    }

    const compScore = computeVisibilityScore({
      mentionCount: compMentions,
      citationCount: compCitations,
      totalCitations: citations.length,
      sentiment: 'neutral',
    });

    return {
      competitor_id: comp.id,
      name: comp.name,
      domain: comp.domain || '',
      mention_count: compMentions,
      citation_count: compCitations,
      visibility_score: compScore,
      mention_position: competitorPositions.get(comp.id) ?? null,
    };
  });

  return {
    mentionCount,
    citationCount,
    sentiment,
    visibilityScore,
    competitorMentions,
    mentionPosition,
    mentionedEntityCount,
  };
}

/**
 * Compute a 0-100 visibility score based on multiple signals.
 */
function computeVisibilityScore({ mentionCount, citationCount, totalCitations, sentiment }) {
  let score = 0;

  // Mention component (max 40 pts): each mention = 10pts, capped at 4+
  score += Math.min(mentionCount * 10, 40);

  // Citation component (max 30 pts): each citation = 15pts, capped at 2+
  score += Math.min(citationCount * 15, 30);

  // Citation ratio bonus (max 15 pts): brand citations / total citations
  if (totalCitations > 0) {
    score += Math.round((citationCount / totalCitations) * 15);
  }

  // Sentiment bonus (max 15 pts)
  if (sentiment === 'positive') score += 15;
  else if (sentiment === 'neutral' && mentionCount > 0) score += 7;

  return Math.min(score, 100);
}
