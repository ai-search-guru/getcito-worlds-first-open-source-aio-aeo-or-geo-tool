/**
 * Ask Cloro for one answer and show its query fan-out (#332): the raw fields,
 * and what we would store. For when the daily health report says an engine's
 * fan-out fell away (as ChatGPT's did on 2026-09-30) — it tells an emptied
 * field from one that changed shape or moved.
 *
 * Run from backend/, with CLORO_API_KEY in .env. Sends ONE async task, billed
 * by Cloro (ChatGPT with fan-out: about 9 credits):
 *   node src/scripts/probeCloroFanout.js [platform] ["prompt"] [country]
 *   platform defaults to chatgpt-web; e.g. copilot-web, perplexity-web, gemini-web
 *
 * Prints a summary and writes the full response to a temp file. Never prints
 * the API key.
 *
 * Still to check with a real request (the maintainer's): whether a legacy
 * ChatGPT answer's `sources` carry the `footnote` flag the way the default
 * interface's do, so the #1119 filter (toCitations in cloroScraper.js) keeps
 * leaving the uncited pages out on a prompt's fan-out day. The raw response
 * this writes holds the sources as Cloro sent them.
 */
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildRequestBody, parseScraperResponse, SCRAPER_TASK_TYPES } from '../lib/cloroScraper.js';

const CLORO_API = 'https://api.cloro.dev';
const platform = process.argv[2] ?? 'chatgpt-web';
const prompt = process.argv[3] ?? 'How can I track my website ranking in Google AI overviews?';
const country = process.argv[4] ?? 'US';

const key = process.env.CLORO_API_KEY;
const taskType = SCRAPER_TASK_TYPES[platform];
if (!key) {
  console.error('CLORO_API_KEY is not set (backend/.env).');
  process.exit(1);
}
if (!taskType) {
  console.error(
    `Unknown platform "${platform}". One of: ${Object.keys(SCRAPER_TASK_TYPES).join(', ')}`,
  );
  process.exit(1);
}

// The request production sends (on ChatGPT, the legacy task a prompt sends
// on its fan-out day, CLORO_CHATGPT_FANOUT), plus the raw stream where the
// engine takes it (Google's endpoints don't), to look for queries outside the
// documented fields, and the fan-out flag. On ChatGPT the two share one
// add-on's +2 credits.
const payload = buildRequestBody(prompt, platform, country, undefined, undefined, {
  legacy: true,
});
if (!['google-aio', 'google-aimode'].includes(platform)) {
  payload.include = { ...payload.include, rawResponse: true, searchQueries: true };
}

const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
const submit = await fetch(`${CLORO_API}/v1/async/task`, {
  method: 'POST',
  headers,
  body: JSON.stringify({ taskType, payload }),
});
const submitted = await submit.json().catch(() => ({}));
if (!submitted.success || !submitted.task?.id) {
  console.error(`Submit failed (${submit.status}):`, JSON.stringify(submitted).slice(0, 300));
  process.exit(1);
}
console.log(`Submitted ${platform} task; waiting for Cloro…`);

let data = {};
for (let i = 0; i < 90; i++) {
  await new Promise((resolve) => setTimeout(resolve, 4000));
  const res = await fetch(`${CLORO_API}/v1/async/task/${submitted.task.id}`, { headers });
  data = await res.json().catch(() => ({}));
  const status = String(data.task?.status ?? data.status ?? '').toUpperCase();
  if (status === 'COMPLETED' || status === 'FAILED') break;
}

const file = join(tmpdir(), `cloro-fanout-${platform}-${Date.now()}.json`);
writeFileSync(file, JSON.stringify(data, null, 2));

const response = data.response ?? {};
const result = response.result ?? response;
const describe = (value) =>
  Array.isArray(value)
    ? `array(${value.length}) ${JSON.stringify(value.slice(0, 3)).slice(0, 200)}`
    : typeof value;

// Every key that looks like a query, wherever it sits — the raw stream included.
const queryKeys = [];
const walk = (value, path) => {
  if (!value || typeof value !== 'object' || queryKeys.length >= 30) return;
  for (const [k, v] of Object.entries(value)) {
    const p = path ? `${path}.${k}` : k;
    if (/search|quer|fan.?out/i.test(k)) queryKeys.push(`${p}: ${describe(v)}`.slice(0, 240));
    walk(v, p);
  }
};
walk(result, '');

let stored = [];
try {
  stored = parseScraperResponse(response, platform).search_queries ?? [];
} catch (err) {
  stored = `parse failed: ${err.message}`;
}

console.log(
  JSON.stringify(
    {
      platform,
      status: data.task?.status ?? data.status,
      model: result.model,
      sources: Array.isArray(result.sources) ? result.sources.length : typeof result.sources,
      searchQueries: describe(result.searchQueries),
      mapSearchQueries: describe(result.mapSearchQueries),
      search_model_queries: describe(result.search_model_queries),
      rawResponse: describe(result.rawResponse),
      queryLikeKeys: queryKeys,
      weWouldStore: Array.isArray(stored) ? `${stored.length} sub-queries` : stored,
      fullResponse: file,
    },
    null,
    2,
  ),
);
process.exit(0);
