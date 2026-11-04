/**
 * The demo brand's core (demo-core): the brand itself, its domain, engines,
 * competitors, topics and tracked prompts with their volumes, and a month of
 * tracked answers with their citations, product cards and searches.
 *
 * The answers go through tracking's own code wherever it is pure: a raw
 * answer in each engine's own shape is parsed by parseScraperResponse,
 * scored by parseResponse and stored as resultRow and shoppingCardRows build
 * it, so Brand Visibility, Prompts, Mentions, Citations and Query Fan-out
 * read them like any brand's. The rollups those pages read are then rebuilt
 * by the same functions the nightly run calls; nothing here writes one.
 *
 * Lean on purpose, as every no-card signup gets a demo: 12 prompts, 6
 * engines, a run every 3 days over a month (720 short answers).
 */

import supabaseAdmin from '../../config/supabase.js';
import { parseScraperResponse } from '../cloroScraper.js';
import { resultRow, shoppingCardRows } from '../cloroResultHandler.js';
import { normalizeCitations } from '../citationRows.js';
import { dayChunks, HISTORY_CHUNK_DAYS, refreshCitationsDaily } from '../citationsRollups.js';
import { AI_VOLUME_MULTIPLIER } from '../intentExtraction.js';
import { refreshInsightsDaily, utcDay } from '../insightsRollups.js';
import { refreshMentionsDaily, refreshPerceptionSnapshots } from '../mentionsRollups.js';
import { parseResponse } from '../responseParser.js';
import { summarizeVolumes } from '../volumeAnalysis.js';
import {
  BRAND,
  BRAND_TRAITS,
  CLOSINGS,
  COMPETITORS,
  PLATFORMS,
  PRODUCTS,
  PROMPTS,
  SOURCES,
  TOPICS,
} from './brewline.js';
import { demoId, seededRandom } from './random.js';
import { allSettledOrThrow, demoWriter } from './write.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Tracked runs, every RUN_EVERY_DAYS days back from the latest. */
export const RUNS = 10;
export const RUN_EVERY_DAYS = 3;
/** When the nightly run starts (UTC hour), as the self-hosted cron's default. */
const RUN_HOUR_UTC = 6;
/** Seconds between two answers of a run: 72 answers take half an hour. */
const ANSWER_GAP_MS = 25_000;
/** The last runs whose shopping answers carry product cards. */
const SHOPPING_RUNS = 4;
/** The engines that show product cards, as they do live. */
const CARD_PLATFORMS = new Set(['perplexity-web', 'google-aimode', 'copilot-web']);
const REGION = 'US';
const LOCATION_CODE = 2840;
const SEED = 'brewline';

/** How much more (or less) often a prompt's answers name Brewline. */
const PROMPT_BIAS = {
  freshness: 0.12,
  'buy-online': 0.08,
  gift: -0.05,
  'fair-trade': -0.12,
  'low-acid': -0.18,
};

/** The Brewline page an answer to the prompt cites, and the product it shows. */
const BRAND_PAGE = {
  espresso: '/coffee/espresso-roast',
  decaf: '/coffee/decaf',
  gift: '/gifts',
  freshness: '/blog/how-fresh-should-coffee-beans-be',
  'worth-it': '/blog/how-fresh-should-coffee-beans-be',
};
const BRAND_PRODUCT = {
  espresso: '/coffee/espresso-roast',
  'buy-online': '/coffee/espresso-roast',
  decaf: '/coffee/decaf',
};

const url = (domain, path) => `https://${domain}${path}`;

/**
 * When the latest run started: today's RUN_HOUR_UTC, or yesterday's when
 * today's would not have finished an hour ago.
 */
export function latestRunStart(now) {
  const day = new Date(now);
  day.setUTCHours(RUN_HOUR_UTC, 0, 0, 0);
  if (day.getTime() + 60 * 60 * 1000 > now.getTime()) day.setUTCDate(day.getUTCDate() - 1);
  return day;
}

