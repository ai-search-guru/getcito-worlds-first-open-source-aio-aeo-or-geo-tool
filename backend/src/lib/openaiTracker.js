/**
 * OpenAI Responses API client with web_search tool for prompt tracking.
 * Sends prompts to OpenAI and returns the response with citations, and the
 * searches the model ran (its query fan-out, #332), read from the same
 * response: no other call.
 */

import OpenAI from 'openai';
import { logger } from './logger.js';
import { userLocationFor } from './locations.js';

const DEFAULT_MODEL = 'gpt-5-chat-latest';

let client = null;

function getClient() {
  if (!client) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is not configured');
    }
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return client;
}

/** The platform API-model answers are stored under (the tracking worker's resolveModelPlatform). */
const SOURCE_PLATFORM = 'chatgpt';

/**
 * The searches a response's web_search calls ran, as the query fan-out is
 * kept (#332, as Cloro's engines give it): `[{ query, source_platform }]`,
 * each once, trimmed. A search action lists them in `queries`; the single
 * `query` it carried before is deprecated, and still read while responses
 * may hold it. Opening or searching within a page is no search, and a call
 * whose `status` is `failed` ran none.
 *
 * @param {Array<{ type?: string, status?: string, action?: { type?: string, queries?: unknown, query?: unknown } }>} output
 */
export function searchQueriesOf(output) {
  const seen = new Set();
  const queries = [];
  for (const item of output || []) {
    if (item?.type !== 'web_search_call' || item.action?.type !== 'search') continue;
    if (item.status === 'failed') continue;
    const asked = [
      ...(Array.isArray(item.action.queries) ? item.action.queries : []),
      item.action.query,
    ];
    for (const value of asked) {
      const query = typeof value === 'string' ? value.trim() : '';
      if (!query || seen.has(query)) continue;
      seen.add(query);
      queries.push({ query, source_platform: SOURCE_PLATFORM });
    }
  }
  return queries;
}

/**
 * Run a single prompt through OpenAI Responses API with web_search enabled.
 * @param {string} promptText - The prompt to send
 * @param {string} [model] - OpenAI model name (defaults to gpt-5-chat-latest)
 * @param {string} [region] - Location code for web_search user_location: an
 *   ISO country (`DE`) or a US state (`US-CA`, #691). Country-only codes
 *   produce exactly the payload they did before states existed.
 * @returns {Promise<{ text: string, citations: Array<{ url: string, title: string, startIndex: number, endIndex: number }>, model: string, search_queries: Array<{ query: string, source_platform: string }> }>}
 */
export async function runPrompt(promptText, model, region) {
  const openai = getClient();
  const modelName = model || DEFAULT_MODEL;

  const webSearchTool = { type: 'web_search' };
  const userLocation = userLocationFor(region);
  if (userLocation) {
    webSearchTool.user_location = userLocation;
  }

  const response = await openai.responses.create({
    model: modelName,
    tools: [webSearchTool],
    input: promptText,
  });

  const text = response.output_text || '';

  const citations = [];
  for (const item of response.output || []) {
    if (item.type === 'message' && item.content) {
      for (const block of item.content) {
        if (block.type === 'output_text' && block.annotations) {
          for (const ann of block.annotations) {
            if (ann.type === 'url_citation') {
              citations.push({
                url: ann.url,
                title: ann.title || '',
                startIndex: ann.start_index,
                endIndex: ann.end_index,
              });
            }
          }
        }
      }
    }
  }

  return { text, citations, model: modelName, search_queries: searchQueriesOf(response.output) };
}

const SENTIMENT_MODEL = 'gpt-5-mini';

/**
 * Analyze sentiment of an AI response toward a specific brand using gpt-5-mini.
 * Returns structured sentiment with confidence and reasoning.
 * @param {string} responseText - The AI-generated response text
 * @param {string} brandName - The brand name to analyze sentiment for
 * @returns {Promise<{ sentiment: 'positive'|'neutral'|'negative', confidence: number, reason: string }>}
 */
export async function analyzeSentimentAI(responseText, brandName) {
  const openai = getClient();

  try {
    const response = await openai.responses.create({
      model: SENTIMENT_MODEL,
      input: [
        {
          role: 'system',
          content: `You are a brand sentiment analyzer. Given an AI-generated response and a brand name, determine the sentiment toward that brand. Respond ONLY with valid JSON in this exact format: {"sentiment":"positive"|"neutral"|"negative","confidence":0.0-1.0,"reason":"one sentence explanation"}`,
        },
        {
          role: 'user',
          content: `Brand: "${brandName}"\n\nAI Response:\n${responseText.slice(0, 3000)}`,
        },
      ],
    });

    const raw = (response.output_text || '').trim();
    const json = JSON.parse(raw);

    const sentiment = ['positive', 'neutral', 'negative'].includes(json.sentiment)
      ? json.sentiment
      : 'neutral';
    const confidence =
      typeof json.confidence === 'number' ? Math.max(0, Math.min(1, json.confidence)) : 0.5;

    return { sentiment, confidence, reason: json.reason || '' };
  } catch (err) {
    logger.error({ err }, '[sentiment-ai] failed, falling back to neutral');
    return { sentiment: 'neutral', confidence: 0, reason: 'Analysis failed' };
  }
}
