/**
 * "Suggest content" for one page of the AI Traffic page's Pages section
 * (AT-006 part B3, spec §3.5: "Suggest content (Content, counts against the
 * quota, CONTENT-001)").
 *
 * The generator writes an opportunity per prompt cluster, from the answers to
 * its prompts, so a page's content suggestion has to come from the clusters
 * that are about the page: the ones holding prompts that target it
 * (prompt_target_urls), or, without any, the ones whose need shares the most
 * words with what the page says. With neither there is nothing to write from
 * yet, and the caller is told so rather than handed content about something
 * else. The page itself goes first among the cluster's candidate pages, so the
 * model can decide to optimize, expand or refresh it.
 */

import supabaseAdmin from '../config/supabase.js';
import { selectInChunks } from './chunkedIn.js';
import { tokens } from './pageMatching.js';

/** Clusters a page's content may come from when no prompt targets the page. */
export const MAX_MATCHED_CLUSTERS = 5;

/** A page path as 00178 keys it: lowercased, without a trailing slash. */
export function pagePathKey(path) {
  const trimmed = String(path ?? '')
    .trim()
    .replace(/\/+$/, '');
  return (trimmed || '/').toLowerCase();
}

/** The path a stored URL names, keyed like a page path; null for something that isn't a URL. */
function urlPathKey(url) {
  try {
    return pagePathKey(new URL(url).pathname);
  } catch {
    return null;
  }
}

const slugText = (url) => {
  try {
    return new URL(url).pathname.replace(/[-_/]+/g, ' ');
  } catch {
    return '';
  }
};

/**
 * The clusters a page's content suggestion comes from, best first: those
 * holding prompts that target the page, most of them first; else those whose
 * need shares at least two words with the page, twice as much for words in
 * its title, first heading or URL, up to MAX_MATCHED_CLUSTERS.
 *
 * @param {Array<{ id: string, label?: string, primary_intent?: string,
 *   prompt_ids: string[], promptTexts?: string[] }>} clusters
 * @param {{ url: string, title?: string|null, h1?: string|null, description?: string|null }} page
 * @param {string[]} targetedPromptIds
 * @returns {string[]}
 */
export function focusClusters(clusters, page, targetedPromptIds) {
  const targeted = new Set(targetedPromptIds);
  const byTargets = clusters
    .map((c) => ({ id: c.id, hits: c.prompt_ids.filter((id) => targeted.has(id)).length }))
    .filter((c) => c.hits > 0)
    .sort((a, b) => b.hits - a.hits);
  if (byTargets.length) return byTargets.map((c) => c.id);

  const strong = new Set(tokens(`${page.title || ''} ${page.h1 || ''} ${slugText(page.url)}`));
  const weak = new Set(tokens(page.description));
  return clusters
    .map((c) => {
      let score = 0;
      let shared = 0;
      const need = new Set(
        tokens([c.label, c.primary_intent, ...(c.promptTexts || [])].filter(Boolean).join(' ')),
      );
      for (const t of need) {
        const weight = strong.has(t) ? 2 : weak.has(t) ? 1 : 0;
        if (!weight) continue;
        shared += 1;
        score += weight;
      }
      return { id: c.id, score, shared };
    })
    .filter((c) => c.shared >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_MATCHED_CLUSTERS)
    .map((c) => c.id);
}

/**
 * Which of a page's clusters decides its suggestion: the best-matching one
 * that has either an open opportunity or answers to write from. An open
 * opportunity is pointed at rather than written again, so asking twice
 * spends nothing; clusters with neither are passed over.
 *
 * @param {string[]} focusIds - the page's clusters, best first
 * @param {{ openIds: Set<string>, covered: Set<string> }} state - clusters
 *   that can be written (answers, no open opportunity) and clusters an open
 *   opportunity covers
 * @returns {{ existing: string } | { write: string } | null}
 */
export function pickPageCluster(focusIds, { openIds, covered }) {
  for (const id of focusIds) {
    if (covered.has(id)) return { existing: id };
    if (openIds.has(id)) return { write: id };
  }
  return null;
}

/** What the model is told when the user asked for content for one page. */
export function pageFocusInstruction(page) {
  const name = page.title || page.h1 ? ` ("${page.title || page.h1}")` : '';
  return `The user asked for content for one page of the brand's site: ${page.url}${name}. It is listed first under the cluster as [P0], and AI assistants send it no visitors. Shape the opportunity around that page: optimize, expand or refresh it for this need wherever it fits, and create a new page only if it plainly cannot answer the need.`;
}

/**
 * The page as the brand's sitemap crawl knows it, else its URL on the
 * primary domain, and the brand's prompts (among `memberIds`) that target it.
 *
 * @param {string} brandId
 * @param {string} pagePath
 * @param {string[]} memberIds - the brand's clustered prompts
 */
export async function loadPageFocus(brandId, pagePath, memberIds) {
  const key = pagePathKey(pagePath);
  const [pagesRes, domainsRes, targets] = await Promise.all([
    supabaseAdmin
      .from('site_pages')
      .select('url, title, h1, description, lastmod, ai_citations, ga_sessions')
      .eq('brand_id', brandId),
    supabaseAdmin
      .from('brand_domains')
      .select('domain')
      .eq('brand_id', brandId)
      .order('is_primary', { ascending: false })
      .limit(1),
    selectInChunks(memberIds, (chunk) =>
      supabaseAdmin.from('prompt_target_urls').select('prompt_id, url').in('prompt_id', chunk),
    ),
  ]);
  if (pagesRes.error) throw new Error(pagesRes.error.message);
  if (targets.error) throw new Error(targets.error.message);

  const known = (pagesRes.data || []).find((p) => urlPathKey(p.url) === key);
  const host = String(domainsRes.data?.[0]?.domain ?? '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '');
  const page = known ?? {
    url: host ? `https://${host}${pagePath}` : pagePath,
    title: null,
    h1: null,
    description: null,
    lastmod: null,
    ai_citations: 0,
    ga_sessions: 0,
  };
  const targetedPromptIds = [
    ...new Set(
      (targets.data || []).filter((t) => urlPathKey(t.url) === key).map((t) => t.prompt_id),
    ),
  ];
  return { page, targetedPromptIds };
}
