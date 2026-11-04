import { Router } from 'express';
import { resolveModel } from '../lib/aiProvider.js';
import { regionToLocationCode, languageToCode } from '../lib/dataforseoCodes.js';
import {
  requireFeature,
  enforceVolumeQuota,
  getVolumeQuotaStatus,
  PlanLimitError,
} from '../lib/planGuard.js';
import supabaseAdmin from '../config/supabase.js';
import { selectInChunks } from '../lib/chunkedIn.js';
import { assertBrandAccess, assertPromptAccess } from '../lib/access.js';
import { extractIntentKeywords } from '../lib/intentExtraction.js';
import {
  mapVolumeRow,
  fetchAndSaveVolumes,
  analyzeBrandVolumes,
  refreshBrandVolumes,
  getVolumeProgress,
} from '../lib/volumeAnalysis.js';
import logger from '../lib/logger.js';

const router = Router();

/**
 * Brands with a volume analysis in flight in this process. The work outlives
 * the request that starts it, so nothing else would stop a double-click from
 * starting a second pass over the same prompts.
 */
const runningBrands = new Map();

/**
 * Claim the brand, or report that someone already holds it. Claiming and
 * testing are one step on purpose: a check followed by an await leaves a gap
 * two clicks can both pass through.
 */
function claimVolumeAnalysis(brandId) {
  if (runningBrands.has(brandId)) return false;
  runningBrands.set(brandId, { done: 0, total: 0 });
  return true;
}

function trackVolumeProgress(brandId, progress) {
  if (runningBrands.has(brandId)) runningBrands.set(brandId, progress);
}

function releaseVolumeAnalysis(brandId) {
  runningBrands.delete(brandId);
}

/**
 * POST /api/volumes/analyze
 * First-time analysis: LLM extracts intent + keywords, then fetches volumes.
 * If keywords already exist for this prompt, only refreshes volumes (skips LLM).
 * Pass force=true to re-generate keywords via LLM even if they exist.
 */
router.post('/analyze', requireFeature('prompt_volumes'), async (req, res) => {
  try {
    const { remaining, orgId } = await enforceVolumeQuota(req.user.id);

    const { promptId, promptText, locationCode, languageCode, model, force } = req.body;

    if (!promptId || !promptText) {
      return res.status(400).json({ error: 'promptId and promptText are required' });
    }

    await assertPromptAccess(promptId, req.user.id);

    let resolvedLocationCode = locationCode;
    let resolvedLanguageCode = languageCode;
    if (resolvedLocationCode == null || resolvedLanguageCode == null) {
      const { data: brandRow } = await supabaseAdmin
        .from('prompts')
        .select('prompt_sets!inner(brands!inner(region, language))')
        .eq('id', promptId)
        .maybeSingle();
      const brand = brandRow?.prompt_sets?.brands;
      if (brand) {
        if (resolvedLocationCode == null) {
          resolvedLocationCode = regionToLocationCode(brand.region);
        }
        if (resolvedLanguageCode == null) {
          resolvedLanguageCode = languageToCode(brand.language);
        }
      }
    }

    let intent;
    let keywords;

    if (!force) {
      const { data: existing } = await supabaseAdmin
        .from('prompt_volumes')
        .select('intent, keywords')
        .eq('prompt_id', promptId)
        .single();

      if (existing?.keywords?.length) {
        intent = existing.intent;
        keywords = existing.keywords;
      }
    }

    if (!keywords) {
      const aiModel = resolveModel(model);
      const intentResult = await extractIntentKeywords(promptText, aiModel);
      intent = intentResult.intent;
      keywords = intentResult.keywords;
    }

    const saved = await fetchAndSaveVolumes(
      promptId,
      keywords,
      intent,
      resolvedLocationCode,
      resolvedLanguageCode,
    );

    if (orgId) {
      await supabaseAdmin.from('volume_usage').insert({
        organization_id: orgId,
        action: 'analyze',
        prompt_count: 1,
      });
    }

    const result = mapVolumeRow(saved);
    return res.json({ ...result, remaining: remaining === -1 ? -1 : remaining - 1 });
  } catch (error) {
    if (error instanceof PlanLimitError) {
      return res.status(error.statusCode).json({
        success: false,
        error: 'quota_exceeded',
        message: error.message,
      });
    }
    req.log.error({ err: error }, 'volume analysis error');
    return res.status(error.status || 500).json({
      error: 'Failed to analyze prompt volume',
      details: error.message,
    });
  }
});

