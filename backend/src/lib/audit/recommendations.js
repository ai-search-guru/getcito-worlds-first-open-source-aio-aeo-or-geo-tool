/**
 * AI fix recommendations (Faz 3). After an audit scores the page, we send the
 * failing/warning signals that an LLM can genuinely help with to one batched
 * call and get back prioritized, page-specific recommendations — including
 * ready-to-paste drafts (a meta description, an H1, a BLUF paragraph, FAQ
 * Q&A + JSON-LD, suggested citations, etc.).
 *
 * Mechanical/config signals (add a video, enable HTTPS, fix viewport,
 * alt-text…) are excluded — their generic howToFix is already actionable and
 * the LLM can't add page-specific value.
 *
 * Before saving, recommendationGuard.js takes out a figure or a date the
 * page and brand data don't contain, with its sentence, swaps a name or a
 * price only the brand knows for a [placeholder] it fills, and holds the
 * copy to 150 characters per sentence (one rewrite, then a cut at a word
 * boundary).
 */

import { generateObject } from 'ai';
import { z } from 'zod';
import { resolveModel } from '../aiProvider.js';
import { signalsByKey } from './rubric.js';
import { readingFinding } from './signals/readability.js';
import { withRetry } from '../retry.js';
import { logger } from '../logger.js';
import { onBrandDomain } from './host.js';
import { brandRulesSection } from '../brandRules.js';
import {
  MAX_COPY_CHARS,
  MAX_INPUT_PLACEHOLDERS,
  buildKnownFacts,
  cutToLength,
  guardFacts,
  needsShortening,
  tooLongParts,
} from './recommendationGuard.js';

const DEFAULT_MODEL = 'google/gemini-3-flash-preview';

// Signals where a tailored recommendation / drafted content is worthwhile.
export const RECOMMENDABLE_SIGNALS = new Set([
  // structure (draftable)
  'h1-quality',
  'h2-coverage',
  'faq-schema',
  'json-ld-relevance',
  'open-graph',
  'meta-description',
  // authority
  'outbound-authority-links',
  'citation-density',
  'statistic-density',
  'quotations',
  'author-byline',
  // content
  'direct-answer',
  'bluf-answer',
  'query-coverage',
  'sub-query-coverage',
  'entity-coverage',
  'info-density',
  'mega-page-coverage',
  'definitions',
  'technical-terms',
  'readability',
  'length',
  'product-description-opening',
  // e-e-a-t
  'first-person',
  'case-study-evidence',
  'author-credentials',
  'byline-depth',
  'press-mentions',
]);

const recommendationsSchema = z.object({
  recommendations: z.array(
    z.object({
      signalKey: z.string(),
      priority: z.enum(['high', 'medium', 'low']),
      recommendation: z.string().max(600),
      draft: z.string().max(2000).nullable(),
      code: z.string().max(4000).nullable(),
    }),
  ),
});

const rewriteSchema = z.object({
  recommendations: z.array(
    z.object({
      ref: z.string(),
      recommendation: z.string().max(600),
      draft: z.string().max(2000).nullable(),
    }),
  ),
});

const FACTS_RULE = `Facts: use only facts that appear in the PAGE TEXT or the BRAND DATA. Never invent customers, testimonials, case studies, statistics, percentages, prices, dates, awards or quotes. A fact anyone could look up that the page doesn't have (a statistic, a study, a date, a source's address) is never a placeholder: write the sentence without it, or name the kind of source in words ("Google's structured data documentation", "a recent industry survey"). Only a fact the brand alone knows may be a placeholder in square brackets, starting with "your": [your customer name], [your price], [your result]. At most ${MAX_INPUT_PLACEHOLDERS} in a recommendation.`;

const LENGTH_RULE = `Length: "recommendation" is one imperative sentence of at most ${MAX_COPY_CHARS} characters, specific to this page. Every sentence in "draft" is at most ${MAX_COPY_CHARS} characters.`;

