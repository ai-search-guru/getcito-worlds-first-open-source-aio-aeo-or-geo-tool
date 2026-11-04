/**
 * Cloro scraper client — async-only.
 * All requests go through the Cloro async task API (submit + poll).
 *
 * Docs:
 *  - Async requests: https://docs.cloro.dev/guides/making-requests#asynchronous-requests
 *  - Task status:    https://docs.cloro.dev/api-reference/endpoint/get-task-status
 */

import logger from './logger.js';
import { stripEntityMarkup } from './entityMarkup.js';
import { googleLocationFor, parseLocation } from './locations.js';

export const CLORO_API = 'https://api.cloro.dev';

export const SCRAPER_TASK_TYPES = {
  'chatgpt-web': 'CHATGPT',
  'chatgpt-shopping': 'CHATGPT',
  'google-aio': 'GOOGLE',
  'google-aimode': 'AIMODE',
  'copilot-web': 'COPILOT',
  'grok-web': 'GROK',
  'perplexity-web': 'PERPLEXITY',
  'gemini-web': 'GEMINI',
};

const DEFAULT_MAX_WAIT_MS = 30 * 60 * 1000; // 30 minutes
const DEFAULT_POLL_INTERVAL_MS = 10000; // 10 seconds

function getApiKey() {
  const key = process.env.CLORO_API_KEY;
  if (!key) throw new Error('CLORO_API_KEY must be configured');
  return key;
}

/**
 * The task payload Cloro gets. `opts.legacy` asks ChatGPT for its fan-out
 * through its legacy desktop interface; the caller decides when
 * (chatgptFanout.js), and only `chatgpt-web` takes it.
 */
export function buildRequestBody(promptText, scraperId, region, state, location, opts = {}) {
  const country = region || 'US';
  // A city (PROMPT-015d) or a US state: Google's canonical name
  // (googleLocationFor), which the Google endpoints take as `location` beside
  // the country. Only they get it.
  const locationField = location ? { location } : {};

  // State-level geo-targeting (#554): the AI endpoints accept a USPS state
  // code alongside country US and route through an in-state proxy. Google
  // AIO / AI Mode ask from a state through `location` instead and must never
  // receive `state` too: their branches below skip this spread.
  const stateField = country === 'US' && state ? { state } : {};

  if (scraperId === 'chatgpt-shopping') {
    // ChatGPT Shopping uses the same CHATGPT task but flips include.shopping.
    // Cloro's response then includes `shoppingCards` and `inlineProducts`
    // surfaced in the live ChatGPT shopping experience.
    return {
      prompt: promptText,
      country,
      ...stateField,
      include: {
        html: false,
        markdown: true,
        shopping: true,
      },
    };
  }

  if (scraperId === 'google-aio') {
    return {
      query: promptText,
      country,
      ...locationField,
      include: {
        html: false,
        aioverview: { markdown: true },
      },
    };
  }

  if (scraperId === 'google-aimode') {
    return {
      prompt: promptText,
      country,
      ...locationField,
      include: {
        html: false,
        markdown: true,
      },
    };
  }

  // ChatGPT's legacy desktop interface still carries the query text its
  // default one dropped. Cloro calls it best-effort and temporary.
  const chatgptFanout = scraperId === 'chatgpt-web' && opts.legacy === true;

  return {
    prompt: promptText,
    country,
    ...stateField,
    ...(chatgptFanout ? { legacy: true } : {}),
    include: {
      html: false,
      markdown: true,
      rawResponse: false,
      // Opt in to the observed query fan-out (#332), which Copilot and
      // Perplexity populate; the health report's fan-out section flags one
      // that stops. Not on ChatGPT's default task: since 2026-09-30 its
      // default (mobile-web) interface carries no query text, so the field
      // came back empty on every answer while the add-on still cost +2
      // credits a task (#1119). Only its legacy task asks.
      ...(scraperId !== 'chatgpt-web' || chatgptFanout ? { searchQueries: true } : {}),
    },
  };
}

/**
 * The sources an answer cites, as the citations we store. Since 2026-10-09
 * ChatGPT's `sources` also list the pages it read without citing them, marked
 * `footnote: true`; counted as citations, they put ChatGPT's citation numbers
 * at about 2.5× what its answers cite (#1119). Only ChatGPT sets the flag, but
 * it is honoured for every engine.
 */
function toCitations(sources) {
  return (sources || [])
    .filter((src) => src.footnote !== true)
    .map((src, idx) => ({
      url: src.url || '',
      title: src.label || '',
      startIndex: idx * 100,
      endIndex: idx * 100 + 50,
    }));
}

