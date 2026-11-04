/**
 * Provider-agnostic brand sentiment analysis.
 *
 * Replaces the OpenAI-only implementation in openaiTracker.js, which called
 * `openai.responses.create()` directly and therefore made OPENAI_API_KEY
 * mandatory for every self-hosted install — even one tracking Claude only, or
 * reading every engine through Cloro. Sentiment runs on both paths (the API
 * tracking worker and the Cloro result handler), so that single hard-coded
 * client was the last thing forcing an OpenAI account.
 *
 * Routing now goes through resolveModel(), so SENTIMENT_MODEL accepts any
 * configured provider: "anthropic/claude-haiku-4-5", "google/gemini-3-flash",
 * "openrouter/…". Default is unchanged from the previous behaviour.
 *
 * With OPENROUTER_API_KEY set and no SENTIMENT_MODEL, a decision model
 * (decider.js) answers instead (#987): sentiment is a three-way choice, which
 * it answers with real probabilities, far cheaper, and with room for the whole
 * answer. A chat model reads at most a 3,000-character excerpt, and the
 * excerpt is built around the brand's mentions (#986): the first 3,000
 * characters missed every brand named later, and those all came back neutral.
 */

import { generateObject } from 'ai';
import { z } from 'zod';
import { resolveModel } from './aiProvider.js';
import { decide, isDeciderConfigured } from './decider.js';
import { brandMentionRanges } from './responseParser.js';
import { logger } from './logger.js';

/** Preserves the pre-existing default so upgrades are a no-op. */
const DEFAULT_SENTIMENT_MODEL = 'openai/gpt-5-mini';

/** Longest excerpt sent to a chat model — the original limit. */
const MAX_RESPONSE_CHARS = 3000;

/** Longest excerpt sent to the decision model, well inside its context. */
const MAX_DECIDER_CHARS = 100_000;

/** Characters kept on each side of a brand mention in an excerpt. */
const MENTION_CONTEXT_CHARS = 600;

/** The opening often frames the whole answer, so excerpts keep it. */
const OPENING_CHARS = 400;

// `confidence` carries no min/max: Anthropic rejects `minimum`/`maximum` on
// numeric properties in strict structured-output mode ("For 'number' type,
// properties maximum, minimum are not supported"), and OpenRouter surfaces that
// 400 from every backing provider — Anthropic, Azure and Bedrock alike. The
// range is enforced in code below instead, as the original implementation did.
export const sentimentSchema = z.object({
  sentiment: z.enum(['positive', 'neutral', 'negative']),
  confidence: z.number(),
  reason: z.string(),
});

/** What each answer means, for the decision model. */
const SENTIMENT_CRITERIA = {
  positive:
    'The response recommends the brand, lists or ranks it among the suggested or best options, or describes it favourably.',
  neutral:
    'The response mentions the brand only as a source, a citation or in passing, without recommending or criticising it.',
  negative:
    'The response criticises the brand, warns against it, or ranks it poorly compared with the alternatives.',
};

/** Clamp to [0,1] — the schema cannot express it portably. */
function clampConfidence(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0.5;
  return Math.max(0, Math.min(1, value));
}

export const SENTIMENT_SYSTEM_PROMPT =
  'You are a brand sentiment analyzer. Given an AI-generated response and a brand name, determine the sentiment toward that brand. Base the verdict only on how the response portrays that specific brand, not on its overall tone.';

/**
 * The parts of `text` that talk about the brand, within `budget` characters:
 * the opening, then the text around each mention, with overlapping stretches
 * merged. Text that fits is returned whole; text that never names the brand
 * is cut to its first `budget` characters.
 *
 * @param {string} text
 * @param {{ brandName: string, domains?: string[] }} brand
 * @param {number} budget
 */
export function brandExcerpt(text, brand, budget) {
  if (text.length <= budget) return text;

  const ranges = brandMentionRanges(text, brand);
  if (ranges.length === 0) return text.slice(0, budget);

  const merged = [];
  for (const [start, end] of [
    [0, OPENING_CHARS],
    ...ranges.map(([s, e]) => [
      Math.max(0, s - MENTION_CONTEXT_CHARS),
      Math.min(text.length, e + MENTION_CONTEXT_CHARS),
    ]),
  ]) {
    const last = merged.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }

  const separator = '\n…\n';
  let excerpt = '';
  for (const [start, end] of merged) {
    const gap = excerpt ? separator : '';
    const room = budget - excerpt.length - gap.length;
    if (room <= 0) break;
    excerpt += gap + text.slice(start, Math.min(end, start + room));
  }
  return excerpt;
}

async function sentimentByDecider(responseText, brand) {
  const answers = await decide({
    state: {
      brand: brand.brandName,
      ai_response: brandExcerpt(responseText, brand, MAX_DECIDER_CHARS),
    },
    questions: {
      sentiment: {
        type: 'choice',
        instructions: `How does the AI response treat the brand "${brand.brandName}"? Judge only how it treats this brand, not other brands or the response's overall tone.`,
        criteria: SENTIMENT_CRITERIA,
      },
    },
  });

  const { choice, probabilities } = answers.sentiment ?? {};
  if (!Object.hasOwn(SENTIMENT_CRITERIA, choice)) {
    throw new Error(`Unexpected sentiment answer: ${JSON.stringify(answers.sentiment)}`);
  }
  return { sentiment: choice, confidence: clampConfidence(probabilities?.[choice]), reason: '' };
}

async function sentimentByChatModel(responseText, brand) {
  const model = resolveModel(process.env.SENTIMENT_MODEL || DEFAULT_SENTIMENT_MODEL);

  const { object } = await generateObject({
    model,
    schema: sentimentSchema,
    system: SENTIMENT_SYSTEM_PROMPT,
    prompt: `Brand: "${brand.brandName}"\n\nAI Response:\n${brandExcerpt(responseText, brand, MAX_RESPONSE_CHARS)}`,
  });

  return { ...object, confidence: clampConfidence(object.confidence) };
}

/**
 * Analyze sentiment of an AI response toward a specific brand.
 *
 * Never throws: a failure here must not lose an otherwise valid tracking
 * result. The decision model falls back to the chat model, and the chat model
 * to neutral, exactly as the previous implementation did.
 *
 * @param {string} responseText - The AI-generated response text
 * @param {string} brandName - The brand name to analyze sentiment for
 * @param {string[]} [domains] - The brand's domains, which also count as mentions
 * @returns {Promise<{ sentiment: 'positive'|'neutral'|'negative', confidence: number, reason: string }>}
 */
export async function analyzeSentimentAI(responseText, brandName, domains = []) {
  const brand = { brandName, domains };

  // An explicit SENTIMENT_MODEL is a choice of chat model, and wins.
  if (!process.env.SENTIMENT_MODEL && isDeciderConfigured()) {
    try {
      return await sentimentByDecider(responseText, brand);
    } catch (err) {
      logger.warn({ err }, '[sentiment-ai] decision model failed, falling back to the chat model');
    }
  }

  try {
    return await sentimentByChatModel(responseText, brand);
  } catch (err) {
    logger.error({ err }, '[sentiment-ai] failed, falling back to neutral');
    return { sentiment: 'neutral', confidence: 0, reason: 'Analysis failed' };
  }
}