/** When the demo's first answer was given: the first run's first answer. */
export function firstAnswerAt(now) {
  return new Date(
    latestRunStart(now).getTime() - (RUNS - 1) * RUN_EVERY_DAYS * DAY_MS + ANSWER_GAP_MS,
  );
}

function priceText(amount) {
  return `$${amount.toFixed(2)}`;
}

/** A product card in the engine's own shape (as Cloro returns it). */
function rawCards(platformId, products) {
  const owner = (product) =>
    product.owner === 'brand'
      ? { name: BRAND.name, domain: BRAND.domain }
      : COMPETITORS.find((c) => c.key === product.owner);
  if (platformId === 'perplexity-web') {
    return products.map((p) => ({
      title: p.title,
      brand: owner(p).name,
      price: priceText(p.price),
      url: url(owner(p).domain, p.path),
      rating: p.rating,
      review_count: p.reviews,
    }));
  }
  if (platformId === 'google-aimode') {
    return products.map((p) => ({
      title: p.title,
      brand: owner(p).name,
      price: priceText(p.price),
      url: url(owner(p).domain, p.path),
      rating: p.rating,
      reviewCount: p.reviews,
    }));
  }
  // Copilot wraps its products (parseCopilotCard).
  return [
    {
      type: 'shoppingProducts',
      layout: 'carousel',
      products: products.map((p, i) => ({
        position: i + 1,
        name: p.title,
        brandName: owner(p).name,
        seller: owner(p).name,
        price: priceText(p.price),
        url: url(owner(p).domain, p.path),
        rating: { value: p.rating, count: p.reviews },
      })),
    },
  ];
}

/** The answer's text: a lead, the brands it names in order, a closing line. */
function answerText(prompt, named, rng) {
  const lines = named.map(({ name, trait }, i) =>
    prompt.intent === 'best-top' || prompt.intent === 'recommendation'
      ? `${i + 1}. **${name}** ${trait}.`
      : `**${name}** ${trait}.`,
  );
  return [prompt.lead, lines.join('\n'), rng.pick(CLOSINGS)].join('\n\n');
}

/** The pages one answer cites: Brewline's, the named competitors', then publishers'. */
function answerSources(prompt, platform, { brandNamed, competitorsNamed, progress }, rng) {
  const count = rng.int(platform.citations[0], platform.citations[1]);
  const picked = [];
  if (brandNamed && rng.chance(0.5 + 0.2 * progress)) {
    const path = BRAND_PAGE[prompt.key] ?? '/subscriptions';
    const page = SOURCES.brand.find((p) => p.path === path);
    picked.push({ url: url(BRAND.domain, page.path), label: page.label });
  }
  for (const competitor of competitorsNamed) {
    if (picked.length >= count || !rng.chance(0.35)) continue;
    const page = rng.pick(SOURCES.competitor[competitor.key]);
    picked.push({ url: url(competitor.domain, page.path), label: page.label });
  }
  const publisherPages = rng.shuffle(
    SOURCES.publishers.flatMap((p) =>
      p.pages.map((page) => ({ url: url(p.domain, page.path), label: page.label })),
    ),
  );
  for (const page of publisherPages) {
    if (picked.length >= count) break;
    picked.push(page);
  }
  return picked;
}

/** The product cards a shopping answer shows: Brewline's when it is named, then rivals'. */
function answerProducts(prompt, { brandNamed, competitorsNamed }, rng) {
  const products = [];
  if (brandNamed ? rng.chance(0.85) : rng.chance(0.25)) {
    const path = BRAND_PRODUCT[prompt.key] ?? '/subscriptions/house-blend';
    products.push(PRODUCTS.find((p) => p.owner === 'brand' && p.path === path));
  }
  for (const competitor of rng.shuffle(competitorsNamed)) {
    if (products.length >= 3) break;
    products.push(PRODUCTS.find((p) => p.owner === competitor.key));
  }
  return products.filter(Boolean);
}

/**
 * One tracked answer: what the engine returned, in its own shape, before
 * tracking parses it.
 */
