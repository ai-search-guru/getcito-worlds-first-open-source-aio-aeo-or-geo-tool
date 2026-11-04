/**
 * LLM-judged audit signals (Faz 2). The 13 rubric signals that can't be
 * measured by parsing alone — they need semantic judgment and, for some, a
 * target buyer query.
 *
 * Score stability: the same page must get the same score. So the model is a
 * pinned, versioned one (`AUDIT_LLM_MODEL`, default google/gemini-3.8-flash)
 * called at temperature 0 with a fixed seed, and every verdict is kept
 * (llmVerdicts.js) by the hash of the input its signal reads, the signal,
 * the model and PROMPT_VERSION. An unchanged page reads its verdicts back
 * with no AI call; a changed one is judged again only on the signals whose
 * input changed. Signals read one of two views of the page: the opening
 * signals its title and first characters, the rest its text. A view with
 * signals to judge is one structured-output call.
 *
 * If a call fails, the page keeps the verdicts of its latest complete audit
 * (`lastVerdicts`). A signal with none degrades to 'na' and the audit is
 * `partial`: its score leaves those signals out and isn't compared with
 * other audits (history.js).
 */

import { createHash } from 'node:crypto';
import { generateObject } from 'ai';
import { z } from 'zod';
import { resolveModel } from '../aiProvider.js';
import { signalsByKey, RUBRIC_VERSION } from './rubric.js';
import { readVerdicts, saveVerdicts } from './llmVerdicts.js';
import { withRetry } from '../retry.js';
import { logger } from '../logger.js';

/** A stable model id: Google says stable models usually don't change. */
export const DEFAULT_MODEL = 'google/gemini-3.8-flash';

/**
 * Part of every kept verdict's key: bump it when SYSTEM_PROMPT, the prompts
 * or the call's settings change, so kept verdicts are judged again.
 */
export const PROMPT_VERSION = `${RUBRIC_VERSION}/2`;

/** The call's seed, where the provider takes one. */
const SEED = 1;

/** Characters of the page text the opening signals read. */
export const OPENING_CHARS = 2000;
/** Characters of the page text the other signals read. */
export const BODY_CHARS = 8000;

/** The signals by the view of the page they read. */
export const LLM_SIGNAL_VIEWS = {
  opening: ['direct-answer', 'bluf-answer'],
  body: [
    'query-coverage',
    'sub-query-coverage',
    'entity-coverage',
    'info-density',
    'mega-page-coverage',
    'definitions',
    'technical-terms',
    'case-study-evidence',
    'author-credentials',
    'byline-depth',
    'press-mentions',
  ],
};

// The rubric signals judged by the model. brand-entity (Wikidata) and the
// already-deterministic signals are handled elsewhere.
export const LLM_SIGNAL_KEYS = Object.values(LLM_SIGNAL_VIEWS).flat();

const viewOf = new Map(
  Object.entries(LLM_SIGNAL_VIEWS).flatMap(([view, keys]) => keys.map((k) => [k, view])),
);

const verdictSchema = z.object({
  status: z.enum(['pass', 'warn', 'fail', 'na']),
  score: z.number().min(0).max(1).nullable(),
  reason: z.string().max(300),
});

const SYSTEM_PROMPT = `You are an AEO/GEO content auditor. You judge whether a web page satisfies scoring signals that AI answer engines (ChatGPT, Gemini, Perplexity, Google AI Overviews) use when deciding what to cite.

CRITICAL: Evaluate the page ENTIRELY ON ITS OWN TERMS. First infer, from the page's own title and content, what topic/query this specific page is trying to serve. Judge every signal against THAT inferred intent. Never assume the page should be about some other topic, and never import outside subject matter.

Be strict and evidence-based. For each signal return:
- status: "pass" (clearly satisfied), "warn" (partially), "fail" (not satisfied), or "na" (genuinely not applicable to this page type).
- score: 0..1 (1 = fully satisfied), or null when status is "na".
- reason: ONE short sentence citing what you saw on THIS page (or its absence). No markdown.

Judge only from the provided page text and facts. Do not assume content you cannot see.`;