/**
 * Where an entry an engine joined splits into its searches: at a semicolon,
 * not one that ends an HTML entity ("what&#39;s", "&amp;"). The same rule as
 * the editor's (frontend/src/lib/content/sources.ts, fanoutQueries).
 */
const SEARCH_SEPARATOR = /(?<!&#?\w+);/u;

/**
 * Normalize the observed query fan-out from a raw Cloro response into a rich,
 * engine-labelled array: `[{ query, engine?, source_platform }]` (#332).
 *
 * Provider shapes:
 *  - Perplexity → `search_model_queries: string[]` since Cloro's 2026-07-23
 *    update; `[{ query, engine, limit }]` before it (keep `engine`). Both are
 *    accepted so a potential upstream revert can't silently zero the field
 *    again.
 *  - Copilot / ChatGPT / Grok / Gemini → `searchQueries: string[]`
 *  - ChatGPT also → `mapSearchQueries: string[]`, the searches it ran on its
 *    map (kept with `engine: 'maps'`).
 * Entries are read as strings or as `{ query }` objects in every field: when
 * ChatGPT's fan-out went silent on 2026-09-30, nothing told an emptied field
 * from one that changed shape, and the strings-only read would have dropped
 * the second without a trace. Anything else (or missing) → `[]`. This is
 * OBSERVED data only — we never synthesize sub-queries. An entry an engine
 * sent as several searches joined by semicolons ("chatgpt subscription;
 * gemini subscription") is each of them: a page's heading or FAQ question
 * written from the fan-out needs one search, not the list.
 */
function normalizeSearchQueries(result, scraperId) {
  // Trim on write so the same sub-query never fragments into whitespace
  // variants — the #333 aggregation groups by query string. `engine` is only
  // kept when it's a non-empty string (never a stray non-string value).
  const toItems = (entry, fallbackEngine) => {
    const query =
      typeof entry === 'string' ? entry : typeof entry?.query === 'string' ? entry.query : null;
    if (query === null || query.trim() === '') return [];
    const engine =
      typeof entry?.engine === 'string' && entry.engine.trim() !== ''
        ? entry.engine.trim()
        : fallbackEngine;
    return query
      .split(SEARCH_SEPARATOR)
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => ({ query: part, ...(engine ? { engine } : {}), source_platform: scraperId }));
  };
  const read = (list, fallbackEngine) =>
    Array.isArray(list) ? list.flatMap((entry) => toItems(entry, fallbackEngine)) : [];

  // Perplexity's field first. An empty one falls through, so it can't hide a
  // populated `searchQueries` beside it.
  const perplexity = read(result.search_model_queries);
  if (perplexity.length > 0) return perplexity;

  return [...read(result.searchQueries), ...read(result.mapSearchQueries, 'maps')];
}

/**
 * Parse a completed Cloro task into the answer we store. The text loses
 * ChatGPT's entity tags here (entityMarkup.js), so the saved answer and every
 * metric derived from it read the names instead. Only ChatGPT has been seen
 * to send them, but the cleanup is harmless on the other engines.
 */