function rawAnswer(prompt, platform, { run, progress }) {
  const rng = seededRandom(`${SEED}:${run}:${prompt.key}:${platform.id}`);

  const mentionChance =
    platform.mention[0] +
    (platform.mention[1] - platform.mention[0]) * progress +
    (PROMPT_BIAS[prompt.key] ?? 0);
  const brandNamed = Boolean(prompt.namesBrand) || rng.chance(mentionChance);
  const competitorsNamed = COMPETITORS.filter(
    (c) => (prompt.namesBrand && c.key === 'northbound') || rng.chance(c.presence),
  );
  // An answer names two brands at least.
  for (const competitor of COMPETITORS) {
    if (competitorsNamed.length + (brandNamed ? 1 : 0) >= 2) break;
    if (!competitorsNamed.includes(competitor)) competitorsNamed.push(competitor);
  }

  let sentiment = 'neutral';
  if (brandNamed) {
    const roll = rng.next();
    sentiment = roll < 0.66 + 0.1 * progress ? 'positive' : roll > 0.93 ? 'negative' : 'neutral';
  }

  let named = rng
    .shuffle(competitorsNamed)
    .map((c) => ({ name: c.name, trait: rng.pick(c.traits) }));
  if (brandNamed) {
    const own = { name: BRAND.name, trait: rng.pick(BRAND_TRAITS[sentiment]) };
    // Named first more often as the month goes on: the demo's visibility climbs.
    const at = rng.chance(0.25 + 0.35 * progress) ? 0 : rng.int(0, named.length);
    named = [...named.slice(0, at), own, ...named.slice(at)];
  }

  const sources = answerSources(prompt, platform, { brandNamed, competitorsNamed, progress }, rng);
  const raw = { text: answerText(prompt, named, rng), sources };

  if (platform.fanout) {
    const searches = rng.shuffle(prompt.searches).slice(0, rng.int(1, prompt.searches.length));
    if (platform.fanout === 'perplexity') raw.search_model_queries = searches;
    else raw.searchQueries = searches;
  }

  if (prompt.shopping && run >= RUNS - SHOPPING_RUNS && CARD_PLATFORMS.has(platform.id)) {
    const products = rng.chance(0.75)
      ? answerProducts(prompt, { brandNamed, competitorsNamed }, rng)
      : [];
    if (products.length > 0) {
      const cards = rawCards(platform.id, products);
      if (platform.id === 'perplexity-web') raw.shopping_cards = cards;
      else raw.shoppingCards = cards;
    }
  }

  // The engines' own envelopes (parseScraperResponse).
  if (platform.id === 'google-aio') return { raw: { aioverview: raw }, sentiment };
  if (platform.id === 'google-aimode') return { raw: { result: raw }, sentiment };
  return { raw, sentiment };
}

/**
 * Every core row of the demo brand, built in memory: deterministic but for
 * the dates, which count back from `now`. Pure, so a test can pin it.
 *
 * @param {{ brandId: string, now: Date }} args
 */