/**
 * A typical audit's AI checks: both views' calls, the opening's and the
 * body's (at most 8,000 characters) with their signals, and 13 verdicts, for
 * a caller that says what they cost before (a draft's estimate, aiEstimates.js).
 */
export const LLM_SIGNALS_TYPICAL_TOKENS = { inputTokens: 5_000, outputTokens: 1_500 };

/** The configured model: AUDIT_LLM_MODEL, else the pinned default. */
export function auditLlmModel() {
  return process.env.AUDIT_LLM_MODEL || DEFAULT_MODEL;
}

let aliasWarned = false;

/** Say once when the model is an alias that can change under the same id. */
function warnIfAlias(model) {
  if (aliasWarned || !/-(preview|latest|exp)(-|$)/i.test(model)) return;
  aliasWarned = true;
  logger.warn(
    { model },
    '[audit] AUDIT_LLM_MODEL is not a pinned version; kept verdicts may not match the model',
  );
}

/** The page's address without its query or fragment (?utm=… is the same page). */
function pageAddress(url) {
  const u = new URL(url);
  u.search = '';
  u.hash = '';
  return u.toString();
}

/**
 * What each view of the page sends the model, exactly: a verdict is kept by
 * its view's hash, so the hash covers everything the prompt holds.
 *
 * @param {import('./context.js').AuditContext} ctx
 */
export function viewInputs(ctx) {
  const url = pageAddress(ctx.url);
  const title = ctx.$ ? ctx.$('title').first().text().replace(/\s+/g, ' ').trim() : '';
  return {
    opening: { url, title, text: ctx.text.slice(0, OPENING_CHARS) },
    body: { url, wordCount: ctx.wordCount, text: ctx.text.slice(0, BODY_CHARS) },
  };
}

