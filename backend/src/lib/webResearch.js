import { generateText } from 'ai';
import { logger } from './logger.js';
import { resolveModel, webSearchTools } from './aiProvider.js';

/** A hung search must not hold the suggestion request open. */
const SEARCH_TIMEOUT_MS = 15_000;

/**
 * A quota or rate-limit wall on the grounded call. generateText already retried
 * a 429 twice before throwing, so by now the wall is not transient. Other
 * failures (auth, bad model, 5xx) are real and must reach the caller rather
 * than quietly turn into research without search.
 * @param {unknown} err
 */
export function isQuotaWall(err) {
  const e = err?.lastError ?? err;
  if (e?.statusCode === 429) return true;
  return /quota|rate.?limit|resource.?exhausted/i.test(String(e?.message ?? ''));
}

/**
 * One cheap plain-model call distills the research prompt into a short query,
 * the shape every SERP provider below wants.
 * @param {string} modelString - "provider/model"
 * @param {string} prompt
 * @returns {Promise<string>}
 */
async function distillQuery(modelString, prompt) {
  const { text: queryText } = await generateText({
    model: resolveModel(modelString),
    prompt: `Return ONE web search query (max 8 words, no quotes, no punctuation) to research this request:\n\n${prompt.slice(0, 500)}`,
  });
  return queryText
    .trim()
    .replace(/^["']+|["']+$/g, '')
    .split('\n')[0]
    .slice(0, 120);
}

/**
 * Research via Tavily when `TAVILY_API_KEY` is set. Provider search tools are
 * quota-gated on free keys — Google Search grounding 429s the whole suggestion
 * flow — so a SERP provider carries the search instead: the research call
 * distills the prompt into a short query once for the whole chain, the provider
 * fetches results, and a plain-model call synthesizes them. Any failure returns null
 * so the caller falls back to the next provider or no-search research.
 * @param {string} modelString - "provider/model"
 * @param {string} prompt
 * @param {string} query - the search query, distilled once by webResearch()
 * @returns {Promise<{ text: string, searched: boolean, sources: number } | null>}
 */
async function tavilyResearch(modelString, prompt, query) {
  const key = process.env.TAVILY_API_KEY;
  if (!key) return null;
  try {
    if (!query) throw new Error('empty search query');
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ query, max_results: 8, search_depth: 'basic' }),
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Tavily search HTTP ${res.status}`);
    const data = await res.json();
    const results = Array.isArray(data?.results) ? data.results : [];
    if (!results.length) throw new Error('Tavily returned no results');
    return await synthesize(
      modelString,
      prompt,
      results.map((r) => [r.title, r.url, r.content || '']),
      results.length,
    );
  } catch (err) {
    logger.warn({ err: err?.message }, 'tavily research failed; falling back');
    return null;
  }
}

/**
 * Research via Cloro's Google SERP endpoint when `CLORO_API_KEY` is set, a
 * natural second provider for installs that already hold a Cloro key for
 * tracking. Same distill-search-synthesize shape as Tavily; the free tier is
 * credit-capped per month, so failures here must stay quiet and fall through
 * rather than surface.
 */
async function cloroResearch(modelString, prompt, query) {
  const key = process.env.CLORO_API_KEY;
  if (!key) return null;
  try {
    if (!query) throw new Error('empty search query');
    const res = await fetch('https://api.cloro.dev/v1/monitor/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ query, country: process.env.WEB_RESEARCH_COUNTRY || 'US' }),
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Cloro search HTTP ${res.status}`);
    const data = await res.json();
    const results = Array.isArray(data?.result?.organicResults) ? data.result.organicResults : [];
    if (!results.length) throw new Error('Cloro returned no results');
    return await synthesize(
      modelString,
      prompt,
      results.map((r) => [r.title, r.link, r.snippet || '']),
      results.length,
    );
  } catch (err) {
    logger.warn({ err: err?.message }, 'cloro research failed; falling back');
    return null;
  }
}

/**
 * Research via Scrape.do's Google SERP plugin when `SCRAPEDO_API_KEY` is set.
 * The free tier bills 10 credits per search out of 1,000 a month, so it is
 * best kept late in the chain. Any failure returns null so the caller falls
 * through.
 */
