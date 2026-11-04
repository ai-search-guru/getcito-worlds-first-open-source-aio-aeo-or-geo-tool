import { resolveModel } from './aiProvider.js';
import { regionToLocationCode, languageToCode } from './dataforseoCodes.js';
import supabaseAdmin from '../config/supabase.js';
import { isOrgActive } from './activeSubscriptions.js';
import { AI_VOLUME_MULTIPLIER, extractIntentKeywords } from './intentExtraction.js';
import { getSearchVolumes } from './dataforseo.js';
import { withRetry } from './retry.js';
import logger from './logger.js';

export function mapVolumeRow(saved) {
  return {
    id: saved.id,
    promptId: saved.prompt_id,
    intent: saved.intent,
    keywords: saved.keywords,
    googleVolumes: saved.google_volumes,
    totalGoogleVolume: saved.total_google_volume,
    aiVolumeMultiplier: parseFloat(saved.ai_volume_multiplier),
    estAiVolume: saved.est_ai_volume,
    competitionIndex: saved.competition_index ?? null,
    competition: saved.competition ?? null,
    locationCode: saved.location_code,
    languageCode: saved.language_code,
    fetchedAt: saved.fetched_at,
  };
}

/**
 * DataForSEO bills per request, not per keyword: one request carries up to
 * MAX_KEYWORDS_PER_REQUEST keywords, and a request for five costs exactly what
 * a request for a thousand costs ($0.09 on the live endpoint). Asking once per
 * prompt therefore multiplied the bill by the number of prompts — a 100-prompt
 * brand spent $9.00 doing the work of a single $0.09 request.
 */
const MAX_KEYWORDS_PER_REQUEST = 1000;

/** A progress listener is a courtesy to the UI; it never fails the run. */
function report(onProgress, progress) {
  if (!onProgress) return;
  try {
    onProgress(progress);
  } catch (err) {
    logger.warn({ err }, 'volume progress listener threw');
  }
}

/**
 * Look up every distinct keyword in as few requests as possible.
 *
 * A chunk is retried before it is given up on. It now carries up to two
 * hundred prompts' worth of work, so losing one to a provider blip costs far
 * more than it did when a failed request set back a single prompt.
 */
async function fetchVolumesForKeywords(keywords, { locationCode, languageCode }) {
  const distinct = [...new Set((keywords || []).map((k) => String(k).trim()).filter(Boolean))];
  const volumes = {};

  for (let i = 0; i < distinct.length; i += MAX_KEYWORDS_PER_REQUEST) {
    const chunk = distinct.slice(i, i + MAX_KEYWORDS_PER_REQUEST);
    const part = await withRetry(
      () =>
        getSearchVolumes(chunk, {
          locationCode: locationCode || undefined,
          languageCode: languageCode || undefined,
        }),
      { attempts: 3, label: 'dataforseo search_volume' },
    );
    Object.assign(volumes, part);
  }

  return { volumes, requests: Math.ceil(distinct.length / MAX_KEYWORDS_PER_REQUEST) };
}

/**
 * A prompt's Google volume: the median of its keywords that have any, rounded.
 *
 * The keywords are five head terms for the prompt's category
 * (intentExtraction.js), and they overlap: summing them counted the same
 * searchers several times over, and one very broad term (a product name such
 * as "google gemini", 5M a month) could set the whole figure. The median keeps
 * a prompt on its category's typical demand and leaves the extremes out, and
 * a keyword Google can't measure doesn't pull it down to 0.
 * 00154_prompt_volume_median.sql applies the same rule to stored rows.
 */
export function medianVolume(volumes) {
  const measured = volumes.filter((v) => v > 0).sort((a, b) => a - b);
  if (measured.length === 0) return 0;
  const mid = Math.floor(measured.length / 2);
  return Math.round(measured.length % 2 ? measured[mid] : (measured[mid - 1] + measured[mid]) / 2);
}

/**
 * Reduce one prompt's keywords against a volume map that may cover the whole
 * brand. google_volumes stays a { keyword: number } map for the UI, the
 * prompt's volume is their median (medianVolume), and competition is a
 * volume-weighted average of the keyword indices.
 *
 * Lookups are case-folded because the response echoes keywords in its own
 * normalised form; the stored key stays the returned one, so what lands in the
 * column is unchanged from when each prompt had the response to itself. Two
 * keywords that resolve to the same returned one count once.
 */