export function coreRows({ brandId, now }) {
  const id = (key) => demoId(brandId, key);
  const latest = latestRunStart(now);
  const runStarts = Array.from(
    { length: RUNS },
    (_, i) => new Date(latest.getTime() - (RUNS - 1 - i) * RUN_EVERY_DAYS * DAY_MS),
  );
  // The brand was set up a few days before its first run.
  const since = new Date(runStarts[0].getTime() - 5 * DAY_MS).toISOString();

  const brand = {
    name: BRAND.name,
    industry: BRAND.industry,
    description: BRAND.description,
    region: BRAND.region,
    language: BRAND.language,
    site_type: BRAND.siteType,
    shopping_mode_enabled: true,
    is_active: true,
    // The app ships the made-up brand's logo (frontend/public/demo/logos).
    logo_url: '/demo/logos/brewline.svg',
    created_at: since,
  };
  const brandInfo = { brandName: BRAND.name, domains: [BRAND.domain] };

  const domains = [
    {
      id: id('domain'),
      brand_id: brandId,
      domain: BRAND.domain,
      country: REGION,
      is_primary: true,
      created_at: since,
    },
  ];
  const competitors = COMPETITORS.map((c) => ({
    id: id(`competitor:${c.key}`),
    brand_id: brandId,
    name: c.name,
    domain: c.domain,
    created_at: since,
  }));
  const tracked = competitors.map(({ id: competitorId, name, domain }) => ({
    id: competitorId,
    name,
    domain,
  }));
  const topics = TOPICS.map((t) => ({
    id: id(`topic:${t.key}`),
    brand_id: brandId,
    name: t.name,
    is_active: true,
    created_at: since,
  }));
  const promptSetId = id('prompt-set');
  const promptSets = [{ id: promptSetId, brand_id: brandId, name: 'Default', created_at: since }];
  const platformIds = PLATFORMS.map((p) => p.id);
  const prompts = PROMPTS.map((p) => ({
    id: id(`prompt:${p.key}`),
    prompt_set_id: promptSetId,
    text: p.text,
    category: TOPICS.find((t) => t.key === p.topic).name,
    topic_id: id(`topic:${p.topic}`),
    platforms: platformIds,
    regions: [REGION],
    models: [],
    is_active: true,
    created_at: since,
  }));
  const volumes = PROMPTS.map((p) => {
    const keywords = Object.keys(p.keywords);
    const summary = summarizeVolumes(
      keywords,
      Object.fromEntries(
        Object.entries(p.keywords).map(([k, [volume, competitionIndex]]) => [
          k,
          { volume, competitionIndex },
        ]),
      ),
    );
    return {
      prompt_id: id(`prompt:${p.key}`),
      intent: p.intent,
      keywords,
      google_volumes: summary.googleVolumes,
      total_google_volume: summary.totalGoogleVolume,
      ai_volume_multiplier: AI_VOLUME_MULTIPLIER,
      est_ai_volume: summary.estAiVolume,
      competition_index: summary.competitionIndex,
      competition: summary.competition,
      location_code: LOCATION_CODE,
      language_code: BRAND.language,
      fetched_at: since,
    };
  });

  const runs = [];
  const results = [];
  const citations = [];
  const shoppingCards = [];
  runStarts.forEach((startedAt, run) => {
    const progress = run / (RUNS - 1);
    let at = startedAt.getTime();
    for (const prompt of PROMPTS) {
      for (const platform of PLATFORMS) {
        at += ANSWER_GAP_MS;
        const createdAt = new Date(at).toISOString();
        const resultId = id(`result:${run}:${prompt.key}:${platform.id}`);
        const promptId = id(`prompt:${prompt.key}`);
        const { raw, sentiment } = rawAnswer(prompt, platform, { run, progress });
        const aiResponse = parseScraperResponse(raw, platform.id);
        const metrics = parseResponse(aiResponse, brandInfo, sentiment, tracked);
        results.push({
          id: resultId,
          ...resultRow({
            aiResponse,
            scraperId: platform.id,
            promptId,
            brandId,
            region: REGION,
            metrics,
          }),
          created_at: createdAt,
        });
        for (const entry of normalizeCitations(aiResponse.citations)) {
          citations.push({ ...entry, prompt_result_id: resultId, created_at: createdAt });
        }
        for (const card of shoppingCardRows({
          promptResultId: resultId,
          brandId,
          platform: platform.id,
          region: REGION,
          rawCards: aiResponse.shopping_cards ?? [],
          brandInfo: { brandId, ...brandInfo },
          competitors: tracked,
        })) {
          shoppingCards.push({ ...card, created_at: createdAt });
        }
      }
    }
    const completedAt = new Date(at + 2 * 60 * 1000).toISOString();
    runs.push({
      id: id(`run:${run}`),
      brand_id: brandId,
      source: 'cron',
      started_at: startedAt.toISOString(),
      completed_at: completedAt,
      result_count: PROMPTS.length * PLATFORMS.length,
      created_at: startedAt.toISOString(),
    });
  });

  const lastChecked = runs.at(-1).completed_at;
  const platforms = PLATFORMS.map((p) => ({
    id: id(`platform:${p.id}`),
    brand_id: brandId,
    platform: p.id,
    is_enabled: true,
    check_frequency: 'daily',
    api_model: null,
    last_checked_at: lastChecked,
    created_at: since,
  }));

  return {
    brand,
    domains,
    platforms,
    competitors,
    topics,
    promptSets,
    prompts,
    volumes,
    runs,
    results,
    citations,
    shoppingCards,
  };
}

