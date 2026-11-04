/**
 * Vercel AI SDK provider registry
 * Resolves "provider/model" strings to SDK-compatible model instances
 */

import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';

const providers = {};

/** @type {ReturnType<typeof createOpenAI> | null} */
let openaiProvider = null;

/** @type {ReturnType<typeof createGoogleGenerativeAI> | null} */
let googleProvider = null;

/**
 * OpenRouter's provider routing for every call made here: only providers
 * that don't keep or train on the request (`data_collection: "deny"`), as
 * Chat's and the Agent's calls in frontend/ do (W4-34).
 */
export const OPENROUTER_ROUTING = Object.freeze({ data_collection: 'deny' });

/**
 * A fetch that adds `routing` to each JSON request body it sends. The body's
 * own `provider` fields are kept; the routing's win where they meet. A body
 * that isn't JSON goes as it is.
 *
 * @param {Record<string, unknown>} routing
 * @param {typeof fetch} [own] - defaults to the global fetch at each call
 * @returns {typeof fetch}
 */
export function openRouterFetch(routing, own) {
  const base = (input, init) => (own ?? globalThis.fetch)(input, init);
  return (input, init) => {
    if (typeof init?.body !== 'string') return base(input, init);
    let body;
    try {
      body = JSON.parse(init.body);
    } catch {
      return base(input, init);
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return base(input, init);
    const kept = body.provider && typeof body.provider === 'object' ? body.provider : {};
    return base(input, {
      ...init,
      body: JSON.stringify({ ...body, provider: { ...kept, ...routing } }),
    });
  };
}

// Initialize providers based on available API keys
if (process.env.OPENAI_API_KEY) {
  openaiProvider = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
  providers.openai = openaiProvider;
}

if (process.env.ANTHROPIC_API_KEY) {
  providers.anthropic = createAnthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });
}

if (process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
  googleProvider = createGoogleGenerativeAI({
    apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
  });
  providers.google = googleProvider;
}

// OpenRouter exposes an OpenAI-compatible endpoint, so the OpenAI SDK talks to
// it unchanged. Model ids keep their upstream namespace after the provider
// prefix: "openrouter/anthropic/claude-haiku-4.5" resolves to the OpenRouter
// model "anthropic/claude-haiku-4.5" — resolveModel() splits on the first
// slash only, so nested ids survive.
//
// Analysis tasks only (suggestions, audit signals, sentiment). Prompt tracking
// stays on the first-party SDKs: it depends on provider-hosted web search
// (OpenAI `web_search`, Anthropic `web_search_20250305`), which OpenRouter does
// not relay.
if (process.env.OPENROUTER_API_KEY) {
  const openrouter = createOpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
    fetch: openRouterFetch(OPENROUTER_ROUTING),
  });

  // .chat() rather than the provider's default call: @ai-sdk/openai defaults to
  // OpenAI's Responses API, which OpenRouter does not implement — every request
  // would 404 on /responses. OpenRouter is Chat Completions compatible.
  providers.openrouter = (modelId, options) => openrouter.chat(modelId, options);
}

/**
 * Resolve a "provider/model" string into a Vercel AI SDK model instance
 * @param {string} modelString - e.g. "openai/gpt-4o-mini", "anthropic/claude-sonnet-4-20250514", "google/gemini-pro"
 * @returns AI SDK model instance
 */
export function resolveModel(modelString, options) {
  const defaultModel = process.env.DEFAULT_SUGGESTION_MODEL || 'openai/gpt-5-mini';
  const target = modelString || defaultModel;

  const [providerName, ...modelParts] = target.split('/');
  const modelId = modelParts.join('/');

  const provider = providers[providerName];
  if (!provider) {
    const available = Object.keys(providers);
    throw new Error(
      `Provider "${providerName}" is not configured. Available: ${available.join(', ') || 'none (add API keys to .env)'}`,
    );
  }

  return provider(modelId, options);
}

/**
 * List available providers (those with API keys configured)
 * @returns {string[]}
 */
export function getAvailableProviders() {
  return Object.keys(providers);
}

/**
 * Get the raw OpenAI provider instance (for .responses() and .tools)
 * @returns {ReturnType<typeof createOpenAI>}
 */
export function getOpenAIProvider() {
  if (!openaiProvider) {
    throw new Error('OpenAI provider is not configured. Add OPENAI_API_KEY to .env');
  }
  return openaiProvider;
}

/**
 * Get the raw Google Generative AI provider instance
 * @returns {ReturnType<typeof createGoogleGenerativeAI>}
 */
export function getGoogleProvider() {
  if (!googleProvider) {
    throw new Error('Google provider is not configured. Add GOOGLE_GENERATIVE_AI_API_KEY to .env');
  }
  return googleProvider;
}

/**
 * The provider-hosted web search tool for a "provider/model" string, as a
 * `tools` object for generateText, or null when that provider has none we can
 * use (OpenRouter does not relay them).
 *
 * The suggestion routes used to ask for search with
 * `resolveModel(model, { useSearchGrounding: true })`. That was an
 * @ai-sdk/google v1 model setting; from v2 the provider takes only a model id
 * and drops the second argument, so "Search the web" prompts were answered
 * from the model's memory alone. Search is a tool now, attached per call.
 *
 * Anthropic's is the basic web_search_20250305, the version every Claude
 * model takes (Claude Haiku 5.5 among them; the dynamic-filtering
 * web_search_20260209 is for Sonnet and Opus only), with at most `maxUses`
 * searches a call.
 *
 * @param {string} modelString
 * @param {{ maxUses?: number }} [options]
 * @returns {Record<string, unknown> | null}
 */
export function webSearchTools(modelString, { maxUses = 5 } = {}) {
  const [providerName] = (modelString || '').split('/');
  if (providerName === 'google' && googleProvider) {
    return { google_search: googleProvider.tools.googleSearch({}) };
  }
  if (providerName === 'openai' && openaiProvider) {
    return { web_search: openaiProvider.tools.webSearch({}) };
  }
  if (providerName === 'anthropic' && providers.anthropic) {
    return { web_search: providers.anthropic.tools.webSearch_20250305({ maxUses }) };
  }
  return null;
}
