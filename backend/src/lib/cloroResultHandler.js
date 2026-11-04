/**
 * Centralized handler for a Cloro scraper result.
 *
 * Used by both:
 *  - The polling fallback path in trackingWorker.js
 *  - The /cloro/callback webhook endpoint
 *
 * Given a parsed Cloro AI response and the prompt/brand context, this:
 *   1. Counts brand mentions in the response text
 *   2. Runs sentiment analysis (only if brand was mentioned)
 *   3. Computes visibility metrics + competitor mentions via parseResponse
 *   4. Inserts a `prompt_results` row
 *   5. Normalizes any captured shopping_cards, then ChatGPT's inline products,
 *      into prompt_result_shopping_cards
 */

import supabaseAdmin from '../config/supabase.js';
import { analyzeSentimentAI } from './aiTracker.js';
import { parseResponse, countBrandMentions } from './responseParser.js';
import {
  normalizeShoppingCards,
  normalizeInlineProducts,
  matchCardBrand,
} from './shoppingCards.js';
import { updateTargetUrlStats } from './targetUrlStats.js';
import { persistCitationRows } from './citationRows.js';
import { logger } from './logger.js';
import { classifyMerchant } from './merchantDetection.js';
import { catalogIndexFor, matchCard } from './catalog/cardMatch.js';

/**
 * @param {object} args
 * @param {{ text: string, citations: Array, model: string, shopping_cards: Array, search_queries?: Array }} args.aiResponse
 *   Already parsed via parseScraperResponse (cloroScraper.js)
 * @param {string} args.scraperId           Cloro scraper id (e.g. 'chatgpt-web')
 * @param {string} args.promptId
 * @param {string} args.brandId
 * @param {string|null} args.region
 * @param {{ brandName: string, domains: string[] }} args.brandInfo
 * @param {Array<{ id: string, name: string, domain: string }>} args.competitors
 * @returns {Promise<{ inserted: boolean }>}
 */
export async function handleScraperResult({
  aiResponse,
  scraperId,
  promptId,
  brandId,
  region,
  brandInfo,
  competitors,
}) {
  const mentionCount = countBrandMentions(aiResponse.text, brandInfo);
  const sentimentResult =
    mentionCount > 0
      ? await analyzeSentimentAI(aiResponse.text, brandInfo.brandName, brandInfo.domains)
      : { sentiment: 'neutral', confidence: 0, reason: 'Brand not mentioned' };

  const metrics = parseResponse(aiResponse, brandInfo, sentimentResult.sentiment, competitors);

  const { data: inserted, error } = await supabaseAdmin
    .from('prompt_results')
    .insert(resultRow({ aiResponse, scraperId, promptId, brandId, region, metrics }))
    .select('id, created_at')
    .single();

  if (error) {
    logger.error({ err: error }, '[cloro-result] failed to insert result');
    throw error;
  }

  // Best-effort: mark target URLs cited by this answer (00032).
  await updateTargetUrlStats(promptId, aiResponse.citations, new Date().toISOString());

  // Expand the citation array into rows (#732). Best-effort for the same
  // reason as the line above: the answer is already stored, and the jsonb
  // column still holds this data, so a failure here costs a backfill and
  // nothing else.
  await persistCitationRows({
    promptResultId: inserted.id,
    brandId,
    createdAt: inserted.created_at,
    citations: aiResponse.citations,
  });

  // Best-effort normalization of any shopping cards on this result.
  // Failures here must not abort the result insert — the raw cards are
  // already persisted on prompt_results.shopping_cards and the backfill
  // script can re-derive the normalized rows later.
  await persistShoppingCards({
    promptResultId: inserted.id,
    brandId,
    platform: scraperId,
    region,
    rawCards: aiResponse.shopping_cards ?? [],
    rawInlineProducts: aiResponse.inline_products ?? [],
    brandInfo: { brandId, brandName: brandInfo.brandName, domains: brandInfo.domains },
    competitors,
  });

  return { inserted: true };
}

/**
 * The prompt_results row for one answer, from the parsed answer and its
 * metrics (parseResponse). Pure, so the demo brand's sample answers
 * (lib/demo) are stored in exactly the shape tracking stores.
 *
 * @param {object} args
 * @param {{ text: string, citations: Array, model: string, shopping_cards?: Array, inline_products?: Array, search_queries?: Array }} args.aiResponse
 * @param {string} args.scraperId
 * @param {string} args.promptId
 * @param {string} args.brandId
 * @param {string|null} args.region
 * @param {ReturnType<typeof parseResponse>} args.metrics
 */
export function resultRow({ aiResponse, scraperId, promptId, brandId, region, metrics }) {
  return {
    prompt_id: promptId,
    brand_id: brandId,
    platform: scraperId,
    response: aiResponse.text,
    citations: aiResponse.citations,
    mention_count: metrics.mentionCount,
    citation_count: metrics.citationCount,
    sentiment: metrics.sentiment,
    visibility_score: metrics.visibilityScore,
    model_used: aiResponse.model,
    region: region ?? null,
    competitor_mentions: metrics.competitorMentions,
    mention_position: metrics.mentionPosition,
    mentioned_entity_count: metrics.mentionedEntityCount,
    shopping_cards: aiResponse.shopping_cards ?? [],
    inline_products: aiResponse.inline_products ?? [],
    search_queries: Array.isArray(aiResponse.search_queries) ? aiResponse.search_queries : [],
  };
}

