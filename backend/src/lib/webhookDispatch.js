import supabaseAdmin from '../config/supabase.js';
import { logger } from './logger.js';
import { postJson } from './safePost.js';

/**
 * Deliver an event payload to a brand's active webhook configs.
 *
 * Same wire format as the Content Optimization send routes: a flat JSON
 * payload with an `event` field, plus the shared secret echoed in the
 * `X-Webhook-Secret` header when one is configured. Posted as Send to CMS
 * posts (postJson): no private address on Cloud, no redirect followed, 15 s.
 * Delivery is best-effort — failures are logged, never thrown.
 *
 * Returns { sent, failed } delivery counts.
 */
export async function dispatchBrandWebhook(brandId, payload) {
  const { data: configs } = await supabaseAdmin
    .from('webhook_configs')
    .select('id, webhook_url, webhook_secret, events')
    .eq('brand_id', brandId)
    .eq('is_active', true)
    .contains('events', [payload.event]);

  if (!configs?.length) return { sent: 0, failed: 0 };

  let sent = 0;
  let failed = 0;
  const body = JSON.stringify(payload);

  for (const config of configs) {
    const headers = {};
    if (config.webhook_secret) {
      headers['X-Webhook-Secret'] = config.webhook_secret;
    }

    try {
      const res = await postJson(config.webhook_url, body, { headers });
      if (res.status >= 200 && res.status < 300) {
        sent++;
      } else {
        failed++;
        logger.warn(
          { brandId, configId: config.id, status: res.status, event: payload?.event },
          'webhook delivery got non-2xx response',
        );
      }
    } catch (err) {
      failed++;
      logger.warn(
        { err, brandId, configId: config.id, event: payload?.event },
        'webhook delivery failed',
      );
    }
  }

  return { sent, failed };
}
