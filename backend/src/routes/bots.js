/**
 * The AI bot report's connections (AT-010): each way a brand sends AI-bot
 * requests — a Cloudflare Worker, a Logpush job, a Vercel drain — with its
 * own secret, shown once. Admins and managers make and revoke them, on plans
 * with the bot report (Starter has it locked, spec §7).
 *
 * GET    /api/bots/connections/:brandId           — the brand's connections and this month's use:
 *                                                   rows against the event cap, log records
 *                                                   against the raw cap
 * POST   /api/bots/connections/:brandId           — { kind } → a connection, its secret, the endpoint and
 *                                                   what to copy: the Worker, a Logpush job or a Vercel drain
 * DELETE /api/bots/connections/:brandId/:id       — revoke one
 */

import { Router } from 'express';
import { z } from 'zod';
import supabaseAdmin from '../config/supabase.js';
import { assertBrandAccess } from '../lib/access.js';
import { PlanLimitError, getBotCaps, getBotEventCap } from '../lib/planGuard.js';
import {
  CONNECTION_KINDS,
  hashSecret,
  newConnectionSecret,
  publicIngestEndpoint,
} from '../lib/botIngest.js';
import { WORKER_SECRET_NAME, buildWorkerScript } from '../lib/botWorkerScript.js';
import { logpushJob, vercelDrain } from '../lib/botSenderSetup.js';

const router = Router();

const WRITE_ROLES = ['admin', 'manager'];

const createSchema = z.object({ kind: z.enum(CONNECTION_KINDS) });

async function assertWriter(userId) {
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .single();
  if (!WRITE_ROLES.includes(profile?.role)) {
    const err = new Error('Only admins and managers can manage AI bot connections.');
    err.status = 403;
    throw err;
  }
}

function fail(req, res, error, what) {
  if (error instanceof PlanLimitError) {
    return res.status(error.statusCode).json({ error: 'plan_limit', message: error.message });
  }
  const status = error.status || 500;
  if (status >= 500) req.log.error({ err: error }, `${what} error`);
  return res.status(status).json({ error: error.message || `Failed to ${what}` });
}

router.get('/connections/:brandId', async (req, res) => {
  try {
    const { brand } = await assertBrandAccess(req.params.brandId, req.user.id);
    const month = new Date().toISOString().slice(0, 7) + '-01';
    const [{ data: connections, error }, { data: usage }, caps] = await Promise.all([
      supabaseAdmin
        .from('ai_bot_connections')
        .select('id, kind, created_at, last_event_at')
        .eq('brand_id', brand.id)
        .is('revoked_at', null)
        .order('created_at'),
      supabaseAdmin
        .from('ai_bot_usage')
        .select('stored_events, counted_events, capped_at, raw_records, raw_capped_at')
        .eq('organization_id', brand.organization_id)
        .eq('month', month)
        .maybeSingle(),
      // Read-only once the plan has ended (2026-10-27): no plan reads as caps
      // of 0, and the connections and this month's use still come back.
      getBotCaps(brand.organization_id, { readOnly: true }),
    ]);
    if (error) throw new Error(error.message);
    const { cap, rawCap, noPlan } = caps;
    return res.json({
      connections: connections ?? [],
      usage: {
        month,
        stored: usage?.stored_events ?? 0,
        counted: usage?.counted_events ?? 0,
        cappedAt: usage?.capped_at ?? null,
        cap,
        // A Logpush job's or a Vercel drain's records (00184): past rawCap the
        // files are counted but not read, so the report stops until the month ends.
        raw: usage?.raw_records ?? 0,
        rawCappedAt: usage?.raw_capped_at ?? null,
        rawCap,
        ...(noPlan ? { noPlan: true } : {}),
      },
    });
  } catch (error) {
    return fail(req, res, error, 'load AI bot connections');
  }
});

router.post('/connections/:brandId', async (req, res) => {
  try {
    const parsed = createSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: 'Invalid request' });
    const { brand } = await assertBrandAccess(req.params.brandId, req.user.id);
    await assertWriter(req.user.id);
    if ((await getBotEventCap(brand.organization_id)) === 0) {
      throw new PlanLimitError('The AI bot report comes with the Growth plan.', 403);
    }
    // Checked before a connection exists: one the sender can't reach is no use.
    const endpoint = publicIngestEndpoint();
    if (!endpoint) {
      req.log.error('[ai-bots] PUBLIC_SERVER_URL is missing or not https');
      return res
        .status(503)
        .json({ error: 'AI bot connections are not set up on this server yet.' });
    }

    const secret = newConnectionSecret();
    const { data: connection, error } = await supabaseAdmin
      .from('ai_bot_connections')
      .insert({
        brand_id: brand.id,
        kind: parsed.data.kind,
        secret_hash: hashSecret(secret),
        created_by: req.user.id,
      })
      .select('id, kind, created_at, last_event_at')
      .single();
    if (error) throw new Error(error.message);

    const { kind } = parsed.data;
    // What the person copies into Cloudflare or Vercel, with the secret in it once.
    return res.status(201).json({
      connection,
      secret,
      endpoint,
      // The Worker reads the secret from a Secret of this name, not from its code.
      workerScript: kind === 'cloudflare_worker' ? buildWorkerScript({ endpoint }) : null,
      workerSecretName: kind === 'cloudflare_worker' ? WORKER_SECRET_NAME : null,
      logpushJob: kind === 'cloudflare_logpush' ? logpushJob({ endpoint, secret }) : null,
      vercelDrain: kind === 'vercel_drain' ? vercelDrain({ endpoint, secret }) : null,
    });
  } catch (error) {
    return fail(req, res, error, 'create the AI bot connection');
  }
});

router.delete('/connections/:brandId/:id', async (req, res) => {
  try {
    const { brand } = await assertBrandAccess(req.params.brandId, req.user.id);
    await assertWriter(req.user.id);
    const { data, error } = await supabaseAdmin
      .from('ai_bot_connections')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('brand_id', brand.id)
      .is('revoked_at', null)
      .select('id');
    if (error) throw new Error(error.message);
    if (!data?.length) return res.status(404).json({ error: 'Connection not found' });
    return res.status(204).end();
  } catch (error) {
    return fail(req, res, error, 'revoke the AI bot connection');
  }
});

export default router;
