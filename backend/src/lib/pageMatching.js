/**
 * Which of a brand's existing pages (lib/sitePages.js) might already cover a
 * cluster's need, and what to do about it (#857, Phase 2).
 *
 * Matching is lexical and cheap: it only narrows 500 pages down to a handful
 * of candidates. The model then reads those candidates next to the cluster
 * and makes the call — create, optimize, expand, refresh, consolidate or
 * defend — so a near-miss here costs nothing worse than a candidate it
 * ignores.
 */

import { SITE_PAGE_TYPES } from './contentPageTypes.js';

/** Candidate pages shown to the model per cluster. */
export const CANDIDATES_PER_CLUSTER = 8;

export const DECISIONS = ['create', 'optimize', 'expand', 'refresh', 'consolidate', 'defend'];

const STOPWORDS = new Set(
  (
    'the and for with what which who how why when where are was were can could should would ' +
    'does did best top your you our their this that these those from into about than then ' +
    'them they its has have had not but all any more most some such only also very just ' +
    'use using used get make way ways vs versus guide list 2024 2025 2026 2027'
  ).split(' '),
);

/** Lower-cased word tokens worth matching on: three letters or more, no filler words. */
export function tokens(text) {
  const out = [];
  for (const raw of String(text ?? '')
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu) || []) {
    if (raw.length < 3 || STOPWORDS.has(raw)) continue;
    // A plain plural matches its singular: "tools" and "tool".
    out.push(raw.length > 4 && raw.endsWith('s') && !raw.endsWith('ss') ? raw.slice(0, -1) : raw);
  }
  return out;
}

const slugText = (url) => {
  try {
    return new URL(url).pathname.replace(/[-_/]+/g, ' ');
  } catch {
    return '';
  }
};

/**
 * The pages most likely to cover a need, best first. A page scores the rarer
 * words it shares with the need, twice as much for words in its title, first
 * heading or URL as for words only in its description. At least two shared
 * words are required, so one common word cannot pull a page in.
 *
 * @param {string} needText - the cluster's label, need, prompts and searches
 * @param {{url: string, title?: string, h1?: string, description?: string}[]} pages
 */
export function candidatePages(needText, pages, limit = CANDIDATES_PER_CLUSTER) {
  const indexed = pages.map((p) => ({
    page: p,
    strong: new Set(tokens(`${p.title || ''} ${p.h1 || ''} ${slugText(p.url)}`)),
    weak: new Set(tokens(p.description)),
  }));
  const df = new Map();
  for (const { strong, weak } of indexed) {
    for (const t of new Set([...strong, ...weak])) df.set(t, (df.get(t) || 0) + 1);
  }

  const need = new Set(tokens(needText));
  const n = indexed.length;
  return indexed
    .map(({ page, strong, weak }) => {
      let score = 0;
      let shared = 0;
      for (const t of need) {
        const weight = strong.has(t) ? 2 : weak.has(t) ? 1 : 0;
        if (!weight) continue;
        shared += 1;
        score += weight * Math.log(1 + n / df.get(t));
      }
      return { page, score, shared };
    })
    .filter((c) => c.shared >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((c) => c.page);
}

/**
 * The model's decision, held to what it can stand on: every decision other
 * than create needs an existing page, and consolidate needs two. Pages are
 * resolved from the candidate indexes, out-of-range ones dropped.
 */
export function resolveDecision(decision, pageIndexes, candidates) {
  const pages = [...new Set(pageIndexes || [])]
    .filter((i) => Number.isInteger(i) && i >= 0 && i < candidates.length)
    .map((i) => candidates[i]);
  const valid = DECISIONS.includes(decision) ? decision : 'create';
  if (valid === 'create' || !pages.length) return { decision: 'create', pages: [] };
  if (valid === 'consolidate' && pages.length < 2) return { decision: 'optimize', pages };
  return { decision: valid, pages };
}

/** Assets that live on other sites, whatever the brand's kind of site. */
export const EARNED_ASSET_TYPES = ['third_party_article', 'backlink'];

/**
 * What an asset can be on this kind of site: a page type the Content Editor
 * offers it (contentPageTypes.js), or an earned asset.
 */
export function assetTypes(siteType) {
  return [...SITE_PAGE_TYPES[siteType], ...EARNED_ASSET_TYPES];
}

/** Supporting assets an opportunity may add to its primary one. */
export const MAX_SUPPORTING_ASSETS = 3;

const toPage = (p) => ({
  url: p.url,
  title: p.title || p.h1 || null,
  aiCitations: p.ai_citations,
  gaSessions: p.ga_sessions,
  lastmod: p.lastmod,
});

/**
 * An opportunity's assets, primary first, each with a stable key, its type,
 * channel, decision, title and the existing pages it works on. Earned assets
 * live off the brand's site, so they are always new and carry no page. A
 * supporting asset of a type outside `types`, or one repeating the primary's
 * type and decision, is dropped; so is anything past MAX_SUPPORTING_ASSETS.
 * A primary of such a type is a blog post, which every kind of site writes.
 *
 * @param {{type: string, channel: string, decision: string, title: string, pageIndexes: number[]}} primary
 * @param {typeof primary[]} supporting
 * @param {object[]} candidates - the cluster's candidate pages
 * @param {string[]} types - what an asset can be on the brand's site (assetTypes)
 */
export function buildAssets(primary, supporting, candidates, types) {
  const assets = [];
  const seen = new Set();
  for (const a of [primary, ...(supporting || []).slice(0, MAX_SUPPORTING_ASSETS)]) {
    if (!a || (assets.length && !types.includes(a.type))) continue;
    const channel = a.channel === 'earned' ? 'earned' : 'owned';
    const { decision, pages } =
      channel === 'earned'
        ? { decision: 'create', pages: [] }
        : resolveDecision(a.decision, a.pageIndexes, candidates);
    const type = types.includes(a.type) ? a.type : 'blog_post';
    const id = `${type}:${decision}:${pages.map((p) => p.url).join(',')}`;
    if (seen.has(id)) continue;
    seen.add(id);
    assets.push({
      key: `a${assets.length + 1}`,
      type,
      channel,
      decision,
      title: a.title,
      pages: pages.map(toPage),
    });
  }
  return assets;
}