/**
 * The prompt_result_shopping_cards rows for one answer's cards, then
 * ChatGPT's inline products: normalized, matched to the brand or a
 * competitor, their merchant classified. Pure, for the same reason as
 * resultRow.
 *
 * @param {object} args
 * @param {string} args.promptResultId
 * @param {string} args.brandId
 * @param {string} args.platform
 * @param {string|null} args.region
 * @param {unknown[]} args.rawCards
 * @param {unknown[]} [args.rawInlineProducts]
 * @param {{ brandId: string, brandName: string, domains: string[] }} args.brandInfo
 * @param {Array<{ id: string, name: string, domain: string|null }>} args.competitors
 * @returns {object[]}
 */
export function shoppingCardRows({
  promptResultId,
  brandId,
  platform,
  region,
  rawCards,
  rawInlineProducts = [],
  brandInfo,
  competitors,
}) {
  const cards = normalizeShoppingCards(platform, rawCards);
  const lastPosition = cards.reduce((max, card) => Math.max(max, card.position ?? 0), 0);
  const normalized = [
    ...cards,
    ...normalizeInlineProducts(platform, rawInlineProducts, lastPosition),
  ];

  return normalized.map((card) => {
    const match = matchCardBrand(card, brandInfo, competitors);
    const destination = card.merchant_url
      ? classifyMerchant(card.merchant_url, { brandDomains: brandInfo.domains })
      : null;
    return {
      prompt_result_id: promptResultId,
      brand_id: brandId,
      position: card.position,
      product_title: card.product_title,
      product_brand: card.product_brand,
      price_amount: card.price_amount,
      price_currency: card.price_currency,
      image_url: card.image_url,
      merchant_url: card.merchant_url,
      merchant_domain: card.merchant_domain,
      merchant_kind: destination?.kind ?? null,
      marketplace: destination?.marketplace ?? null,
      listing_id: destination?.listingId ?? null,
      rating: card.rating,
      review_count: card.review_count,
      raw: card.raw,
      matched_brand_id: match.matched_brand_id,
      matched_brand_role: match.matched_brand_role,
      platform,
      region: region ?? null,
    };
  });
}

/**
 * Normalize and insert shopping cards into the analytical table.
 *
 * Exported so the backfill script can reuse the exact same code path
 * against historical prompt_results rows without duplicating the parse +
 * brand-match logic.
 *
 * @param {object} args
 * @param {string} args.promptResultId
 * @param {string} args.brandId
 * @param {string} args.platform
 * @param {string|null} args.region
 * @param {unknown[]} args.rawCards
 * @param {unknown[]} [args.rawInlineProducts] ChatGPT's in-answer products, stored after the cards
 * @param {{ brandId: string, brandName: string, domains: string[] }} args.brandInfo
 * @param {Array<{ id: string, name: string, domain: string|null }>} args.competitors
 * @returns {Promise<number>} number of rows inserted (0 if none / on failure)
 */
export async function persistShoppingCards({
  promptResultId,
  brandId,
  platform,
  region,
  rawCards,
  rawInlineProducts = [],
  brandInfo,
  competitors,
}) {
  const rows = shoppingCardRows({
    promptResultId,
    brandId,
    platform,
    region,
    rawCards,
    rawInlineProducts,
    brandInfo,
    competitors,
  });
  if (rows.length === 0) return 0;

  // The brand's own cards, matched to its catalog's products (00360): what
  // Product Visibility counts on the shelf. The catalog may be unreadable;
  // the cards are written all the same, and the next sweep matches them.
  const own = rows.filter((row) => row.matched_brand_role === 'own');
  if (own.length) {
    const index = await catalogIndexFor(brandId, { brandName: brandInfo.brandName }).catch(
      (err) => {
        logger.warn({ err: err?.message, brandId }, '[cloro-result] catalog unreadable for cards');
        return null;
      },
    );
    for (const row of index ? own : []) {
      const found = matchCard(row, index);
      if (found) {
        row.catalog_product_id = found.productId;
        row.catalog_match = found.match;
      }
    }
  }

  // `onConflict: 'prompt_result_id,position' ignoreDuplicates: true` keeps
  // the call idempotent — re-running the backfill or a retry on the same
  // prompt_result won't duplicate or error.
  const write = (values) =>
    supabaseAdmin
      .from('prompt_result_shopping_cards')
      .upsert(values, { onConflict: 'prompt_result_id,position', ignoreDuplicates: true });
  let { error } = await write(rows);
  // An API deployed before its migration (00360): the cards go in without
  // their matches rather than not at all.
  if (error && /catalog_(product_id|match)/.test(error.message ?? '')) {
    ({ error } = await write(
      rows.map(({ catalog_product_id: _p, catalog_match: _m, ...row }) => row),
    ));
  }

  if (error) {
    logger.error(
      { err: error, promptResultId, platform, cardCount: rows.length },
      '[cloro-result] shopping card normalization failed',
    );
    return 0;
  }

  return rows.length;
}
