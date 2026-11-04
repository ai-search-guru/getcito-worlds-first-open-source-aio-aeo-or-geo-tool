/**
 * Prompts suggested for one page (AT-006 part B2, spec §3.5): "Add prompts
 * (suggested from GA4 landing page and GSC queries; uses slots, PROMPT-012)".
 *
 * A page AI sends visitors to without any tracked prompt citing it, or a
 * valuable page nothing points to, needs prompts whose best answer is that
 * page, so tracking shows whether AI answers cite it. This writes a handful,
 * from what the page says it is about (its sitemap entry, or the page read
 * once), its figures over the page's range, and the brand's Search Console
 * queries that share its words — Search Console keeps no queries per page.
 *
 * Nothing is stored: the person picks which to track, and those become
 * prompts pointing at the page.
 */

import { NoObjectGeneratedError, generateObject } from 'ai';
import { z } from 'zod';
import supabaseAdmin from '../config/supabase.js';
import { resolveModel } from './aiProvider.js';
import { getLanguageName } from './languages.js';
import { withRetry } from './retry.js';
import { isCoveredByPrompts, normalizeTokens } from './gscSuggestions.js';
import { readPage, summaryText, toAbsoluteUrl } from './gaSuggestions.js';
import { yearRule } from './currentYear.js';

/** Suggestions asked for; the schema floor keeps a short answer usable. */
export const PAGE_SUGGESTIONS = 5;
const MIN_PAGE_SUGGESTIONS = 3;
/** Search Console queries shown to the model, the page's best first. */
export const MAX_PAGE_QUERIES = 10;
/** Share of a query's words the page must use for the query to be its. */
const QUERY_OVERLAP = 0.5;
const GSC_WINDOW_DAYS = 28;
const GSC_MIN_IMPRESSIONS = 10;
const ATTEMPTS = 3;
/** Every page of the list, however long, to find this one. */
const LIST_LIMIT = 10_000;

const pageSuggestionSchema = z.object({
  suggestions: z
    .array(
      z.object({
        text: z
          .string()
          .min(20)
          .max(120)
          .describe('A short, generic question for an AI assistant, without any brand names'),
        topic: z
          .string()
          .min(3)
          .max(60)
          .describe(
            'A 2-4 word topic label that groups this prompt (e.g. "Pricing", "Gift Ideas")',
          ),
        reason: z
          .string()
          .min(20)
          .max(220)
          .describe('One sentence on why this page answers the prompt, and the demand behind it'),
        sourceQuery: z
          .string()
          .max(200)
          .optional()
          .describe(
            'ONLY when derived from one of the provided Search Console queries: the EXACT query, verbatim.',
          ),
      }),
    )
    .min(MIN_PAGE_SUGGESTIONS)
    .max(PAGE_SUGGESTIONS + 1),
});

/** A page path as 00178 keys it: lowercased, without a trailing slash. */
function pageKeyOf(path) {
  const trimmed = String(path ?? '')
    .trim()
    .replace(/\/+$/, '');
  return (trimmed || '/').toLowerCase();
}

/** The path of a stored URL, or null for something that isn't one. */
function pathOf(url) {
  try {
    return new URL(url).pathname;
  } catch {
    return null;
  }
}

/** The words a page is known by: its path and what it says it is about. */
export function pageWords(page, summary) {
  const slug = String(page ?? '').replace(/[/_-]+/g, ' ');
  return new Set(normalizeTokens(`${slug} ${summaryText(summary)}`));
}

/**
 * The brand's Search Console queries that are this page's: most of their
 * words are the page's, and no tracked prompt covers them already. Its
 * busiest first.
 */
export function matchPageQueries(rows, words, existingPromptTexts, max = MAX_PAGE_QUERIES) {
  return (rows ?? [])
    .map((r) => ({
      query: String(r.query ?? ''),
      impressions: Number(r.impressions) || 0,
      clicks: Number(r.clicks) || 0,
    }))
    .filter((r) => {
      const tokens = normalizeTokens(r.query);
      if (tokens.length === 0) return false;
      const hits = tokens.filter((t) => words.has(t)).length;
      return hits / tokens.length >= QUERY_OVERLAP;
    })
    .filter((r) => !isCoveredByPrompts(r.query, existingPromptTexts))
    .sort((a, b) => b.impressions - a.impressions || b.clicks - a.clicks)
    .slice(0, max);
}

