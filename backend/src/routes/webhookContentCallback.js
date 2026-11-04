import { Router } from 'express';
import supabaseAdmin from '../config/supabase.js';
import {
  webhookCallbackLimiter,
  webhookCallbackAuthFailureLimiter,
} from '../middleware/rateLimiter.js';
import { sourceDataForStatus, VALID_OPPORTUNITY_STATUSES } from '../lib/opportunityStatus.js';
import { webhookSecretsMatch } from '../lib/webhookSecret.js';
import { isBrandActive } from '../lib/activeSubscriptions.js';

const router = Router();

/**
 * The answer once the brand's plan has ended (2026-10-27): a 2xx, so the
 * workflow neither fails nor retries, and nothing written.
 */
const IGNORED = { success: false, ignored: true, code: 'subscription_inactive' };

// This endpoint is public by design. The supplied secret hash gives each
// webhook its own budget; the second limiter counts failed (401) attempts by IP.
router.use(webhookCallbackLimiter, webhookCallbackAuthFailureLimiter);

/**
 * POST /webhooks/content/:id/status
 * Let an external workflow update an opportunity using its webhook secret.
 */
router.post('/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    // Avoid sending malformed identifiers to Postgres (22P02). Keep its
    // response indistinguishable from a wrong secret or unknown opportunity.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
      return res.status(401).json({ error: 'Invalid webhook credentials' });
    }

    const { data: current, error: opportunityError } = await supabaseAdmin
      .from('content_opportunities')
      .select('id, brand_id, source_data, updated_at')
      .eq('id', id)
      .maybeSingle();

    if (opportunityError) throw new Error(opportunityError.message);

    // Return the same result for an unknown opportunity, missing configuration,
    // and an invalid secret so this public route doesn't reveal which IDs exist.
    if (!current) return res.status(401).json({ error: 'Invalid webhook credentials' });

    const { data: webhookConfig, error: configError } = await supabaseAdmin
      .from('webhook_configs')
      .select('webhook_secret')
      .eq('brand_id', current.brand_id)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();

    if (configError) throw new Error(configError.message);
    if (!webhookSecretsMatch(webhookConfig?.webhook_secret, req.get('X-Webhook-Secret'))) {
      return res.status(401).json({ error: 'Invalid webhook credentials' });
    }
    // Asked only once the secret matched, so the answer tells a stranger nothing.
    if (!(await isBrandActive(current.brand_id))) return res.status(202).json(IGNORED);

    const { status, reason } = req.body ?? {};
    if (!VALID_OPPORTUNITY_STATUSES.includes(status)) {
      return res.status(400).json({
        error: 'Invalid status. Must be one of: ' + VALID_OPPORTUNITY_STATUSES.join(', '),
      });
    }

    // Match the authenticated Content route's dismissal metadata and guarded
    // write behavior, so an external callback cannot erase a concurrent edit.
    let latest = current;
    let data = null;
    let error = null;
    for (let attempt = 0; attempt < 2 && !data && !error; attempt += 1) {
      if (attempt > 0) {
        const fresh = await supabaseAdmin
          .from('content_opportunities')
          .select('id, brand_id, source_data, updated_at')
          .eq('id', id)
          .maybeSingle();
        if (fresh.error) throw new Error(fresh.error.message);
        if (!fresh.data) break;
        latest = fresh.data;
      }

      const sourceData = sourceDataForStatus(latest.source_data, status, reason);
      let update = supabaseAdmin
        .from('content_opportunities')
        .update({
          status,
          updated_at: new Date().toISOString(),
          ...(sourceData ? { source_data: sourceData } : {}),
        })
        .eq('id', id);
      if (sourceData) update = update.eq('updated_at', latest.updated_at);
      ({ data, error } = await update.select('id, status').maybeSingle());
    }

    if (error) throw new Error(error.message);
    if (!data) return res.status(404).json({ error: 'Opportunity not found' });

    return res.json({ success: true, status: data.status });
  } catch (error) {
    req.log?.error?.({ err: error }, 'webhook status callback error');
    return res.status(500).json({ error: 'Failed to update opportunity status' });
  }
});

export default router;