export function summarizeVolumes(keywords, volumes) {
  const byKeyword = new Map();
  for (const [keyword, data] of Object.entries(volumes)) {
    byKeyword.set(keyword.trim().toLowerCase(), [keyword, data]);
  }

  const googleVolumes = {};
  let competitionWeightedSum = 0;
  let competitionWeight = 0;

  for (const keyword of keywords || []) {
    const hit = byKeyword.get(String(keyword).trim().toLowerCase());
    if (!hit) continue;

    const [returnedKeyword, data] = hit;
    if (Object.hasOwn(googleVolumes, returnedKeyword)) continue;
    googleVolumes[returnedKeyword] = data.volume;
    if (data.competitionIndex !== null && data.competitionIndex !== undefined) {
      competitionWeightedSum += data.competitionIndex * data.volume;
      competitionWeight += data.volume;
    }
  }

  const competitionIndex =
    competitionWeight > 0 ? Math.round(competitionWeightedSum / competitionWeight) : null;
  const competition =
    competitionIndex === null
      ? null
      : competitionIndex <= 33
        ? 'LOW'
        : competitionIndex <= 66
          ? 'MEDIUM'
          : 'HIGH';

  // Stored as total_google_volume: the column predates the median.
  const googleVolume = medianVolume(Object.values(googleVolumes));
  return {
    googleVolumes,
    totalGoogleVolume: googleVolume,
    competitionIndex,
    competition,
    estAiVolume: Math.round(googleVolume * AI_VOLUME_MULTIPLIER),
  };
}

async function saveVolumeRow(promptId, intent, keywords, summary, locationCode, languageCode) {
  const { data: saved, error: dbError } = await supabaseAdmin
    .from('prompt_volumes')
    .upsert(
      {
        prompt_id: promptId,
        intent,
        keywords,
        google_volumes: summary.googleVolumes,
        total_google_volume: summary.totalGoogleVolume,
        ai_volume_multiplier: AI_VOLUME_MULTIPLIER,
        est_ai_volume: summary.estAiVolume,
        competition_index: summary.competitionIndex,
        competition: summary.competition,
        location_code: locationCode || null,
        language_code: languageCode || null,
        fetched_at: new Date().toISOString(),
      },
      { onConflict: 'prompt_id' },
    )
    .select()
    .single();

  if (dbError) throw new Error(dbError.message);
  return saved;
}

/**
 * Single-prompt path (POST /api/volumes/analyze). One prompt is one request
 * either way, so there is nothing to batch here.
 */
export async function fetchAndSaveVolumes(promptId, keywords, intent, locationCode, languageCode) {
  const { volumes } = await fetchVolumesForKeywords(keywords, { locationCode, languageCode });
  return saveVolumeRow(
    promptId,
    intent,
    keywords,
    summarizeVolumes(keywords, volumes),
    locationCode,
    languageCode,
  );
}

/**
 * Look the whole set up at once, then write each prompt's slice of the answer.
 *
 * A failed lookup fails every prompt it covered — that is the cost of asking
 * once instead of N times, and why the request retries first. A failed write
 * is still per-prompt.
 */
async function fetchAndStore(prepared, { locationCode, languageCode, brandId }) {
  const results = [];
  if (prepared.length === 0) return results;

  let volumes;
  let requests;
  const lookupStart = Date.now();
  try {
    ({ volumes, requests } = await fetchVolumesForKeywords(
      prepared.flatMap((p) => p.keywords || []),
      { locationCode, languageCode },
    ));
  } catch (err) {
    logger.error({ err, brandId, prompts: prepared.length }, 'volume lookup failed for brand');
    return prepared.map(({ promptId }) => ({ promptId, error: err.message }));
  }

  const lookupMs = Date.now() - lookupStart;
  const writeStart = Date.now();

  for (const { promptId, intent, keywords } of prepared) {
    try {
      const saved = await saveVolumeRow(
        promptId,
        intent,
        keywords,
        summarizeVolumes(keywords, volumes),
        locationCode,
        languageCode,
      );
      results.push(mapVolumeRow(saved));
    } catch (err) {
      logger.error({ err, promptId }, 'volume save failed for prompt');
      results.push({ promptId, error: err.message });
    }
  }

  // Split by phase so the next run answers "how long does this take now?"
  // without anyone having to guess which side the time went to.
  logger.info(
    {
      brandId,
      prompts: prepared.length,
      dataforseoRequests: requests,
      lookupMs,
      writeMs: Date.now() - writeStart,
    },
    'brand volume lookup complete',
  );

  return results;
}