/** sha256 (hex) of a view's input. */
export function inputHash(input) {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

function buildPrompt(view, keys, input) {
  const defs = keys
    .map((k) => {
      const s = signalsByKey[k] ?? {};
      return `- ${k}: ${s.what ?? ''}`;
    })
    .join('\n');

  if (view === 'opening') {
    return `PAGE URL: ${input.url}
PAGE TITLE: ${input.title || '(none)'}

First, infer this page's own primary topic/query from its title and opening. Then judge each signal against that inferred intent — whether the opening serves ITS OWN topic, not any external one.

SIGNALS TO JUDGE:
${defs}

PAGE OPENING (the first ${OPENING_CHARS} characters of the page text):
"""
${input.text}
"""

Return a verdict for every signal key.`;
  }

  return `PAGE URL: ${input.url}
PAGE WORD COUNT: ${input.wordCount}

First, infer this page's own primary topic/query from its title and content. Then judge each signal against that inferred intent — the query-related signals (query-coverage, sub-query-coverage, entity-coverage) are about how well the page serves ITS OWN topic, not any external one.

SIGNALS TO JUDGE:
${defs}

PAGE TEXT (truncated):
"""
${input.text}
"""

Return a verdict for every signal key.`;
}

/**
 * Judge one view's signals in one call. Null when the call fails; a signal
 * the answer leaves out is missing from the map. `onUsage` gets the answer's
 * tokens, for a caller that charges them.
 */
async function judge(view, keys, input, model, onUsage) {
  try {
    const { object, usage } = await withRetry(
      () =>
        generateObject({
          model: resolveModel(model),
          schema: z.object(Object.fromEntries(keys.map((k) => [k, verdictSchema]))),
          system: SYSTEM_PROMPT,
          prompt: buildPrompt(view, keys, input),
          temperature: 0,
          seed: SEED,
        }),
      { label: 'llm-signals' },
    );
    if (onUsage && usage) await onUsage(usage);
    const verdicts = new Map();
    for (const key of keys) {
      const v = object?.[key];
      if (!v) continue;
      verdicts.set(key, {
        status: v.status,
        score: v.status === 'na' ? null : v.score,
        reason: v.reason,
      });
    }
    return verdicts;
  } catch (err) {
    logger.error({ err, model, view }, '[audit] LLM signals failed');
    return null;
  }
}

/**
 * @param {import('./context.js').AuditContext} ctx
 * @param {{ lastVerdicts?: () => Promise<Map<string, { status: string, score: number|null, reason: string, auditId: string }>>, onUsage?: (usage: object) => Promise<void>|void }} [options]
 *   `lastVerdicts`: the verdicts the page's latest complete audit had, asked
 *   for only when a call fails. `onUsage`: each call's tokens, for a caller
 *   that charges them (a draft's estimate, customer priorities item 9); an
 *   audit's are its credit's. Kept verdicts make no call and cost nothing.
 * @returns {Promise<{ results: Array<{ key: string, status: string, score: number|null, evidence: object }>, partial: boolean }>}
 */
export async function evaluateLlmSignals(ctx, { lastVerdicts, onUsage } = {}) {
  const model = auditLlmModel();
  warnIfAlias(model);
  const inputs = viewInputs(ctx);
  const hashes = Object.fromEntries(
    Object.entries(inputs).map(([view, input]) => [view, inputHash(input)]),
  );
  const hashOf = (key) => hashes[viewOf.get(key)];
  const options = { model, promptVersion: PROMPT_VERSION };

  const kept = await readVerdicts(
    LLM_SIGNAL_KEYS.map((key) => ({ inputHash: hashOf(key), signalKey: key })),
    options,
  );
  /** @type {Map<string, { status: string, score: number|null, evidence: object }>} */
  const verdicts = new Map();
  for (const key of LLM_SIGNAL_KEYS) {
    const v = kept.get(`${hashOf(key)}|${key}`);
    if (v) verdicts.set(key, { ...v, evidence: { reason: v.reason, model, kept: true } });
  }

  // A call for each view with signals that have no kept verdict for its input.
  const fresh = [];
  await Promise.all(
    Object.entries(LLM_SIGNAL_VIEWS).map(async ([view, keys]) => {
      const missing = keys.filter((k) => !verdicts.has(k));
      if (missing.length === 0) return;
      const judged = await judge(view, missing, inputs[view], model, onUsage);
      for (const [key, v] of judged ?? []) {
        verdicts.set(key, { ...v, evidence: { reason: v.reason, model } });
        fresh.push({ inputHash: hashes[view], signalKey: key, ...v });
      }
    }),
  );
  await saveVerdicts(fresh, options);

  // A call failed: the page keeps the verdicts it had.
  if (lastVerdicts && LLM_SIGNAL_KEYS.some((k) => !verdicts.has(k))) {
    let last = new Map();
    try {
      last = await lastVerdicts();
    } catch (err) {
      logger.warn({ err }, "[audit] the page's last AI verdicts couldn't be read");
    }
    for (const key of LLM_SIGNAL_KEYS) {
      const v = last.get(key);
      if (verdicts.has(key) || !v) continue;
      verdicts.set(key, {
        status: v.status,
        score: v.score,
        evidence: { reason: v.reason, keptFrom: v.auditId },
      });
    }
  }

  const results = LLM_SIGNAL_KEYS.map((key) => {
    const v = verdicts.get(key);
    // Degrade gracefully — deterministic signals still score the page.
    if (!v) {
      return { key, status: 'na', score: null, evidence: { error: 'LLM evaluation unavailable' } };
    }
    return {
      key,
      status: v.status,
      score: v.status === 'na' ? null : v.score,
      evidence: v.evidence,
    };
  });
  return { results, partial: results.some((r) => r.evidence.error) };
}
