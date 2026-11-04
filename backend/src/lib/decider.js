/**
 * Decision models through OpenRouter's Decisions API.
 *
 * A decision model does not write text. It reads a `state` (text or JSON) and
 * answers named questions with calibrated probabilities:
 *   - `choice`: one of a fixed set of options
 *   - `noul`: the probability of yes
 *   - `score`: a level on an ordered rubric
 * Up to 128 questions fit in one request.
 *
 * OpenRouter serves these models on a separate endpoint, not Chat Completions,
 * so they do not go through resolveModel(). The endpoint is marked alpha:
 * callers keep a fallback.
 */

import { logger } from './logger.js';

const DECISIONS_URL = 'https://openrouter.ai/api/alpha/decisions';

/** Perplexity's decision model; the default for every decision here. */
export const DEFAULT_DECIDER_MODEL = 'perplexity/pplx-decider-v1.1-27b';

const TIMEOUT_MS = 30_000;
const MAX_RETRIES = 3;
/** Requests in flight at once, so a tracking run does not burst past rate limits. */
const MAX_CONCURRENT = 8;
/** Busy or briefly unavailable: worth another try. */
const RETRYABLE = new Set([429, 502, 503, 524, 529]);

/** True when a key is configured, so decisions can run at all. */
export function isDeciderConfigured() {
  return Boolean(process.env.OPENROUTER_API_KEY);
}

let active = 0;
const waiting = [];

/** Runs `fn` once a slot is free; a finishing request hands its slot on. */
async function withSlot(fn) {
  if (active >= MAX_CONCURRENT) {
    await new Promise((resolve) => waiting.push(resolve));
  } else {
    active++;
  }
  try {
    return await fn();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else active--;
  }
}

function retryDelayMs(res, attempt) {
  const seconds = Number(res.headers.get('retry-after'));
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : 500 * 2 ** attempt;
}

/**
 * Asks a decision model the given questions about `state`.
 *
 * @param {object} params
 * @param {string | object} params.state - the content the questions are about
 * @param {Record<string, object>} params.questions - named questions, as the API takes them
 * @param {string} [params.model] - defaults to DECIDER_MODEL, then DEFAULT_DECIDER_MODEL
 * @returns {Promise<Record<string, object>>} the answers, keyed by question name
 */
export async function decide({ state, questions, model }) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not configured');

  const body = JSON.stringify({
    model: model || process.env.DECIDER_MODEL || DEFAULT_DECIDER_MODEL,
    state,
    questions,
  });

  return withSlot(async () => {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(DECISIONS_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (RETRYABLE.has(res.status) && attempt < MAX_RETRIES) {
        const delay = retryDelayMs(res, attempt);
        logger.warn({ status: res.status, attempt, delay }, '[decider] retrying');
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Decisions API ${res.status}: ${text.slice(0, 300)}`);
      }

      const { answers } = await res.json();
      if (!answers || typeof answers !== 'object') {
        throw new Error('Decisions API returned no answers');
      }
      return answers;
    }
  });
}