/**
 * POST /api/volumes/analyze-batch
 * Body: { brandId, force? }
 *
 * Analysing a brand takes far longer than a request should be held open: each
 * prompt costs an LLM call plus a DataForSEO call and they run in order, which
 * measures at a 6.4s median — roughly eleven minutes for a 100-prompt brand.
 * So this starts the work and returns 202 immediately; the client follows
 * GET /status/:brandId. The previous shape took the prompts inline and refused
 * more than 50 of them, which made the Prompts page offer a button that a
 * brand of that size could never complete.
 *
 * force=true re-generates keywords for every active prompt; the default only
 * fills in prompts that have no volumes yet.
 */
router.post('/analyze-batch', requireFeature('prompt_volumes'), async (req, res) => {
  try {
    const { remaining, orgId } = await enforceVolumeQuota(req.user.id);

    const { brandId, locationCode, languageCode, force } = req.body;

    if (!brandId) {
      return res.status(400).json({ error: 'brandId is required' });
    }

    await assertBrandAccess(brandId, req.user.id);

    // A second click while the first run is still going would analyse every
    // prompt twice and bill the quota twice.
    if (!claimVolumeAnalysis(brandId)) {
      return res.status(202).json({ started: 0, running: true, remaining });
    }

    let started;
    try {
      const { total, analyzed } = await getVolumeProgress(brandId);
      started = force ? total : total - analyzed;
    } catch (err) {
      releaseVolumeAnalysis(brandId);
      throw err;
    }

    if (started <= 0) {
      releaseVolumeAnalysis(brandId);
      return res.json({ started: 0, running: false, remaining });
    }

    analyzeBrandVolumes(brandId, {
      locationCode,
      languageCode,
      force,
      onlyMissing: !force,
      onProgress: (progress) => trackVolumeProgress(brandId, progress),
    })
      .then(async (results) => {
        // Quota counts runs, not prompts, so this stays one row per click
        // however many prompts the run covered.
        const successCount = results.filter((r) => !r.error).length;
        if (successCount > 0 && orgId) {
          await supabaseAdmin.from('volume_usage').insert({
            organization_id: orgId,
            action: 'analyze-batch',
            prompt_count: successCount,
          });
        }
        logger.info({ brandId, analyzed: successCount, of: results.length }, 'volume run finished');
      })
      .catch((err) => {
        logger.error({ err, brandId }, 'batch volume analysis failed');
      })
      .finally(() => releaseVolumeAnalysis(brandId));

    return res.status(202).json({
      started,
      running: true,
      remaining: remaining === -1 ? -1 : remaining - 1,
    });
  } catch (error) {
    if (error instanceof PlanLimitError) {
      return res.status(error.statusCode).json({
        success: false,
        error: 'quota_exceeded',
        message: error.message,
      });
    }
    logger.error({ err: error }, 'batch volume analysis error');
    return res.status(error.status || 500).json({
      error: 'Failed to analyze prompt volumes',
      details: error.message,
    });
  }
});

/**
 * POST /api/volumes/bootstrap
 * The one automatic run a brand gets, at the end of its setup.
 *
 * Tracking starts the moment setup finishes, so Cloro is already scraping
 * while the user watches. Volumes were only ever started from the Stripe
 * success route, which meant a paying org's first brand got them and every
 * brand added afterwards got nothing until someone found the Analyze button.
 *
 * Deliberately outside the quota: the user did not ask for this run, so
 * spending one of a Starter plan's four analyses on it would take an
 * allowance they never offered. What bounds it instead is `analyzed`. A brand
 * with volumes has already had its free run, so the endpoint declines and the
 * quota-bearing /analyze-batch becomes the only way back in.
 */
