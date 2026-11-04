/**
 * POST /cloro/callback — Cloro's answer to a submitted task.
 *
 * Signature verification (HMAC-SHA256, see lib/cloroWebhookVerify.js) runs when
 * CLORO_WEBHOOK_SECRET is set. When it's unset (self-hosted installs, or signing not
 * yet enabled in the Cloro dashboard) we fall back to the original defence:
 * task_id entropy + cloro_pending_tasks lookup.
 *
 * Mounted in server.js after its raw body parser for this path, which keeps
 * the bytes as sent for the signature.
 */

import { Router } from 'express';
import supabaseAdmin from '../config/supabase.js';
import {
  isLegacyChatgptTask,
  parseScraperResponse,
  submitPromptTask,
} from '../lib/cloroScraper.js';
import { handleScraperResult } from '../lib/cloroResultHandler.js';
import { verifyCloroWebhook } from '../lib/cloroWebhookVerify.js';
import { isBrandActive, isBrandActiveCached } from '../lib/activeSubscriptions.js';

const router = Router();

/**
 * Whether a brand's answer is dropped because its plan has ended. A kept
 * "active" lets it through (a run's answers arrive in hundreds); dropping is
 * decided on a fresh read only, as a kept "inactive" may be a minute old. A
 * read that fails stores the answer: losing a paying brand's paid answer
 * costs more than storing one more for a lapsed brand.
 */
async function droppedForPlan(brandId, log) {
  try {
    if (await isBrandActiveCached(brandId)) return false;
    return !(await isBrandActive(brandId));
  } catch (err) {
    log.warn({ err, brandId }, 'cloro callback: plan check failed; stored as usual');
    return false;
  }
}

/**
 * A legacy ChatGPT task (00378) that Cloro failed goes once more without
 * legacy, so the day keeps its answer: Cloro calls that interface temporary.
 * The new task takes the old one's place among the brand's pending tasks. Not
 * for a brand whose plan has ended, nor without a webhook to deliver it.
 */
async function resubmitWithoutLegacy(pending, log) {
  const webhookUrl = process.env.CLORO_WEBHOOK_URL;
  if (!webhookUrl || (await droppedForPlan(pending.brand_id, log))) return;
  try {
    const { data: prompt } = await supabaseAdmin
      .from('prompts')
      .select('text')
      .eq('id', pending.prompt_id)
      .maybeSingle();
    if (!prompt?.text) return;
    const again = await submitPromptTask({
      promptText: prompt.text,
      promptId: pending.prompt_id,
      scraperId: pending.scraper_id,
      region: pending.region,
      webhookUrl,
    });
    const { error } = await supabaseAdmin.from('cloro_pending_tasks').insert({
      task_id: again.taskId,
      prompt_id: pending.prompt_id,
      brand_id: pending.brand_id,
      scraper_id: pending.scraper_id,
      region: pending.region,
      legacy: false,
    });
    if (error) throw error;
    log.warn(
      { taskId: pending.task_id, newTaskId: again.taskId, scraperId: pending.scraper_id },
      'cloro callback: chatgpt fan-out task failed; submitted again without fan-out',
    );
  } catch (err) {
    log.error(
      { err, taskId: pending.task_id },
      'cloro callback: could not submit the failed fan-out task again',
    );
  }
}