/**
 * PostgREST caps an un-paginated select at 1000 rows, and an `.in()` filter
 * travels in the query string rather than the body — a brand near the
 * 1000-prompt ceiling would truncate silently on the first count and overflow
 * the request line on the second (#714, #740, #741). Both reads below page,
 * and scope through the prompt_sets embed so no list of prompt ids is ever
 * assembled.
 */
const PAGE_SIZE = 1000;

/**
 * Ceiling on what one brand can page in. A backend that kept answering full
 * pages would otherwise spin this loop forever, and the caller is a background
 * run with nobody waiting on it to notice. The largest brand allowed today
 * holds 1000 prompts, so this leaves an order of magnitude of headroom.
 */
const MAX_PAGED_ROWS = 50_000;

async function fetchAllPages(buildQuery) {
  const rows = [];
  for (let from = 0; from < MAX_PAGED_ROWS; from += PAGE_SIZE) {
    const { data, error } = await buildQuery().range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
  }
  return rows;
}

async function fetchPromptSetIds(brandId) {
  const { data, error } = await supabaseAdmin
    .from('prompt_sets')
    .select('id')
    .eq('brand_id', brandId);

  if (error) throw new Error(`Failed to fetch prompt sets: ${error.message}`);
  return (data || []).map((ps) => ps.id);
}

/**
 * Inactive prompts are tracked on no platform, so analysing one spends an LLM
 * call, a DataForSEO call and its share of the wait on a row no surface reads.
 */
function activePromptsQuery(setIds) {
  return supabaseAdmin
    .from('prompts')
    .select('id, text')
    .in('prompt_set_id', setIds)
    .eq('is_active', true)
    .order('id', { ascending: true });
}

function existingVolumesQuery(setIds) {
  return supabaseAdmin
    .from('prompt_volumes')
    .select('prompt_id, intent, keywords, prompts!inner(prompt_set_id)')
    .in('prompts.prompt_set_id', setIds)
    .order('prompt_id', { ascending: true });
}

/**
 * How much of a brand's active prompt set already carries volumes. This is the
 * pair the Prompts page polls while an analysis runs, so it stays two exact
 * counts — no rows travel, and the 1000-row cap cannot reach it.
 */
export async function getVolumeProgress(brandId) {
  const setIds = await fetchPromptSetIds(brandId);
  if (setIds.length === 0) return { total: 0, analyzed: 0 };

  const [{ count: total }, { count: analyzed }] = await Promise.all([
    supabaseAdmin
      .from('prompts')
      .select('*', { count: 'exact', head: true })
      .in('prompt_set_id', setIds)
      .eq('is_active', true),
    supabaseAdmin
      .from('prompt_volumes')
      .select('prompts!inner(prompt_set_id, is_active)', { count: 'exact', head: true })
      .in('prompts.prompt_set_id', setIds)
      .eq('prompts.is_active', true),
  ]);

  return { total: total || 0, analyzed: analyzed || 0 };
}

