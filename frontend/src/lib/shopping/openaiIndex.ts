/**
 * "Catalog in OpenAI's product index" (#1281), US only.
 *
 * In the US, ChatGPT Shopping picks products from OpenAI's own product index,
 * built from direct brand feeds, from Shopify, or from copies made by reading
 * retailer sites. There's no public API for it, so the status is what we can
 * know:
 *   - `direct_feed`: the brand says it sends OpenAI a direct product feed
 *     (`brands.openai_product_feed`);
 *   - `found`: otherwise, its own products appear in tracked US ChatGPT
 *     Shopping cards. The source is unknown: likely a copy of its site;
 *   - `not_found`: neither.
 * A Shopify-connected store with its ChatGPT channel on reads "via Shopify"
 * once the Shopify integration (#1265) exists.
 */

export type OpenAiIndexStatus = 'direct_feed' | 'found' | 'not_found';

export interface OpenAiIndexRead {
  /** The brand says it sends OpenAI a direct product feed. */
  directFeed: boolean;
  /** Cards for the brand's own products in US ChatGPT Shopping answers, in the window. */
  ownCards: number;
}

export function openAiIndexStatus(read: OpenAiIndexRead): OpenAiIndexStatus {
  if (read.directFeed) return 'direct_feed';
  return read.ownCards > 0 ? 'found' : 'not_found';
}