router.post('/', async (req, res) => {
  const webhookSecret = process.env.CLORO_WEBHOOK_SECRET;
  if (webhookSecret) {
    const verdict = verifyCloroWebhook({
      rawBody: Buffer.isBuffer(req.body) ? req.body : Buffer.from(''),
      signatureHeader: req.headers['x-cloro-signature'],
      timestampHeader: req.headers['x-cloro-timestamp'],
      secret: webhookSecret,
    });
    if (!verdict.ok) {
      req.log.warn(
        {
          reason: verdict.reason,
          webhookId: req.headers['x-cloro-webhook-id'] || null,
          ip: req.ip,
        },
        'cloro callback rejected delivery',
      );
      return res.status(verdict.status).json({ error: verdict.reason });
    }
  }

  // Parse only after the signature check has passed (raw body arrives as a Buffer).
  let payload;
  try {
    payload = Buffer.isBuffer(req.body) ? JSON.parse(req.body.toString('utf8') || '{}') : req.body;
  } catch {
    req.log.warn({ ip: req.ip }, 'cloro callback rejected: malformed JSON body');
    return res.status(400).json({ error: 'malformed JSON body' });
  }

  // Always ack quickly so Cloro doesn't retry on slow processing
  res.status(200).send();

  try {
    const { task, response } = payload || {};
    const taskId = task?.id;
    const status = task?.status;

    if (!taskId) {
      req.log.warn('cloro callback missing task.id in payload');
      return;
    }

    const { data: pending } = await supabaseAdmin
      .from('cloro_pending_tasks')
      .select('*')
      .eq('task_id', taskId)
      .maybeSingle();

    if (!pending) {
      req.log.info({ taskId }, 'cloro callback: no pending task (already processed?)');
      return;
    }

    if (status === 'FAILED') {
      req.log.error({ taskId, scraperId: pending.scraper_id }, 'cloro callback: task failed');
      if (isLegacyChatgptTask({ scraperId: pending.scraper_id, legacy: pending.legacy })) {
        await resubmitWithoutLegacy(pending, req.log);
      }
      await supabaseAdmin.from('cloro_pending_tasks').delete().eq('task_id', taskId);
      return;
    }

    if (status !== 'COMPLETED') {
      req.log.info({ taskId, status }, 'cloro callback: task status ignored');
      return;
    }

    if (!response) {
      req.log.error({ taskId }, 'cloro callback: task completed but missing response');
      await supabaseAdmin.from('cloro_pending_tasks').delete().eq('task_id', taskId);
      return;
    }

    // Once the brand's plan has ended (2026-10-27), the answer is dropped,
    // not stored: Cloro has been paid for it already, but storing it means a
    // sentiment model call whenever the brand is named, for a read-only
    // workspace. Dropping costs nothing more.
    if (await droppedForPlan(pending.brand_id, req.log)) {
      req.log.info(
        { taskId, scraperId: pending.scraper_id, brandId: pending.brand_id },
        'cloro callback: dropped, no active plan',
      );
      await supabaseAdmin.from('cloro_pending_tasks').delete().eq('task_id', taskId);
      return;
    }

    // Fetch context for result handler
    const [{ data: brand }, { data: domains }, { data: competitorRows }] = await Promise.all([
      supabaseAdmin.from('brands').select('id, name').eq('id', pending.brand_id).single(),
      supabaseAdmin.from('brand_domains').select('domain').eq('brand_id', pending.brand_id),
      supabaseAdmin.from('competitors').select('id, name, domain').eq('brand_id', pending.brand_id),
    ]);

    if (!brand) {
      req.log.error(
        { taskId, brandId: pending.brand_id },
        'cloro callback: brand not found — dropping',
      );
      await supabaseAdmin.from('cloro_pending_tasks').delete().eq('task_id', taskId);
      return;
    }

    const brandInfo = {
      brandName: brand.name,
      domains: (domains || []).map((d) => d.domain),
    };
    const competitors = (competitorRows || []).map((c) => ({
      id: c.id,
      name: c.name,
      domain: c.domain || '',
    }));

    // A completed task with nothing to store — google-aio for a query Google
    // shows no AI Overview for — is a finished task, not a failed delivery.
    // Leaving its pending row behind held every tracking run open: the worker
    // waited out its stall window and the run's stamp its late deadline, for
    // answers that had arrived seconds after submission.
    let aiResponse;
    try {
      aiResponse = parseScraperResponse(response, pending.scraper_id);
    } catch (err) {
      req.log.info(
        { taskId, scraperId: pending.scraper_id, reason: err.message },
        'cloro callback: task completed with no answer to store',
      );
      await supabaseAdmin.from('cloro_pending_tasks').delete().eq('task_id', taskId);
      return;
    }

    try {
      await handleScraperResult({
        aiResponse,
        scraperId: pending.scraper_id,
        promptId: pending.prompt_id,
        brandId: pending.brand_id,
        region: pending.region,
        brandInfo,
        competitors,
      });
    } finally {
      // Cloro does not deliver again after our 200, so a task that failed to
      // store will never come back; keeping its row only holds the run open.
      await supabaseAdmin.from('cloro_pending_tasks').delete().eq('task_id', taskId);
    }

    req.log.info(
      { taskId, scraperId: pending.scraper_id },
      'cloro callback: task processed and inserted',
    );
  } catch (err) {
    req.log.error({ err }, 'cloro callback: error processing webhook');
  }
});

export default router;