export function parseScraperResponse(result, scraperId) {
  if (scraperId === 'chatgpt-shopping') {
    // ChatGPT Shopping returns a normal ChatGPT response shape *plus*
    // camelCase `shoppingCards` and `inlineProducts` payloads. Both arrays
    // go on the prompt_results row raw — the Shopping page consumes them.
    // Model is forced to the shopping-specific id so Insights aggregates
    // (which exclude `platform = 'chatgpt-shopping'`) never mix this row
    // into brand-level visibility numbers.
    const text = stripEntityMarkup(result.markdown || result.text || '');
    const citations = toCitations(result.sources);
    // Since 2026-10-16 Cloro returns the listing ChatGPT attaches to a product
    // it names as `entities[n].product`, with the same shape as a card product
    // minus `position`, and `inlineProducts` has come back empty since (#1183).
    // Both are single products inside the answer, so the listings join the
    // inline list in its `{ product }` shape.
    const inline = result.inlineProducts ?? result.inline_products ?? [];
    const entityListings = (Array.isArray(result.entities) ? result.entities : [])
      .filter((entity) => entity?.product && typeof entity.product === 'object')
      .map((entity) => ({ product: entity.product, entity: entity.name ?? null }));
    return {
      text,
      citations,
      model: result.model || 'gpt-5-3-mini',
      shopping_cards: result.shoppingCards ?? result.shopping_cards ?? [],
      inline_products: [...(Array.isArray(inline) ? inline : []), ...entityListings],
    };
  }

  if (scraperId === 'google-aio') {
    const aio = result.aioverview;
    if (!aio) {
      throw new Error('Google did not return an AI Overview for this query');
    }

    const text = stripEntityMarkup(aio.markdown || aio.text || '');
    const citations = toCitations(aio.sources);

    return { text, citations, model: 'google-aio', shopping_cards: [] };
  }

  if (scraperId === 'google-aimode') {
    const aiMode = result.result || result;
    const text = stripEntityMarkup(aiMode.markdown || aiMode.text || '');
    const citations = toCitations(aiMode.sources);

    // AI Mode returns its product cards under camelCase `shoppingCards`
    // (like Copilot — verified against the live response; not snake_case).
    // Unwrap into the snake_case parsed key shared by all providers. Its
    // separate `inlineProducts` array is a different surface, out of scope.
    return {
      text,
      citations,
      model: 'google-aimode',
      shopping_cards: aiMode.shoppingCards ?? [],
    };
  }

  const text = stripEntityMarkup(result.markdown || result.text || '');
  const model = result.model || scraperId;
  const citations = toCitations(result.sources);

  return {
    text,
    citations,
    model,
    // Perplexity returns snake_case `shopping_cards`; Copilot returns
    // camelCase `shoppingCards`. Both write into the same prompt_results
    // .shopping_cards column raw, in their own provider shape — downstream
    // branches on `platform` to interpret. Other providers have neither key.
    shopping_cards: result.shopping_cards ?? result.shoppingCards ?? [],
    // Observed query fan-out (#332) — rich, engine-labelled; [] when absent.
    search_queries: normalizeSearchQueries(result, scraperId),
  };
}

/**
 * Submit a scraper task to the Cloro async queue.
 * @param {string} promptText
 * @param {string} scraperId
 * @param {string} [region]
 * @param {{ webhookUrl?: string, state?: string, location?: string, legacy?: boolean }} [opts] - `state` is the
 *   USPS code of the location this task targets (#554, per-prompt since
 *   #691); only forwarded on US AI-endpoint tasks. `location` is a city's or
 *   a US state's Google canonical name (googleLocationFor), forwarded on
 *   Google tasks only. `legacy` asks a `chatgpt-web` task for its fan-out
 *   (chatgptFanout.js).
 * @returns {Promise<{ taskId: string, scraperId: string, legacy: boolean }>} `legacy`: the
 *   task went to ChatGPT's legacy interface.
 * @throws {Error} with the HTTP `status` when Cloro answered the submission
 *   with an error; none when the request never got an answer.
 */
