/**
 * POST /api/internal/trigger-tracking — the first tracking run after a
 * payment (CRON_SECRET auth).
 *
 * Asked for by both the Stripe return page and the Stripe webhook: one run per
 * purchase (lib/firstRun.js). `since` is when the purchase began; a call that
 * finds the run already started gets its id back with `created: false`. The
 * call that starts the run also starts the brand's volume analysis, here
 * rather than from the web app, so a caller that gives up waiting for the
 * answer still gets both. Never on a demo brand (00380): 402 demo_brand,
 * before any job is written.
 *
 * Mounted in server.js before the authenticated /api routes.
 */

import { Router } from 'express';
import { z } from 'zod';
import { startFirstRun } from '../lib/firstRun.js';
import { runTrackingJob } from '../lib/jobRunner.js';
import { analyzeBrandVolumes } from '../lib/volumeAnalysis.js';
import { DEMO_BRAND, isDemoBrand } from '../middleware/demoBrand.js';

const router = Router();

const body = z.object({
  brandId: z.string().min(1),
  since: z.iso.datetime({ offset: true }).optional(),
});

router.post('/', async (req, res) => {
  const secret = req.headers.authorization?.replace('Bearer ', '');
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  const parsed = body.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res
      .status(400)
      .json({ success: false, message: 'brandId is required; since must be an ISO time' });
  }
  const { brandId } = parsed.data;

  try {
    if (await isDemoBrand(brandId)) return res.status(402).json(DEMO_BRAND);
    const { job, created } = await startFirstRun(parsed.data);
    if (created) {
      runTrackingJob(job.id, req.app.get('io'), { priority: true });
      analyzeBrandVolumes(brandId, { onlyMissing: true }).catch((err) => {
        req.log.error({ err, brandId }, 'first-run volume analysis error');
      });
    }

    return res.json({ success: true, jobId: job.id, created });
  } catch (err) {
    req.log.error({ err, brandId }, 'internal trigger-tracking error');
    return res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