async function scrapedoResearch(modelString, prompt, query) {
  const key = process.env.SCRAPEDO_API_KEY;
  if (!key) return null;
  try {
    if (!query) throw new Error('empty search query');
    const url =
      `https://api.scrape.do/plugin/google/search?token=${encodeURIComponent(key)}` +
      `&q=${encodeURIComponent(query)}&resolveGoto=true&hl=en&gl=${encodeURIComponent(
        (process.env.WEB_RESEARCH_COUNTRY || 'US').toLowerCase(),
      )}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`Scrape.do search HTTP ${res.status}`);
    const data = await res.json();
    const results = Array.isArray(data?.organic_results) ? data.organic_results : [];
    if (!results.length) throw new Error('Scrape.do returned no results');
    const top = results.slice(0, 10);
    return await synthesize(
      modelString,
      prompt,
      top.map((r) => [r.title, r.link, r.snippet || '']),
      top.length,
    );
  } catch (err) {
    logger.warn({ err: err?.message }, 'scrape.do research failed; falling back');
    return null;
  }
}

/**
 * The plain-model synthesis every SERP provider shares: turn the fetched
 * results into the research answer the caller asked for.
 */
async function synthesize(modelString, prompt, rows, sources) {
  const context = rows
    .map(([title, link, snippet]) => `[${title}](${link})\n${snippet}`)
    .join('\n\n');
  const { text } = await generateText({
    model: resolveModel(modelString),
    prompt: `${prompt}\n\nUse these web research results:\n${context}`,
  });
  return { text, searched: true, sources };
}

/** The SERP providers that can carry the search, each behind its own key. */
const SERP_PROVIDERS = [
  { name: 'tavily', keyEnv: 'TAVILY_API_KEY', search: tavilyResearch },
  { name: 'cloro', keyEnv: 'CLORO_API_KEY', search: cloroResearch },
  { name: 'scrapedo', keyEnv: 'SCRAPEDO_API_KEY', search: scrapedoResearch },
];

/**
 * The providers that will actually run, in order: `WEB_RESEARCH_PROVIDERS`
 * (comma-separated, default `tavily`) names them and their
 * order, so Cloro and Scrape.do are opt-in
 * (`WEB_RESEARCH_PROVIDERS=tavily,cloro,scrapedo`): an install that already
 * holds a Cloro or Scrape.do key for tracking or Site Audit should not start
 * spending those credits on suggestion research it never signed up for.
 * Unknown names are ignored and a provider without its API key is skipped, so
 * an install that holds only a Tavily key behaves exactly as it did before
 * this chain existed.
 * @returns {Array<{ name: string, keyEnv: string, search: (modelString: string, prompt: string, query: string) => Promise<{ text: string, searched: boolean, sources: number } | null> }>}
 */
export function serpProviderOrder() {
  const requested = (process.env.WEB_RESEARCH_PROVIDERS || 'tavily')
    .split(',')
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);
  const byName = new Map(SERP_PROVIDERS.map((provider) => [provider.name, provider]));
  return requested.map((name) => byName.get(name)).filter((p) => p && process.env[p.keyEnv]);
}

/**
 * The research phase of the suggestion routes: one generateText call, with web
 * search attached when available — the SERP providers in `WEB_RESEARCH_PROVIDERS`
 * order (Tavily by default; Cloro and Scrape.do opt-in), then the provider's own
 * tool. The search query is distilled once for the whole chain, not once per
 * provider, so a quota wall on that call cannot repeat itself down the line.
 * Returns the text plus how many sources the answer drew on, so callers can
 * log it — a research step that silently stops searching shows up as
 * `sources: 0` instead of as suggestions that are quietly worse.
 *
 * A quota failure on the provider's grounded call falls back to research from
 * the model's own knowledge: a suggestion flow that survives beats one that
 * 500s, and `searched: false` keeps the downgrade visible in the logs.
 *
 * @param {string} modelString - "provider/model"
 * @returns {Promise<{ text: string, searched: boolean, sources: number }>}
 */
export async function webResearch(modelString, prompt) {
  const providers = serpProviderOrder();
  let query = '';
  if (providers.length) {
    try {
      query = await distillQuery(modelString, prompt);
    } catch (err) {
      logger.warn({ err: err?.message }, 'query distillation failed; skipping the SERP chain');
    }
  }
  if (query) {
    for (const provider of providers) {
      const result = await provider.search(modelString, prompt, query);
      if (result) return result;
    }
  }

  const tools = webSearchTools(modelString);
  if (tools) {
    try {
      const result = await generateText({
        model: resolveModel(modelString),
        prompt,
        tools,
      });
      return { text: result.text, searched: true, sources: result.sources?.length ?? 0 };
    } catch (err) {
      if (!isQuotaWall(err)) throw err;
      logger.warn(
        { err: err?.message },
        'provider search-grounded research failed; falling back to no-search research',
      );
    }
  }
  const result = await generateText({ model: resolveModel(modelString), prompt });
  return { text: result.text, searched: false, sources: 0 };
}