router.post('/bootstrap', requireFeature('prompt_volumes'), async (req, res) => {
  try {
    const { brandId, locationCode, languageCode } = req.body;

    if (!brandId) {
      return res.status(400).json({ error: 'brandId is required' });
    }

    await assertBrandAccess(brandId, req.user.id);

    // Claim before reading the counts, not after: the read is awaited, and a
    // check that finishes before the claim leaves a gap two calls can both
    // pass through — which for a free run means paying DataForSEO twice.
    if (!claimVolumeAnalysis(brandId)) {
      return res.status(202).json({ started: 0, running: true });
    }

    let total;
    try {
      const progress = await getVolumeProgress(brandId);
      total = progress.total;
      if (progress.analyzed > 0 || total === 0) {
        releaseVolumeAnalysis(brandId);
        return res.json({ started: 0, running: false });
      }
    } catch (err) {
      releaseVolumeAnalysis(brandId);
      throw err;
    }

    analyzeBrandVolumes(brandId, {
      locationCode,
      languageCode,
      onlyMissing: true,
      onProgress: (progress) => trackVolumeProgress(brandId, progress),
    })
      .then((results) => {
        const successCount = results.filter((r) => !r.error).length;
        logger.info(
          { brandId, analyzed: successCount, of: results.length },
          'volume bootstrap finished',
        );
      })
      .catch((err) => {
        logger.error({ err, brandId }, 'volume bootstrap failed');
      })
      .finally(() => releaseVolumeAnalysis(brandId));

    return res.status(202).json({ started: total, running: true });
  } catch (error) {
    if (error instanceof PlanLimitError) {
      return res.status(error.statusCode).json({
        success: false,
        error: 'quota_exceeded',
        message: error.message,
      });
    }
    logger.error({ err: error }, 'volume bootstrap error');
    return res.status(error.status || 500).json({
      error: 'Failed to start volume analysis',
      details: error.message,
    });
  }
});

/**
 * GET /api/volumes/status/:brandId
 * Progress of a running analysis: { running, total, analyzed, done }.
 *
 * `done` is what the page counts against: during a run it is the number of
 * prompts whose keywords have been worked out, which is where the minutes go.
 * `analyzed` stays the number of rows on disk, which only moves at the end.
 *
 * `running` is per-process, so a server restart mid-run reports false while
 * rows are still being written. The client treats that as "stopped" and shows
 * what actually landed, which is the honest reading — the counts come from the
 * table either way.
 */
// Reads only: a workspace whose plan ended still sees what was analyzed.
const readVolumes = requireFeature('prompt_volumes', { readOnly: true });
router.get('/status/:brandId', readVolumes, async (req, res) => {
  try {
    const { brandId } = req.params;
    await assertBrandAccess(brandId, req.user.id);

    const { total, analyzed } = await getVolumeProgress(brandId);
    const live = runningBrands.get(brandId);

    // While a run is going, `analyzed` counts rows that are all written at the
    // very end — it would read 0 for the whole wait and then jump to the total.
    // The live counter tracks the work itself, so it moves throughout.
    return res.json({
      running: Boolean(live),
      total: live?.total || total,
      analyzed,
      done: live ? live.done : analyzed,
    });
  } catch (error) {
    if (error instanceof PlanLimitError) {
      return res.status(error.statusCode).json({
        success: false,
        error: 'quota_exceeded',
        message: error.message,
      });
    }
    logger.error({ err: error }, 'volume status error');
    return res.status(error.status || 500).json({ error: 'Failed to read volume status' });
  }
});

/**
 * POST /api/volumes/refresh
 * Refreshes Google volumes for all prompts that already have saved keywords.
 * Does NOT call LLM — only re-fetches DataForSEO volumes.
 * Body: { brandId, locationCode?, languageCode? }
 */