const SYSTEM_PROMPT = `You are an AEO/GEO content strategist. For each failing signal you are given, write ONE concrete recommendation tailored specifically to THIS page — never generic boilerplate, never restate the rule.

${FACTS_RULE}

${LENGTH_RULE}

When the fix is content the user can paste, put the ready-to-use text in "draft":
- meta-description → a 120–150 character description
- h1-quality → a single improved H1
- bluf-answer / direct-answer → an opening paragraph that leads with the answer
- faq-schema → 3–5 Q&A pairs in "draft" AND a valid FAQPage JSON-LD block in "code"
- definitions → the key terms defined inline
- outbound-authority-links / citation-density → specific authoritative sources to cite
- readability → a rewrite of one representative paragraph, in the page's language, toward the score the finding aims for (its formula is the language's: Flesch for English, Ateşman for Turkish…): shorter sentences and plainer words when the page's score is under it, fuller sentences with the detail readers expect when a Flesch score is over 70
- length → which specific sections to expand or trim (draft can be null)
- product-description-opening → a new opening for the product description, at most 40 words, that starts with the product type and names at least two key attributes from the page (a measure, a material, a fit or a use)

Put markup (JSON-LD, HTML) only in "code", never in "draft". Code has no length limit; a value only the brand knows is a placeholder there too, e.g. "price": "[your price]".

When suggesting sources to cite (outbound-authority-links, citation-density, statistic-density), prefer the most recent, currently-authoritative references and do not present older material as if it were current. Never invent URLs or fabricate statistics/dates — only suggest sources you are confident exist.

When BRAND RULES are given, every recommendation, draft and code follows them: a recommendation a rule forbids is left out, never written against it.

Set "draft" and "code" to null when they don't apply. Prioritize by impact. Only return items you can make genuinely specific and useful.`;

const REWRITE_PROMPT = `You shorten AEO/GEO recommendations that broke the length rule. Keep each item's meaning, its [placeholders] and its ref, add no new facts or placeholders, and return every item you are given.

${LENGTH_RULE}`;

/** The page's title, meta tags and JSON-LD: facts the body text leaves out. */
function pageExtras(ctx) {
  const $ = ctx.$;
  if (!$) return [];
  return [
    $('title').first().text(),
    $('meta[name="description"]').attr('content') ?? '',
    $('meta[property="og:title"]').attr('content') ?? '',
    $('meta[property="og:description"]').attr('content') ?? '',
    $('script[type="application/ld+json"]')
      .map((_, el) => $(el).text())
      .get()
      .join(' '),
  ];
}

/**
 * The brand data a recommendation may quote, when `url` is on one of the
 * brand's domains. Null for any other page, so an audit of a competitor's
 * page never borrows this brand's facts.
 */
export function brandFactsFor(url, brandRow, domainRows) {
  const domains = (domainRows ?? []).map((d) => d.domain).filter(Boolean);
  if (!onBrandDomain(url, domains)) return null;
  return { name: brandRow?.name ?? null, description: brandRow?.description ?? null, domains };
}

/**
 * The brand's rules (Settings › Content, 00450), on any page it audits: they
 * shape the recommendations, not the score.
 */
function rulesBlock(rules) {
  const section = brandRulesSection(rules, "BRAND RULES (the brand's own; follow every one):");
  return section ? `\n${section}\n` : '';
}

function brandBlock(brand) {
  if (!brand) return '';
  const lines = [
    brand.name && `- Name: ${brand.name}`,
    brand.description && `- Description: ${brand.description}`,
    brand.domains?.length && `- Domains: ${brand.domains.join(', ')}`,
  ].filter(Boolean);
  if (lines.length === 0) return '';
  return `\nBRAND DATA (the brand that owns this page; facts you may reuse):\n${lines.join('\n')}\n`;
}

/**
 * One rewrite of the items over the length limit, each sent with a `ref`.
 * Returns the rewritten items by ref; an empty map when the call fails.
 */
async function rewriteTooLong(model, items) {
  try {
    const { object } = await withRetry(
      () =>
        generateObject({
          model,
          schema: rewriteSchema,
          system: REWRITE_PROMPT,
          prompt: `Rewrite these so they follow the length rule:\n${JSON.stringify(
            items.map(({ ref, item }) => ({
              ref,
              recommendation: item.recommendation,
              draft: item.draft,
            })),
            null,
            2,
          )}`,
        }),
      { label: 'recommendations-rewrite' },
    );
    return new Map((object.recommendations || []).map((r) => [r.ref, r]));
  } catch (err) {
    logger.warn({ err }, '[audit] recommendation rewrite failed; cutting instead');
    return new Map();
  }
}

/**
 * @param {import('./context.js').AuditContext} ctx
 * @param {{ results: Array<{key:string,status:string,evidence:object}>, brand?: { name?: string|null, description?: string|null, domains?: string[] } | null, auditId?: string }} opts
 *   `brand` only when the page is on one of the brand's domains.
 * @returns {Promise<Array<{ signalKey: string, label: string, category: string|null, priority: string, recommendation: string, draft: string|null, code: string|null }>>}
 */