/**
 * The suggestions as they go out: not a prompt the brand tracks already, one
 * of each, and a Search Console query only when it was one of those given.
 */
export function finishSuggestions(raw, { existingPromptTexts, queries }) {
  const tracked = new Set(existingPromptTexts.map((t) => t.trim().toLowerCase()));
  const byQuery = new Map(queries.map((q) => [q.query.trim().toLowerCase(), q]));
  const seen = new Set();
  const out = [];
  for (const s of raw) {
    const key = s.text.trim().toLowerCase();
    if (tracked.has(key) || seen.has(key)) continue;
    seen.add(key);
    const query = s.sourceQuery ? byQuery.get(s.sourceQuery.trim().toLowerCase()) : undefined;
    out.push({
      text: s.text.trim(),
      topic: s.topic.trim(),
      reason: s.reason.trim(),
      sourceQuery: query?.query ?? null,
      impressions: query?.impressions ?? null,
    });
  }
  return out.slice(0, PAGE_SUGGESTIONS);
}

/** The page's figures over the range, from the Pages section's own list (00178). */
async function pageFigures(brandId, page, from, to) {
  const { data, error } = await supabaseAdmin.rpc('ai_traffic_pages', {
    p_brand_id: brandId,
    p_from: from ?? null,
    p_to: to ?? null,
    p_tab: 'all',
    p_limit: LIST_LIMIT,
    p_offset: 0,
  });
  if (error) throw new Error(error.message);
  const key = pageKeyOf(page);
  const row = ((data ?? {}).rows ?? []).find((r) => pageKeyOf(r.page) === key);
  if (!row) return null;
  return {
    aiVisits: Number(row.ai_visits) || 0,
    citations: Number(row.citations) || 0,
    targetingPrompts: Number(row.targeting_prompts) || 0,
    sessions: Number(row.sessions) || 0,
    keyEvents: Number(row.key_events) || 0,
  };
}

/** What the page says it is about: its sitemap entry, else the page read once. */
async function pageSummary(brandId, page) {
  const key = pageKeyOf(page);
  const { data: rows, error } = await supabaseAdmin
    .from('site_pages')
    .select('url, title, description, h1')
    .eq('brand_id', brandId);
  if (error) throw new Error(error.message);
  const known = (rows ?? []).find((r) => {
    const path = pathOf(r.url);
    return path !== null && pageKeyOf(path) === key;
  });
  if (known && (known.title || known.h1 || known.description)) {
    return { title: known.title, description: known.description, h1: known.h1, headings: [] };
  }

  const { data: domains } = await supabaseAdmin
    .from('brand_domains')
    .select('domain')
    .eq('brand_id', brandId)
    .order('is_primary', { ascending: false })
    .limit(1);
  const url = toAbsoluteUrl(domains?.[0]?.domain, page);
  return url ? await readPage(url) : null;
}

