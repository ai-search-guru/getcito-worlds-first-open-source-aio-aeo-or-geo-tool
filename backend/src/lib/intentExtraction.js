import { generateObject } from 'ai';
import { z } from 'zod';
import { logger } from './logger.js';

/**
 * The share of a prompt's Google volume estimated to get an AI answer: the
 * AI adoption rate. 45% by default, as AI Overviews now appear on roughly
 * 43–48% of Google searches (2026 estimates; it was about 15% a year
 * before, the old default). AI_VOLUME_MULTIPLIER overrides it.
 */
const parsedMultiplier = parseFloat(process.env.AI_VOLUME_MULTIPLIER);
export const AI_VOLUME_MULTIPLIER = Number.isFinite(parsedMultiplier) ? parsedMultiplier : 0.45;

export const intentKeywordSchema = z.object({
  intent: z
    .enum([
      'comparison',
      'how-to',
      'what-is',
      'best-top',
      'vs-review',
      'recommendation',
      'problem-solving',
      'other',
    ])
    .describe('The primary search intent behind this prompt'),
  keywords: z
    .array(
      z
        .string()
        .describe(
          'A short Google head term — 1 to 3 words, category-level, measurable Google Ads volume',
        ),
    )
    .length(5)
    .describe(
      'Five broad, high-volume Google head terms that capture the category the prompt belongs to',
    ),
});

export const INTENT_SYSTEM_PROMPT = `You are a keyword research expert. Given an AI search prompt, you must:

1. Determine the primary search intent (comparison, how-to, what-is, best-top, vs-review, recommendation, or problem-solving).
2. Generate exactly 5 short HEAD keywords that a user would type into Google when researching the same category.

CRITICAL: Output HEAD terms, NOT long-tail variants. Google Ads only returns search volume for keywords with measurable demand — long-tail strings like "best portable motion control for travel 2026" return 0. Drop modifiers and surface the underlying noun phrases.

Rules:
- 1 to 3 words per keyword (strict). Never more than 4.
- Generic, category-level. No brand names, no years, no superlatives ("best", "top") unless they are part of the natural head term.
- Lowercase only.
- Each of the 5 keywords must capture a different angle of the same category.
- Think "what category does this prompt belong to?" → then list the broadest searchable terms in that category.

Example A — prompt: "What are the best tools for managing remote teams?"
- Intent: best-top
- Keywords: ["project management software", "team collaboration tools", "remote work software", "team management apps", "online collaboration platform"]

Example B — prompt: "best portable motion control for travel 2026"
- Intent: best-top
- Keywords: ["camera slider", "motion control camera", "video stabilizer", "camera dolly", "time lapse equipment"]

Notice: NO "best", NO "2026", NO "for travel". Strip modifiers, keep the category nouns.`;

/**
 * Extract search intent + 5 Google head keywords from an AI search prompt.
 * Single source of truth for the volumes routes — both `/analyze` and
 * `/analyze-batch` call this so the prompt/schema can never drift apart.
 *
 * @param {string} promptText - The AI search prompt to analyze.
 * @param {import('ai').LanguageModel} aiModel - A resolved AI SDK model (from `resolveModel`).
 * @returns {Promise<{ intent: string, keywords: string[] }>}
 */
export async function extractIntentKeywords(promptText, aiModel) {
  const { object } = await generateObject({
    model: aiModel,
    schema: intentKeywordSchema,
    system: INTENT_SYSTEM_PROMPT,
    prompt: `Analyze this AI search prompt and extract intent + 5 Google keywords:\n\n"${promptText}"`,
  });
  return { intent: object.intent, keywords: object.keywords };
}

// Intent-only schema — reuses the EXACT enum from intentKeywordSchema so the
// Query Fan-out "intent" column can never drift from the Insights one.
export const intentOnlySchema = z.object({
  intent: intentKeywordSchema.shape.intent,
});

/**
 * What each intent label means: the chat model's list and a decision model's
 * criteria (#988), so the two classify by the same words.
 */
export const INTENT_CRITERIA = {
  comparison: 'weighing multiple options against each other',
  'how-to': 'accomplishing a task or process',
  'what-is': 'a definition or understanding a concept',
  'best-top': 'finding the best / top options in a category',
  'vs-review': 'a head-to-head or a review of a specific thing',
  recommendation: 'asking for a suggestion or what to pick',
  'problem-solving': 'fixing an issue or troubleshooting',
  other: 'none of the above fits',
};

export const INTENT_ONLY_SYSTEM_PROMPT = `You classify the primary search intent behind a short query into exactly one of these labels:

${Object.entries(INTENT_CRITERIA)
  .map(([label, meaning]) => `- ${label}: ${meaning}`)
  .join('\n')}

Return only the single best-fitting label.`;