export async function generateRecommendations(
  ctx,
  { results, brand = null, rules = [], auditId } = {},
) {
  const failing = (results || []).filter(
    (r) => RECOMMENDABLE_SIGNALS.has(r.key) && (r.status === 'fail' || r.status === 'warn'),
  );
  if (failing.length === 0) return [];

  const modelString = process.env.AUDIT_LLM_MODEL || DEFAULT_MODEL;

  const issues = failing
    .map((r) => {
      const s = signalsByKey[r.key] ?? {};
      // Readability's score and its aim: which way to rewrite depends on its side of it.
      const reading = r.key === 'readability' ? readingFinding(r.evidence) : null;
      const finding = r.evidence?.reason
        ? ` | finding: ${r.evidence.reason}`
        : reading
          ? ` | finding: ${reading}`
          : '';
      return `- ${r.key} [${r.status}, impact: ${s.impactTier ?? 'standard'}]: ${s.what ?? ''}${finding}`;
    })
    .join('\n');

  const pageText = ctx.text.slice(0, 6000);

  // Anchor the model to the real current date — without it, the LLM defaults to
  // its training-data sense of "now" and suggests stale (e.g. 2024) sources for
  // outbound-authority-links / citation-density.
  const today = new Date(ctx.now ?? Date.now()).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  try {
    const model = resolveModel(modelString);
    const { object } = await withRetry(
      () =>
        generateObject({
          model,
          schema: recommendationsSchema,
          system: SYSTEM_PROMPT,
          prompt: `Today's date is ${today}.

PAGE URL: ${ctx.url}

Improve THIS page for its own topic/intent (infer it from the content below). Never introduce subject matter the page isn't already about.
${brandBlock(brand)}${rulesBlock(rules)}
FAILING SIGNALS TO FIX:
${issues}

PAGE TEXT (truncated):
"""
${pageText}
"""

Return prioritized, page-specific recommendations.`,
        }),
      { label: 'recommendations' },
    );

    // Today's date was given to the model, so a freshness date isn't invented.
    const month = new Date(ctx.now ?? Date.now()).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
    });
    const known = buildKnownFacts({
      pageText: ctx.text,
      extras: [...pageExtras(ctx), today, month],
      brand,
    });
    let facts = 0;
    const guard = (r) => {
      const out = guardFacts(r, known);
      facts += out.hits;
      return out.rec;
    };

    let items = (object.recommendations || [])
      .filter((r) => RECOMMENDABLE_SIGNALS.has(r.signalKey))
      .map((r) => guard({ ...r, draft: r.draft || null, code: r.code || null }));

    // Items are matched back by position: one signal can have several.
    const tooLong = items
      .map((item, i) => ({ ref: String(i), item }))
      .filter(({ item }) => needsShortening(item));
    let rewritten = 0;
    if (tooLong.length > 0) {
      const rewrites = await rewriteTooLong(model, tooLong);
      items = items.map((r, i) => {
        const next = rewrites.get(String(i));
        if (!next) return r;
        rewritten += 1;
        // Only the parts over the limit are replaced; a part that was fine,
        // or that the rewrite left empty, stays as it was.
        const long = tooLongParts(r);
        return guard({
          ...r,
          recommendation:
            long.recommendation && next.recommendation ? next.recommendation : r.recommendation,
          draft: long.draft && next.draft ? next.draft : r.draft,
        });
      });
    }

    let cuts = 0;
    items = items
      // An explanation the guard left nothing of says nothing to do.
      .filter((r) => r.recommendation)
      .map((r) => {
        const out = cutToLength(r);
        cuts += out.cuts;
        return out.rec;
      });

    if (facts + rewritten + cuts > 0) {
      logger.info(
        { auditId, url: ctx.url, facts, tooLong: tooLong.length, rewritten, cuts },
        '[audit] recommendation guard changed the model output',
      );
    }

    return items.map((r) => ({
      signalKey: r.signalKey,
      label: signalsByKey[r.signalKey]?.label ?? r.signalKey,
      category: signalsByKey[r.signalKey]?.category ?? null,
      priority: r.priority,
      recommendation: r.recommendation,
      draft: r.draft || null,
      code: r.code || null,
    }));
  } catch (err) {
    logger.error({ err, model: modelString }, '[audit] recommendations failed');
    return [];
  }
}
