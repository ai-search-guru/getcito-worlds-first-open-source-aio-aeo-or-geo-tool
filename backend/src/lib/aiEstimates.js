/**
 * What a piece of AI work typically costs, for the pages that say before it
 * runs how much of the month's AI usage it takes (customer priorities item
 * 9): getAiUsage turns each into a share of the plan's budget, so dollars
 * stay on the server. Typical, not a promise: a longer page takes more.
 */

import { LLM_SIGNALS_TYPICAL_TOKENS, auditLlmModel } from './audit/llmSignals.js';
import { contentReadModelId, contentWriteModelId } from './contentBrief.js';
import { generationCostUsd, searchCostUsd } from './improveCost.js';

/**
 * A typical Write this (contentWriter.js briefThenWrite): the brief, read
 * from the opportunity's prompts and fan-outs; the page written from it; and
 * the searches its facts pass runs.
 */
const WRITE_THIS = {
  brief: { inputTokens: 12_000, outputTokens: 3_000 },
  page: { inputTokens: 20_000, outputTokens: 8_000 },
  searches: 5,
};

/**
 * The Content Editor's agent runs, typically, as the Next step window says
 * before one starts (the user, 2026-11-03): the brief read from the sources
 * kept; a Fix run's suggestions and the facts it looks up; a page rewritten
 * whole; and a first draft written from the brief, with its facts' searches.
 */
const EDITOR_RUNS = {
  brief: { inputTokens: 12_000, outputTokens: 3_000 },
  fix: { inputTokens: 15_000, outputTokens: 4_000, searches: 2 },
  rewrite: { inputTokens: 20_000, outputTokens: 8_000 },
  write: { inputTokens: 20_000, outputTokens: 8_000, searches: 5 },
};

/** Each estimate's cost in USD, by the key the web reads it under. */
export function aiEstimateCosts() {
  const write = (run) =>
    generationCostUsd(contentWriteModelId(), run) + searchCostUsd(run.searches ?? 0);
  return {
    editorBrief: generationCostUsd(contentReadModelId(), EDITOR_RUNS.brief),
    editorFix: write(EDITOR_RUNS.fix),
    editorRewrite: write(EDITOR_RUNS.rewrite),
    editorWrite: write(EDITOR_RUNS.write),
    writeThis:
      generationCostUsd(contentReadModelId(), WRITE_THIS.brief) +
      generationCostUsd(contentWriteModelId(), WRITE_THIS.page) +
      searchCostUsd(WRITE_THIS.searches),
    // A draft's Site Audit estimate with its AI checks: its views' calls (llmSignals.js).
    auditAiChecks: generationCostUsd(auditLlmModel(), LLM_SIGNALS_TYPICAL_TOKENS),
  };
}