/**
 * Classify the primary search intent of a query — intent only, no keyword
 * extraction and no volume work, so it's a cheaper call than
 * extractIntentKeywords. Shares the same intent enum (#333).
 *
 * @param {string} text - The sub-query / prompt to classify.
 * @param {import('ai').LanguageModel} aiModel - A resolved AI SDK model (from `resolveModel`).
 * @returns {Promise<string>} one of the intent enum values
 */
export async function classifyPromptIntent(text, aiModel) {
  const { object } = await generateObject({
    model: aiModel,
    schema: intentOnlySchema,
    system: INTENT_ONLY_SYSTEM_PROMPT,
    prompt: `Classify the search intent of this query:\n\n"${text}"`,
  });
  return object.intent;
}

/** The most questions a decision model answers in one request. */
export const DECIDER_BATCH_SIZE = 128;

/** Chat-model calls in flight at once, as the route has always made them. */
const CHAT_CONCURRENCY = 6;

/**
 * Classifies queries' intents with a decision model (#988): one `choice`
 * question per query, up to DECIDER_BATCH_SIZE per request, where the chat
 * model takes a call per query. A batch that fails, or an answer outside the
 * labels, leaves those queries out: nothing is guessed, so nothing wrong is
 * cached.
 *
 * @param {string[]} queries - normalized queries, each once
 * @param {(params: { state: object, questions: object }) => Promise<Record<string, object>>} decideFn - decider.js's decide
 * @returns {Promise<Record<string, string>>} the intent of each query answered
 */
export async function classifyIntentsByDecider(queries, decideFn) {
  const batches = [];
  for (let i = 0; i < queries.length; i += DECIDER_BATCH_SIZE) {
    batches.push(queries.slice(i, i + DECIDER_BATCH_SIZE));
  }
  const intents = {};
  const settled = await Promise.allSettled(
    batches.map(async (batch) => {
      const named = Object.fromEntries(batch.map((query, i) => [`q${i}`, query]));
      const answers = await decideFn({
        state: { task: 'Search intent of each query', queries: named },
        questions: Object.fromEntries(
          Object.entries(named).map(([name, query]) => [
            name,
            {
              type: 'choice',
              instructions: `The primary search intent behind query ${name}: "${query}".`,
              criteria: INTENT_CRITERIA,
            },
          ]),
        ),
      });
      for (const [name, query] of Object.entries(named)) {
        const choice = answers?.[name]?.choice;
        if (Object.hasOwn(INTENT_CRITERIA, choice)) intents[query] = choice;
      }
    }),
  );
  const failed = settled.filter((s) => s.status === 'rejected');
  if (failed.length > 0) {
    logger.warn(
      { err: failed[0].reason, batches: failed.length },
      '[fanout-intents] decision model batches failed; those queries stay unclassified',
    );
  }
  return intents;
}

/**
 * A fan-out sub-query as its intent is cached (fanout_query_intents, #333):
 * whitespace collapsed, trimmed, lower-cased, at most 512 characters; empty
 * when it isn't a string.
 *
 * @param {unknown} raw
 * @returns {string}
 */
export function normalizeIntentQuery(raw) {
  return typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 512) : '';
}

/**
 * Classifies the queries the cache doesn't hold yet. With
 * FANOUT_INTENTS_DECIDER set and OpenRouter configured, a decision model
 * answers them in batches; otherwise the chat model takes each, six at a time,
 * as before. A query that fails stays out, and is asked again next time.
 *
 * @param {string[]} queries - normalized queries, each once
 * @param {object} deps
 * @param {() => import('ai').LanguageModel} deps.chatModel - resolves the chat model, only when it's used
 * @param {(params: object) => Promise<Record<string, object>>} deps.decideFn
 * @param {() => boolean} deps.deciderConfigured
 * @returns {Promise<Record<string, string>>} the intent of each query classified
 */
export async function classifyQueryIntents(queries, { chatModel, decideFn, deciderConfigured }) {
  if (queries.length === 0) return {};
  if (process.env.FANOUT_INTENTS_DECIDER && deciderConfigured()) {
    return classifyIntentsByDecider(queries, decideFn);
  }
  const aiModel = chatModel();
  const intents = {};
  for (let i = 0; i < queries.length; i += CHAT_CONCURRENCY) {
    const chunk = queries.slice(i, i + CHAT_CONCURRENCY);
    const settled = await Promise.allSettled(
      chunk.map((query) => classifyPromptIntent(query, aiModel)),
    );
    settled.forEach((s, j) => {
      if (s.status === 'fulfilled') intents[chunk[j]] = s.value;
    });
  }
  return intents;
}
