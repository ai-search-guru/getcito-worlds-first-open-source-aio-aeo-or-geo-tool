import { Router } from 'express';
import supabaseAdmin from '../config/supabase.js';
import { assertBrandAccess } from '../lib/access.js';
import { deleteBrand } from '../lib/brandDelete.js';
import { applySiteTypeDetection } from '../lib/siteTypeDetect.js';
import { checkTrackingSnippet } from '../lib/trackingSnippetCheck.js';
import { snippetCheckLimiter } from '../middleware/rateLimiter.js';

const router = Router();

/**
 * How long the request waits for the delete before answering that it is
 * still running. Most brands are gone well within it; the largest take
 * minutes, and the deletion carries on after the response.
 */
const WAIT_MS = 20_000;

/**
 * DELETE /api/brands/:id
 * Deletes a brand and all its data. Admins only, as the brands delete policy
 * allows. 200 when it is gone, 202 when it is still being deleted. Never the
 * demo brand (00380): it is hidden, not deleted (PATCH /api/demo).
 */
router.delete('/:id', async (req, res) => {
  try {
    const brandId = req.params.id;
    await assertBrandAccess(brandId, req.user.id);

    const { data: target, error: targetError } = await supabaseAdmin
      .from('brands')
      .select('is_demo')
      .eq('id', brandId)
      .single();
    if (targetError) throw targetError;
    if (target?.is_demo) {
      return res
        .status(409)
        .json({ error: 'The demo brand can be hidden, not deleted.', code: 'demo_brand' });
    }

    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', req.user.id)
      .single();
    if (profile?.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can delete a brand.' });
    }

    const job = deleteBrand(brandId);
    const outcome = await Promise.race([
      job.then(() => 'deleted'),
      new Promise((resolve) => setTimeout(() => resolve('pending'), WAIT_MS)),
    ]);
    // A delete that outlives the request must not surface as an unhandled
    // rejection; brandDelete.js has already logged it.
    job.catch(() => {});

    return outcome === 'deleted'
      ? res.json({ deleted: true })
      : res.status(202).json({ deleted: false, pending: true });
  } catch (error) {
    req.log.error({ err: error }, 'delete brand error');
    return res.status(error.status || 500).json({
      error: error.status ? error.message : 'Failed to delete the brand.',
    });
  }
});

/**
 * POST /api/brands/:id/detect-site-type
 * Detects the brand's kind of site from its home page and keeps it, when it
 * has none (action plan by business type, Step 0; 00379). Setup asks for it
 * right after the brand is made. Admins and managers, who may change a
 * brand. Returns { siteType, industry, via }: industry when one was written,
 * via 'page', 'ai' or 'shopping_mode'; siteType null when the brand has a
 * type already (skipped: 'manual' when a person chose it, 'set' when it was
 * detected) or it couldn't be told.
 */
router.post('/:id/detect-site-type', async (req, res) => {
  try {
    const brandId = req.params.id;
    await assertBrandAccess(brandId, req.user.id);

    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', req.user.id)
      .single();
    if (profile?.role !== 'admin' && profile?.role !== 'manager') {
      return res.status(403).json({ error: 'Only admins and managers can change a brand.' });
    }

    // Setup's first read of the home page: the tracking snippet is looked
    // for too, so AI Traffic knows from the start whether it's there.
    checkTrackingSnippet(brandId).catch((err) =>
      req.log.warn({ err }, 'tracking snippet check at setup failed'),
    );
    const result = await applySiteTypeDetection(brandId);
    if (result.skipped) return res.json({ siteType: null, skipped: result.skipped });
    if (!result.detected) return res.json({ siteType: null });
    return res.json({
      siteType: result.detected.siteType,
      industry: result.industry,
      via: result.detected.via,
    });
  } catch (error) {
    req.log.error({ err: error }, 'detect site type error');
    return res.status(error.status || 500).json({
      error: error.status ? error.message : 'Failed to detect the site type.',
    });
  }
});

/**
 * POST /api/brands/:id/tracking-snippet/check
 * AI Traffic's Check again: reads the brand's home page for its tracking
 * snippet and keeps what it found (lib/trackingSnippetCheck.js, 00433).
 * Any member of the brand: it reads the brand's own site and nothing else.
 * Returns { status, domain, checkedAt, foundAt }: status 'found',
 * 'not_found', 'no_domain' or 'unreachable' (nothing kept).
 */
router.post('/:id/tracking-snippet/check', snippetCheckLimiter, async (req, res) => {
  try {
    const brandId = req.params.id;
    await assertBrandAccess(brandId, req.user.id);
    return res.json(await checkTrackingSnippet(brandId));
  } catch (error) {
    req.log.error({ err: error }, 'tracking snippet check error');
    return res.status(error.status || 500).json({
      error: error.status ? error.message : 'Failed to check the tracking snippet.',
    });
  }
});

export default router;