/** Citation rows per statement: they are small. */
const CITATION_CHUNK = 1000;
/** The demo's month of answer terms is refreshed in one call: it is small. */
const TERM_DAYS = 31;

/** The cited URLs' ids in the shared dictionary (#732), resolved in one call. */
async function citationUrlIds(db, entries) {
  const byUrl = new Map();
  for (const entry of entries) {
    if (!byUrl.has(entry.url)) byUrl.set(entry.url, entry);
  }
  if (byUrl.size === 0) return new Map();
  const { data, error } = await db.rpc('citation_url_ids', {
    p_urls: [...byUrl.values()].map(({ url: u, domain, title }) => ({ url: u, domain, title })),
  });
  if (error) throw new Error(`demo citation url resolve: ${error.message}`);
  return new Map((data ?? []).map((row) => [row.url, row.id]));
}

/** The citation rows, each pointing at its URL's id. */
function citationRows(brandId, entries, ids) {
  return entries.map((entry) => ({
    prompt_result_id: entry.prompt_result_id,
    position: entry.position,
    url_id: ids.get(entry.url),
    brand_id: brandId,
    created_at: entry.created_at,
  }));
}

/** The first UTC day of the brand's rollups, or null without any. */
async function firstRollupDay(db, brandId) {
  const { data, error } = await db
    .from('insights_brand_daily')
    .select('day')
    .eq('brand_id', brandId)
    .order('day')
    .limit(1);
  if (error) throw new Error(`demo rollup days read: ${error.message}`);
  return data?.[0]?.day ?? null;
}

/**
 * Rebuild the rollups the pages read, over the demo's whole month, with the
 * nightly run's own functions; Insights, Citations and Mentions side by side
 * (each takes its own lock), the Perception views once the Mentions rollups
 * are in. Each refresh call rewrites its days in one statement, so a page
 * read meanwhile sees the old days or the new ones, never none. Throws when
 * one fails: a demo with empty charts is rebuilt on the next visit instead
 * of shown.
 */
async function refreshRollups(brandId, dayFrom, dayTo) {
  const citations = async () => {
    for (const [from, to] of dayChunks(dayFrom, dayTo, HISTORY_CHUNK_DAYS)) {
      if (!(await refreshCitationsDaily(brandId, from, to))) return false;
    }
    return true;
  };
  const mentions = async () => {
    const options = { termDays: TERM_DAYS, together: true };
    if (!(await refreshMentionsDaily(brandId, dayFrom, dayTo, options))) {
      return false;
    }
    await refreshPerceptionSnapshots(brandId);
    return true;
  };
  const [insightsOk, citationsOk, mentionsOk] = await Promise.all([
    refreshInsightsDaily(brandId, dayFrom, dayTo),
    citations(),
    mentions(),
  ]);
  if (!insightsOk) throw new Error('demo insights rollups failed');
  if (!citationsOk) throw new Error('demo citation rollups failed');
  if (!mentionsOk) throw new Error('demo mention rollups failed');
}

/** The core module's key columns where a row has no `id` of its own. */
const KEYS = {
  prompt_volumes: 'prompt_id',
  prompt_result_citations: 'prompt_result_id,position',
  prompt_result_shopping_cards: 'prompt_result_id,position',
};
/** Its tables without a brand_id, found through the table they point at. */
const SCOPES = {
  prompts: ['prompt_set_id', 'prompt_sets'],
  prompt_volumes: ['prompt_id', 'prompts'],
};

/**
 * The core module: its brand-scoped tables, in the order they are written
 * (a rebuild of a module that isn't rebuilt in place clears them in
 * reverse), its build, which writes its rows, and its refresh, which
 * rebuilds the rollups from them.
 */
