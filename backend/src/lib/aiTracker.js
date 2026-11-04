/**
 * Unified AI tracker that routes to the correct provider (OpenAI or Anthropic)
 * based on the model name.
 */

import { runPrompt as runPromptOpenAI } from './openaiTracker.js';
import { runPromptAnthropic } from './anthropicTracker.js';

const ANTHROPIC_PREFIXES = ['claude-'];

function isAnthropicModel(model) {
  return ANTHROPIC_PREFIXES.some((prefix) => model.startsWith(prefix));
}

/**
 * Run a prompt through the appropriate AI provider based on model name.
 * @param {string} promptText
 * @param {string} model
 * @param {string} [region]
 * @returns {Promise<{ text: string, citations: Array<{ url: string, title: string, startIndex: number, endIndex: number }>, model: string }>}
 */
export async function runPrompt(promptText, model, region) {
  if (isAnthropicModel(model)) {
    return runPromptAnthropic(promptText, model, region);
  }
  return runPromptOpenAI(promptText, model, region);
}

// Sentiment is provider-agnostic (see sentiment.js) — unlike prompt tracking
// above, it needs no provider-hosted web search, so it follows SENTIMENT_MODEL
// instead of being pinned to OpenAI.
export { analyzeSentimentAI } from './sentiment.js';