/** The brand's Search Console queries over the last four weeks. */
async function searchConsoleRows(brandId) {
  const since = new Date(Date.now() - GSC_WINDOW_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const { data, error } = await supabaseAdmin.rpc('gsc_candidate_queries', {
    p_brand_id: brandId,
    p_since: since,
    p_min_impressions: GSC_MIN_IMPRESSIONS,
  });
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** The model's instructions and request, for one page. */
export function buildPagePrompt({ context, page, summary, figures, queries }) {
  const langName = getLanguageName(context.brand.language);
  const system = `You are an AEO (Answer Engine Optimization) strategist. You suggest NEW prompts people would ask an AI assistant (ChatGPT, Perplexity, Gemini, Claude) whose best answer is ONE page of a brand's site, so the brand can track whether AI answers cite that page.

RULES:
- Suggest ${PAGE_SUGGESTIONS} prompts that are NOT already tracked by this brand. No two may be rephrasings of the same question.
${yearRule()}
- Each prompt: 30-100 chars, generic, no brand names, written in ${langName}.
- Write at the level of the need the page serves, NOT the page's product name or URL.
- Group each prompt under a short topic label (2-4 words). Reuse existing topic labels when they fit.
- Reasons are one concrete sentence: what on the page answers the prompt, and the demand behind it.${
    queries.length
      ? `
- REAL SEARCH DEMAND: Google Search Console queries that share this page's words are provided. Derive suggestions from those that fit the page: rephrase the query as a natural question to an AI assistant, keeping its intent exactly. For each such suggestion set sourceQuery to the EXACT original query, verbatim. Never set sourceQuery otherwise.`
      : ''
  }`;

  const facts = figures
    ? `In the range shown: ${figures.sessions} sessions from every channel, ${figures.keyEvents} key events, ${figures.aiVisits} visits from AI assistants, cited ${figures.citations} times in tracked AI answers, ${figures.targetingPrompts} tracked prompts pointing to it.`
    : 'No traffic or citation figures for this page in the range shown.';

  const prompt = `Brand: ${context.brand.name}
Description: ${context.brand.description || '(none)'}

The page: ${page}
${summary ? `What the page says it is about: ${summaryText(summary).slice(0, 600)}` : 'The page could not be read; go by its path.'}
${facts}

Existing tracked prompts (DO NOT duplicate these):
${context.existingPromptTexts.length ? context.existingPromptTexts.map((p, i) => `${i + 1}. ${p}`).join('\n') : '(none yet)'}

Existing topics for this brand (prefer reusing):
${context.existingTopicNames.length ? context.existingTopicNames.join(', ') : '(none)'}${
    queries.length
      ? `

Google Search Console queries sharing this page's words (last 28 days, not tracked yet):
${queries.map((q) => `  • "${q.query}" — ${q.impressions} impressions, ${q.clicks} clicks`).join('\n')}`
      : ''
  }

Suggest ${PAGE_SUGGESTIONS} prompts this brand should track for this page, each with a topic and a reason.`;

  return { system, prompt };
}

/**
 * Suggests prompts for one page of the brand's site.
 *
 * @param {string} brandId - checked against the caller's org by the route
 * @param {{ page: string, from?: string, to?: string,
 *   context: { brand: object, existingPromptTexts: string[], existingTopicNames: string[] } }} opts
 * @returns {Promise<{ page: { path: string, title: string|null }, queries: number,
 *   suggestions: Array<{ text: string, topic: string, reason: string,
 *   sourceQuery: string|null, impressions: number|null }> }>}
 */
export async function suggestPromptsForPage(brandId, { page, from, to, context }) {
  const [figures, summary, gscRows] = await Promise.all([
    pageFigures(brandId, page, from, to),
    pageSummary(brandId, page),
    searchConsoleRows(brandId),
  ]);
  const queries = matchPageQueries(gscRows, pageWords(page, summary), context.existingPromptTexts);
  const { system, prompt } = buildPagePrompt({ context, page, summary, figures, queries });

  const modelId = process.env.PROMPT_SUGGESTION_MODEL || 'google/gemini-3-flash-preview';
  let object;
  try {
    ({ object } = await withRetry(
      () =>
        generateObject({
          model: resolveModel(modelId),
          schema: pageSuggestionSchema,
          system,
          prompt,
        }),
      { attempts: ATTEMPTS, baseDelayMs: 500, label: 'page-prompt-suggestions' },
    ));
  } catch (err) {
    // Every attempt missed the schema: nothing usable, said plainly.
    if (NoObjectGeneratedError.isInstance(err)) {
      const failure = new Error("Couldn't write suggestions for this page. Try again.");
      failure.status = 502;
      throw failure;
    }
    throw err;
  }

  return {
    page: { path: page, title: summary?.title ?? summary?.h1 ?? null },
    queries: queries.length,
    suggestions: finishSuggestions(object.suggestions, {
      existingPromptTexts: context.existingPromptTexts,
      queries,
    }),
  };
}
