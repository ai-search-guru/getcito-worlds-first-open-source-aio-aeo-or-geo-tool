/**
 * Record the Content Agent's own answers on the no-fabrication test set
 * (src/lib/__fixtures__/no-fabrication/cases.js, Quality spec §9), for
 * noFabrication.test.js to read: every figure that survives the guards
 * must be in what the agent was given, and every name or quote it wasn't
 * given that they let through must be one a person has looked over. The
 * script prints those (toReview: read without the guards' cues); copy the
 * ones checked into recorded.json's `reviewed`, by draft.
 *
 * Run from backend/, with .env holding the content model's provider key (the
 * Content Agent's writing model, contentWriteModelId: CONTENT_WRITE_MODEL,
 * else anthropic/claude-sonnet-5-5 with ANTHROPIC_API_KEY, else
 * IMPROVE_SUGGESTION_MODEL, DEFAULT_SUGGESTION_MODEL or
 * google/gemini-3-flash-preview) and the Supabase keys the agent's modules
 * load with (nothing is read or written there):
 *   node src/scripts/evalNoFabrication.js [count]
 *   count defaults to every draft: two calls each, the suggestions Fix
 *   open rules asks for and a page written whole, as Start asks for it.
 *
 * Writes src/lib/__fixtures__/no-fabrication/recorded.json, only when at
 * least one draft was answered. Reads and writes no database, never prints a
 * key, and isn't run in CI: the answers it keeps
 * are the model's of the day, for a person to re-record when the prompts or
 * the model change. A few cents at today's prices.
 */
import 'dotenv/config';
import { writeFileSync } from 'fs';
import { generateObject } from 'ai';
import { CASES } from '../lib/__fixtures__/no-fabrication/cases.js';
import { guardedFix, guardedPage, toReview } from '../lib/__fixtures__/no-fabrication/guarded.js';
import { resolveModel } from '../lib/aiProvider.js';
import {
  SYSTEM_PROMPT,
  buildFixPrompt,
  draftPassages,
  suggestionsSchema,
} from '../lib/contentAgent.js';
import {
  CONTENT_WRITE_MAX_TOKENS,
  briefRulesOn,
  contentWriteModelId,
} from '../lib/contentBrief.js';
import { inputSources } from '../lib/contentInputs.js';
import { numberSources, sourcesPrompt } from '../lib/contentSources.js';
import { objectOptions } from '../lib/structuredOutput.js';
import {
  writeSystemPrompt,
  briefText,
  buildWritePrompt,
  pageSchema,
} from '../lib/contentWriter.js';

const count = Math.max(
  1,
  Math.min(CASES.length, Number.parseInt(process.argv[2] ?? `${CASES.length}`, 10) || CASES.length),
);

/** The open rules: the ones that tempt a model to make things up. */
const RULES = [
  { key: 'dated', name: 'A dated data point', detail: 'missing' },
  { key: 'expert', name: 'A quote from an expert', detail: 'missing' },
  { key: 'example', name: 'A real customer example', detail: 'missing' },
];

const modelId = contentWriteModelId();
const write = { maxOutputTokens: CONTENT_WRITE_MAX_TOKENS };
const model = resolveModel(modelId);
const recorded = {};
const started = Date.now();

for (const c of CASES.slice(0, count)) {
  const numbered = numberSources({
    prompts: c.prompts,
    fanouts: c.fanouts,
    inputs: inputSources(c.inputs, c.brand.name),
  });
  const draft = { title: c.title, page_type: 'blog_post', body_html: c.html };
  const brand = { ...c.brand, language: c.language, site_type: c.siteType };
  const input = {
    rules: RULES,
    textRules: [],
    locked: [],
    sources: {
      promptIds: [],
      fanouts: c.fanouts,
      pages: [],
      queries: [],
      headings: [],
      length: 2500,
    },
  };
  try {
    const [fix, page] = await Promise.all([
      generateObject({
        model,
        ...objectOptions(modelId, suggestionsSchema, write),
        system: SYSTEM_PROMPT,
        prompt: buildFixPrompt({
          brand,
          draft,
          passages: draftPassages(c.html),
          lockedKeys: new Set(),
          input,
          sources: sourcesPrompt(numbered),
        }),
      }),
      generateObject({
        model,
        ...objectOptions(modelId, pageSchema, write),
        system: writeSystemPrompt(),
        prompt: buildWritePrompt({ brand, draft, numbered, brief: briefText(null, null), input }),
      }),
    ]);
    recorded[c.id] = { fix: fix.object.suggestions, page: page.object };
    console.log(`${c.id}: ${fix.object.suggestions.length} suggestions and a page`);
  } catch (err) {
    console.error(`${c.id}: failed (${err?.message ?? err})`);
  }
}

if (!Object.keys(recorded).length) {
  console.error('No draft was answered: recorded.json is left as it was.');
  process.exit(1);
}
writeFileSync(
  new URL('../lib/__fixtures__/no-fabrication/recorded.json', import.meta.url),
  `${JSON.stringify({ model: modelId, briefRules: briefRulesOn(), recordedAt: new Date().toISOString(), reviewed: {}, ...recorded }, null, 2)}\n`,
);
// Then what the guards let through that the agent wasn't given, for a
// person to look over: the answers are kept first, whatever happens here.
const review = {};
for (const c of CASES) {
  const answer = recorded[c.id];
  if (!answer) continue;
  const texts = [
    ...guardedFix(c, answer.fix, new Set(RULES.map((r) => r.key))),
    guardedPage(c, answer.page),
  ];
  const spans = [...new Set(texts.flatMap((text) => toReview(c, text)))];
  if (spans.length) review[c.id] = spans;
}
for (const [id, spans] of Object.entries(review)) {
  console.log(`To review, ${id}:\n${spans.map((span) => `  ${span}`).join('\n')}`);
}
console.log(
  `Recorded ${Object.keys(recorded).length} of ${count} drafts with ${modelId} in ${((Date.now() - started) / 1000).toFixed(0)} s.`,
);