export async function analyzeBrandVolumes(
  brandId,
  { locationCode, languageCode, force = false, onlyMissing = false, onProgress } = {},
) {
  const { data: brand, error: brandError } = await supabaseAdmin
    .from('brands')
    .select('region, language, organization_id, is_demo')
    .eq('id', brandId)
    .maybeSingle();

  if (brandError) {
    throw new Error(`Failed to fetch brand: ${brandError.message}`);
  }
  if (!brand) {
    throw new Error(`Brand ${brandId} not found`);
  }
  // A demo brand's volumes (00380) are sample data, written with it.
  if (brand.is_demo) {
    logger.info({ brandId }, 'volume analysis skipped: demo brand');
    return [];
  }
  // Once the plan has ended (2026-10-27), no volume is looked up: every
  // prompt is a model call and a DataForSEO request. The internal trigger
  // (after a checkout) reaches here without the API's 402.
  if (!(await isOrgActive(brand.organization_id))) {
    logger.info({ brandId }, 'volume analysis skipped: no active plan');
    return [];
  }

  const resolvedLocationCode =
    locationCode ?? (brand.region ? regionToLocationCode(brand.region) : undefined);
  const resolvedLanguageCode =
    languageCode ?? (brand.language ? languageToCode(brand.language) : undefined);

  const setIds = await fetchPromptSetIds(brandId);
  if (setIds.length === 0) {
    return [];
  }

  const prompts = await fetchAllPages(() => activePromptsQuery(setIds));
  if (prompts.length === 0) {
    return [];
  }

  const existingMap = {};
  const existingPromptIds = new Set();

  if (!force || onlyMissing) {
    const existingRows = await fetchAllPages(() => existingVolumesQuery(setIds));

    for (const row of existingRows) {
      existingPromptIds.add(row.prompt_id);

      if (row.keywords?.length) {
        existingMap[row.prompt_id] = {
          intent: row.intent,
          keywords: row.keywords,
        };
      }
    }
  }

  let promptsToAnalyze = prompts;

  if (onlyMissing) {
    promptsToAnalyze = prompts.filter(({ id }) => !existingPromptIds.has(id));
  }

  const aiModel = resolveModel();
  const results = [];
  const prepared = [];
  const keywordStart = Date.now();

  // Nothing reaches prompt_volumes until the lookup at the end, so counting
  // rows would read 0 for the whole of this phase and then jump. Progress is
  // reported from here instead, where the work actually happens.
  report(onProgress, { done: 0, total: promptsToAnalyze.length });

  // Keywords first, one prompt at a time — a prompt with saved keywords costs
  // nothing here, the rest cost one LLM call each. This is now the only
  // per-prompt work in the run.
  for (const { id: promptId, text: promptText } of promptsToAnalyze) {
    try {
      const cached = existingMap[promptId];
      if (cached) {
        prepared.push({ promptId, intent: cached.intent, keywords: cached.keywords });
      } else {
        const { intent, keywords } = await extractIntentKeywords(promptText, aiModel);
        prepared.push({ promptId, intent, keywords });
      }
    } catch (err) {
      logger.error({ err, promptId }, 'keyword extraction failed for prompt');
      results.push({ promptId, error: err.message });
    }

    report(onProgress, {
      done: prepared.length + results.length,
      total: promptsToAnalyze.length,
    });
  }

  logger.info(
    { brandId, prompts: prepared.length, keywordMs: Date.now() - keywordStart },
    'brand keyword extraction complete',
  );

  results.push(
    ...(await fetchAndStore(prepared, {
      locationCode: resolvedLocationCode,
      languageCode: resolvedLanguageCode,
      brandId,
    })),
  );

  return results;
}

/**
 * Re-read Google volumes for every active prompt that already has keywords.
 * No LLM is involved, so the whole refresh is one DataForSEO request per 1000
 * keywords — it used to be one per prompt.
 */
export async function refreshBrandVolumes(brandId, { locationCode, languageCode } = {}) {
  const { data: brand, error: brandError } = await supabaseAdmin
    .from('brands')
    .select('region, language')
    .eq('id', brandId)
    .maybeSingle();

  if (brandError) throw new Error(`Failed to fetch brand: ${brandError.message}`);
  if (!brand) throw new Error(`Brand ${brandId} not found`);

  const resolvedLocationCode =
    locationCode ?? (brand.region ? regionToLocationCode(brand.region) : undefined);
  const resolvedLanguageCode =
    languageCode ?? (brand.language ? languageToCode(brand.language) : undefined);

  const setIds = await fetchPromptSetIds(brandId);
  if (setIds.length === 0) return [];

  const rows = await fetchAllPages(() => existingVolumesQuery(setIds));
  const prepared = rows
    .filter((row) => row.keywords?.length)
    .map((row) => ({ promptId: row.prompt_id, intent: row.intent, keywords: row.keywords }));

  return fetchAndStore(prepared, {
    locationCode: resolvedLocationCode,
    languageCode: resolvedLanguageCode,
    brandId,
  });
}
