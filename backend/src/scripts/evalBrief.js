/**
 * Record the brief eval (CE-EVAL-001, contentBriefEval.js): for each case
 * in src/lib/__fixtures__/brief-eval/cases.js, the brief Rebuild outline
 * writes (the brief's own model, prompt and shaping), the checks anyone can
 * repeat, and a judge model's scores on the nine criteria, for
 * contentBriefEval.test.js to read on every test run.
 *
 * Run from backend/, with .env holding the providers' keys for both models
 * (the brief's is the Content Editor's read model, contentReadModelId:
 * CONTENT_READ_MODEL, else anthropic/claude-haiku-5-5 with
 * ANTHROPIC_API_KEY, else IMPROVE_SUGGESTION_MODEL, DEFAULT_SUGGESTION_MODEL
 * or google/gemini-3-flash-preview; the judge's BRIEF_EVAL_JUDGE_MODEL, else
 * anthropic/claude-haiku-4-5) and the Supabase keys the modules load with
 * (nothing is read or written there):
 *   node src/scripts/evalBrief.js [count]
 *   count defaults to every case: two calls each, the brief and its judge.
 *
 * Writes src/lib/__fixtures__/brief-eval/recorded.json for a whole run (every
 * case answered), else recorded.partial.json beside it (not committed), and
 * prints the sums. A case that fails is recorded with its error, never left
 * out. Reads and writes no database, charges no workspace's AI usage, never
 * prints a key, and isn't run in CI:
 * the answers it keeps are the models' of the day, for a person to record
 * again when the brief's prompt or the models change (the test skips a
 * record made under another prompt, Quality phase or brief rules: run it
 * with the CONTENT_QUALITY_PHASE the API runs with, and CONTENT_BRIEF_RULES=
 * true to record version 2's briefs). Under a dollar at today's prices.
 */
import 'dotenv/config';
import { writeFileSync } from 'fs';
import { generateObject } from 'ai';
import { CASES } from '../lib/__fixtures__/brief-eval/cases.js';
import { resolveModel } from '../lib/aiProvider.js';
import {
  CONTENT_READ_MAX_TOKENS,
  briefRulesOn,
  briefSchema,
  briefSystemPrompt,
  buildBriefPrompt,
  contentReadModelId,
  shapeBrief,
} from '../lib/contentBrief.js';
import { qualityPhase } from '../lib/contentQuality.js';
import {
  JUDGE_SYSTEM_PROMPT,
  briefChecks,
  briefEvalJudgeModelId,
  buildJudgePrompt,
  judgeSchema,
  passesGate,
  promptVersion,
  readJudged,
  summarize,
} from '../lib/contentBriefEval.js';
import { objectOptions } from '../lib/structuredOutput.js';

const count = Math.max(
  1,
  Math.min(CASES.length, Number.parseInt(process.argv[2] ?? `${CASES.length}`, 10) || CASES.length),
);

/** How long one call may take before the case is recorded as failed. */
const CALL_TIMEOUT_MS = 120_000;

const modelId = contentReadModelId();
const judgeModelId = briefEvalJudgeModelId();
const model = resolveModel(modelId);
const judge = resolveModel(judgeModelId);
const recorded = {};
const answered = {};
const started = Date.now();

for (const c of CASES.slice(0, count)) {
  try {
    const written = await generateObject({
      model,
      ...objectOptions(modelId, briefSchema(), { maxOutputTokens: CONTENT_READ_MAX_TOKENS }),
      system: briefSystemPrompt(),
      prompt: buildBriefPrompt(c),
      abortSignal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
    const brief = shapeBrief(written.object, c);
    // The judge at its model's own temperature: newer models take no other.
    const graded = await generateObject({
      model: judge,
      ...objectOptions(judgeModelId, judgeSchema, { maxOutputTokens: CONTENT_READ_MAX_TOKENS }),
      system: JUDGE_SYSTEM_PROMPT,
      prompt: buildJudgePrompt(c, brief),
      abortSignal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
    const judged = readJudged(graded.object, brief);
    // The model's own answer is kept: the test shapes and checks it again for free.
    recorded[c.id] = {
      object: written.object,
      usage: written.usage,
      judgeUsage: graded.usage,
      judged,
    };
    answered[c.id] = { checks: briefChecks(brief, c), judged, usage: written.usage };
    const gate = passesGate(answered[c.id].checks) ? 'passes' : 'FAILS';
    console.log(`${c.id}: ${brief.outline.length} sections, gate ${gate}`);
  } catch (err) {
    // Kept and counted: a record that leaves a case out reads better than it is.
    recorded[c.id] = { error: String(err?.message ?? err).slice(0, 300) };
    console.error(`${c.id}: failed (${recorded[c.id].error})`);
  }
}

if (!Object.keys(answered).length) {
  console.error('No case was answered: nothing is written.');
  process.exit(1);
}
const failed = Object.keys(recorded).filter((id) => recorded[id].error);
// Only a whole run, every case answered, is the record; another goes beside it.
const whole = count === CASES.length && failed.length === 0;
const file = whole ? 'recorded.json' : 'recorded.partial.json';
writeFileSync(
  new URL(`../lib/__fixtures__/brief-eval/${file}`, import.meta.url),
  `${JSON.stringify(
    {
      model: modelId,
      judgeModel: judgeModelId,
      qualityPhase: qualityPhase(),
      briefRules: briefRulesOn(),
      promptVersion: promptVersion(CASES),
      recordedAt: new Date().toISOString(),
      cases: recorded,
    },
    null,
    2,
  )}\n`,
);
console.log(JSON.stringify(summarize(answered), null, 2));
console.log(
  `Answered ${Object.keys(answered).length} of ${count} cases (${failed.length} failed) with ${modelId}, judged by ${judgeModelId}, in ${((Date.now() - started) / 1000).toFixed(0)} s: ${file}.`,
);