router.post('/refresh', requireFeature('prompt_volumes'), async (req, res) => {
  try {
    const { remaining, orgId } = await enforceVolumeQuota(req.user.id);

    const { brandId, locationCode, languageCode } = req.body;

    if (!brandId) {
      return res.status(400).json({ error: 'brandId is required' });
    }

    await assertBrandAccess(brandId, req.user.id);

    const results = await refreshBrandVolumes(brandId, { locationCode, languageCode });
    const refreshed = results.filter((r) => !r.error).length;

    if (refreshed > 0 && orgId) {
      await supabaseAdmin.from('volume_usage').insert({
        organization_id: orgId,
        action: 'refresh',
        prompt_count: refreshed,
      });
    }

    return res.json({
      results,
      refreshed,
      remaining: remaining === -1 ? -1 : remaining - 1,
    });
  } catch (error) {
    if (error instanceof PlanLimitError) {
      return res.status(error.statusCode).json({
        success: false,
        error: 'quota_exceeded',
        message: error.message,
      });
    }
    logger.error({ err: error }, 'volume refresh error');
    return res.status(error.status || 500).json({
      error: 'Failed to refresh volumes',
      details: error.message,
    });
  }
});

/**
 * GET /api/volumes/brand/:brandId
 */
router.get('/brand/:brandId', async (req, res) => {
  try {
    const { brandId } = req.params;
    await assertBrandAccess(brandId, req.user.id);

    const { data: promptSets, error: psError } = await supabaseAdmin
      .from('prompt_sets')
      .select('id')
      .eq('brand_id', brandId);

    if (psError) {
      req.log.error({ err: psError, brandId }, 'fetch prompt sets error');
      return res.status(500).json({
        error: 'Failed to fetch prompt sets',
        details: psError.message,
      });
    }

    if (!promptSets || promptSets.length === 0) {
      return res.json({ volumes: [] });
    }

    const setIds = promptSets.map((ps) => ps.id);

    const { data: prompts, error: pError } = await supabaseAdmin
      .from('prompts')
      .select('id, text, category, prompt_set_id')
      .in('prompt_set_id', setIds);

    if (pError) {
      req.log.error({ err: pError, brandId }, 'fetch prompts error');
      return res.status(500).json({ error: 'Failed to fetch prompts', details: pError.message });
    }

    if (!prompts || prompts.length === 0) {
      return res.json({ volumes: [] });
    }

    const promptIds = prompts.map((p) => p.id);

    // Chunked because this is the one filter that scales with the brand: the
    // largest brand's 402 prompts made a 15,792-character URL that the edge
    // rejected about a quarter of the time, and the page lost its volume and
    // competition columns whenever it did (see lib/chunkedIn.js).
    const { data: volumes, error: vError } = await selectInChunks(promptIds, (chunk) =>
      supabaseAdmin.from('prompt_volumes').select('*').in('prompt_id', chunk),
    );

    if (vError) {
      req.log.error({ err: vError, brandId, promptCount: promptIds.length }, 'fetch volumes error');
      return res.status(500).json({ error: 'Failed to fetch volumes', details: vError.message });
    }

    // Ordering moved off the query now that rows arrive per chunk.
    // `est_ai_volume` is NOT NULL, so this reproduces the previous
    // `.order('est_ai_volume', { ascending: false })` exactly.
    volumes.sort((a, b) => b.est_ai_volume - a.est_ai_volume);

    const promptMap = {};
    for (const p of prompts) {
      promptMap[p.id] = { text: p.text, category: p.category };
    }

    const enriched = (volumes || []).map((v) => ({
      ...mapVolumeRow(v),
      promptText: promptMap[v.prompt_id]?.text || '',
      promptCategory: promptMap[v.prompt_id]?.category || '',
    }));

    // Read-only once the plan has ended (2026-10-27): the volumes still come
    // back, with a quota of nothing left.
    const quota = await getVolumeQuotaStatus(req.user.id, { readOnly: true });

    return res.json({ volumes: enriched, quota });
  } catch (error) {
    if (error instanceof PlanLimitError) {
      return res.status(error.statusCode).json({
        success: false,
        error: 'plan_limit',
        message: error.message,
      });
    }
    req.log.error({ err: error }, 'fetch volumes error');
    return res.status(error.status || 500).json({
      error: 'Failed to fetch volume data',
      details: error.message,
    });
  }
});

export default router;