export async function submitScraperTask(promptText, scraperId, region, opts = {}) {
  const taskType = SCRAPER_TASK_TYPES[scraperId];
  if (!taskType) throw new Error(`Unknown scraper: ${scraperId}`);

  const payload = buildRequestBody(promptText, scraperId, region, opts.state, opts.location, {
    legacy: opts.legacy,
  });

  logger.info(
    {
      taskType,
      scraperId,
      region: region || 'US',
      state: payload.state,
      location: payload.location,
      legacy: payload.legacy,
    },
    'submitting cloro scraper task',
  );

  const requestBody = { taskType, payload };
  if (opts.webhookUrl) {
    requestBody.webhook = { url: opts.webhookUrl };
  }

  const res = await fetch(`${CLORO_API}/v1/async/task`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  if (!res.ok) {
    const errorBody = await res.text().catch(() => '');
    logger.error(
      { scraperId, status: res.status, body: errorBody.slice(0, 300) },
      'cloro submit failed',
    );
    throw Object.assign(
      new Error(`Cloro async submit error ${res.status}: ${errorBody.slice(0, 300)}`),
      { status: res.status },
    );
  }

  const data = await res.json();

  if (!data.success || !data.task?.id) {
    logger.error(
      { scraperId, response: JSON.stringify(data).slice(0, 300) },
      'cloro submit returned no task id',
    );
    throw new Error(`Cloro async submit failed: ${data.error || 'No task ID returned'}`);
  }

  logger.debug({ taskId: data.task.id, taskType, scraperId }, 'cloro task submitted');
  return { taskId: data.task.id, scraperId, legacy: payload.legacy === true };
}

/** A ChatGPT task sent to the legacy interface, which may go again without it. */
export function isLegacyChatgptTask({ scraperId, legacy }) {
  return scraperId === 'chatgpt-web' && legacy === true;
}

/**
 * Cloro turned the request itself down (400, 422), so the same task without
 * `legacy` can still be taken. Nothing else counts: a network error or a
 * timeout may have created the task already, and a second one would be
 * billed twice; 429, 5xx, 401 and 402 would fail the second one the same way.
 */
export function refusedRequest(err) {
  return err?.status === 400 || err?.status === 422;
}

/**
 * Submit one prompt's task for one tracked location code. Targeting comes
 * from the prompt's own location, not from the brand's single state column
 * (#691): different prompts can target different places, and a brand-wide
 * override would silently win over them.
 *
 * A `legacy` task (chatgptFanout.js) that Cloro refuses goes again without
 * it, since Cloro calls that interface temporary: the day's answer is still
 * tracked. The result says which one was sent.
 *
 * @param {{ promptText: string, scraperId: string, region: string|null, legacy?: boolean, webhookUrl?: string, promptId?: string }} task
 * @returns {Promise<{ taskId: string, scraperId: string, legacy: boolean }>}
 */
export async function submitPromptTask({
  promptText,
  scraperId,
  region,
  legacy = false,
  webhookUrl,
  promptId,
}) {
  // Google's engines take a city or a US state as `location`, the AI
  // endpoints a state as `state`; buildRequestBody gives each its own.
  const { country, state } = parseLocation(region);
  const submit = (withLegacy) =>
    submitScraperTask(promptText, scraperId, country, {
      webhookUrl,
      state,
      location: googleLocationFor(region),
      legacy: withLegacy,
    });
  if (!legacy) return submit(false);
  try {
    return await submit(true);
  } catch (err) {
    if (!refusedRequest(err)) throw err;
    logger.warn(
      { err, scraperId, promptId, status: err.status },
      'cloro refused the chatgpt fan-out task; submitting it without fan-out',
    );
    return submit(false);
  }
}

/**
 * Poll a Cloro async task until it completes or fails.
 * @param {string} taskId
 * @param {string} scraperId - needed to parse the response correctly
 * @param {{ maxWaitMs?: number, pollIntervalMs?: number }} [opts]
 * @returns {Promise<{ text: string, citations: Array, model: string, shopping_cards: Array }>}
 */
export async function pollScraperResult(taskId, scraperId, opts = {}) {
  const maxWait = opts.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  const interval = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const deadline = Date.now() + maxWait;
  let pollCount = 0;

  while (Date.now() < deadline) {
    pollCount++;
    const res = await fetch(`${CLORO_API}/v1/async/task/${taskId}`, {
      headers: { Authorization: `Bearer ${getApiKey()}` },
    });

    if (!res.ok) {
      if (res.status === 404) {
        logger.error({ taskId, pollCount }, 'cloro poll: task not found (404)');
        throw new Error(`Cloro task ${taskId} not found`);
      }
      const errorBody = await res.text().catch(() => '');
      logger.error({ taskId, pollCount, status: res.status }, 'cloro poll: http error');
      throw new Error(`Cloro poll error ${res.status}: ${errorBody.slice(0, 300)}`);
    }

    const data = await res.json();
    const status = data.task?.status;

    if (status === 'COMPLETED') {
      logger.debug({ taskId, scraperId, pollCount }, 'cloro task completed');
      const result = data.response;
      if (!result) throw new Error(`Cloro task ${taskId} completed but returned no response`);
      return parseScraperResponse(result, scraperId);
    }

    if (status === 'FAILED') {
      const errMsg = data.response?.error || data.task?.failedReason || 'Unknown failure';
      logger.error({ taskId, scraperId, pollCount, reason: errMsg }, 'cloro task failed');
      // `taskFailed`: Cloro took the task and gave up on it, which a legacy
      // ChatGPT task answers by going again without legacy.
      throw Object.assign(new Error(`Cloro task ${taskId} failed: ${errMsg}`), {
        taskFailed: true,
      });
    }

    if (pollCount === 1 || pollCount % 5 === 0) {
      logger.debug({ taskId, scraperId, status, pollCount }, 'cloro task polling');
    }

    await new Promise((r) => setTimeout(r, interval));
  }

  logger.error({ taskId, scraperId, pollCount, maxWaitMs: maxWait }, 'cloro task timed out');
  throw new Error(`Cloro task ${taskId} timed out after ${maxWait / 1000}s`);
}

/**
 * Run a prompt through a Cloro scraper (async submit + poll).
 * Drop-in replacement for the old sync runScraperPrompt.
 * @param {string} promptText
 * @param {string} scraperId
 * @param {string} [region]
 * @returns {Promise<{ text: string, citations: Array<{ url: string, title: string, startIndex: number, endIndex: number }>, model: string, shopping_cards: Array }>}
 */
export async function runScraperPrompt(promptText, scraperId, region) {
  const { taskId } = await submitScraperTask(promptText, scraperId, region);
  return pollScraperResult(taskId, scraperId);
}