export const core = {
  name: 'core',
  // Rebuilt in place: rows are written over, the ones not written again
  // deleted after (write.js).
  inPlace: true,
  keys: KEYS,
  scopes: SCOPES,
  tables: [
    // Written here.
    'brand_domains',
    'brand_platforms',
    'competitors',
    'topics',
    'prompt_sets', // and, through it, prompts and prompt_volumes
    'tracking_runs',
    'prompt_results',
    'prompt_result_citations',
    'prompt_result_shopping_cards',
    // Kept by triggers on prompts.
    'prompt_usage_counters',
    // Rebuilt by the rollup functions (refresh).
    'insights_brand_daily',
    'insights_prompt_daily',
    'insights_competitor_daily',
    'insights_competitor_prompt_daily',
    'citation_result_daily',
    'citation_url_daily',
    'citation_domain_daily',
    'citation_gap_domain_daily',
    'citation_gap_competitor_daily',
    'mentions_prompt_daily',
    'mentions_competitor_daily',
    'mentions_entities_daily',
    'mentions_answer_terms',
    'mentions_terms_daily',
    'mentions_perception_snapshots',
    // Queued by the prompt and domain triggers while the demo is rewritten;
    // cleared once the rollups above are rebuilt.
    'insights_rollup_rebuilds',
    'citation_rollup_rebuilds',
  ],

  /**
   * Writes the brand, its setup and its month of answers, each step's
   * independent tables side by side. `write` is the build's writer
   * (write.js); without one (a test), a writer over `db` for a first build.
   *
   * @param {{ brandId: string, now: Date, db?: object, rebuild?: boolean, write?: Function }} ctx
   */
  async build({
    brandId,
    now,
    db = supabaseAdmin,
    rebuild = false,
    write = demoWriter({ db, brandId, rebuild, keys: KEYS, scopes: SCOPES }).write,
  }) {
    const rows = coreRows({ brandId, now });

    const { error: brandError } = await db.from('brands').update(rows.brand).eq('id', brandId);
    if (brandError) throw new Error(`demo brand update: ${brandError.message}`);

    // What nothing else points into, and the cited URLs' ids.
    const [urlIds] = await allSettledOrThrow([
      citationUrlIds(db, rows.citations),
      write('brand_domains', rows.domains),
      write('brand_platforms', rows.platforms),
      write('competitors', rows.competitors),
      write('topics', rows.topics),
      write('prompt_sets', rows.promptSets),
      write('tracking_runs', rows.runs),
    ]);
    // The prompts point at their topic and set; their volumes and answers at them.
    await write('prompts', rows.prompts);
    await allSettledOrThrow([
      write('prompt_volumes', rows.volumes),
      write('prompt_results', rows.results),
    ]);
    // What the answers cite and show.
    await allSettledOrThrow([
      write('prompt_result_citations', citationRows(brandId, rows.citations, urlIds), {
        chunk: CITATION_CHUNK,
      }),
      write('prompt_result_shopping_cards', rows.shoppingCards),
    ]);

    return {
      prompts: rows.prompts.length,
      results: rows.results.length,
      citations: rows.citations.length,
      shoppingCards: rows.shoppingCards.length,
    };
  },

  /**
   * Rebuilds the rollups over the demo's month; on a rebuild, from the old
   * month's first day on, so the days it no longer covers are emptied.
   *
   * @param {{ brandId: string, now: Date, db?: object, rebuild?: boolean }} ctx
   */
  async refresh({ brandId, now, db = supabaseAdmin, rebuild = false }) {
    const dayTo = utcDay(now.toISOString());
    let dayFrom = utcDay(firstAnswerAt(now).toISOString());
    if (rebuild) {
      const previous = await firstRollupDay(db, brandId);
      if (previous && previous < dayFrom) dayFrom = previous;
    }
    await refreshRollups(brandId, dayFrom, dayTo);

    // The rebuilds the triggers queued are done: the rollups were rebuilt whole.
    await allSettledOrThrow(
      ['insights_rollup_rebuilds', 'citation_rollup_rebuilds'].map(async (table) => {
        const { error } = await db.from(table).delete().eq('brand_id', brandId);
        if (error) throw new Error(`demo ${table} clear: ${error.message}`);
      }),
    );
  },
};
