/**
 * POST /bots/ingest — AI-bot requests from a brand's own edge (AT-010, spec
 * §6.1). Public, outside /api: the sender is the customer's Cloudflare or
 * Vercel, authenticated by its connection secret (Authorization: Bearer)
 * before its body is read, so a caller without one can't make the server
 * take in 20 MB. The body is read by the connection's kind
 * (botLogFormats.js): a Worker's JSON batch, a Logpush file, or a Vercel
 * drain's log entries. A log sender's file is claimed, counted against the
 * month's raw cap and written in one transaction, so a file it sends again
 * (after timing out, say) is read once, and a read that fails leaves nothing
 * for the retry to count twice.
 *
 * Once the organization's plan has ended (2026-10-27), a sender's requests
 * are answered 200 and nothing is read or stored: the customer's edge keeps
 * working and doesn't retry, and we pay for no read, verification or row.
 */

import express, { Router } from 'express';
import { isOrgActive, isOrgActiveCached } from '../lib/activeSubscriptions.js';
import { PlanLimitError } from '../lib/planGuard.js';
import {
  connectionForSecret,
  ingestBotRequests,
  ingestLogFile,
  logFileHash,
  logFileRead,
} from '../lib/botIngest.js';
import { LogTooLargeError, readSenderBody } from '../lib/botLogFormats.js';
import { logger } from '../lib/logger.js';
import { botIngestLimiter } from '../middleware/rateLimiter.js';
import { markBotSenderVerified } from '../middleware/verifiedTokens.js';

const router = Router();

// Raw: each kind has its own body, and a Logpush file comes gzipped. A body
// sent with Content-Encoding: gzip is inflated here, within the limit.
// Mounted before the app's JSON parser (server.js), so this reads it.
const body = express.raw({ type: () => true, limit: '20mb' });

/** The answer to a sender whose organization's plan has ended: nothing read. */
export const NOT_STORED = { received: 0, verified: 0, stored: 0, inactive: true };

/**
 * The live connection the secret names, before the body is read; 401
 * otherwise. Once the organization's plan has ended, 200 with nothing read
 * (whether it has is remembered a few minutes, activeSubscriptions.js).
 */
async function sender(req, res, next) {
  try {
    const secret = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const connection = await connectionForSecret(secret);
    if (!connection) return res.status(401).json({ error: 'unknown_connection' });
    // Its next requests count against the connection's bucket, not the IP's.
    markBotSenderVerified(req.headers.authorization, connection.id);
    if (!(await isOrgActiveCached(connection.organizationId))) return res.json(NOT_STORED);
    res.locals.connection = connection;
    return next();
  } catch (error) {
    logger.error({ err: error }, 'bot ingest error');
    return res.status(500).json({ error: 'ingest_failed' });
  }
}

router.post('/bots/ingest', botIngestLimiter, sender, body, async (req, res) => {
  const { connection } = res.locals;
  try {
    const worker = connection.kind === 'cloudflare_worker';
    const hash = worker ? null : logFileHash(req.body);
    // Answered with 200 so the sender stops sending what was read.
    const duplicate = { received: 0, verified: 0, stored: 0, duplicate: true };
    if (!worker && (await logFileRead(connection, hash))) return res.json(duplicate);

    let parsed;
    try {
      parsed = await readSenderBody(connection.kind, req.body);
    } catch (err) {
      if (err instanceof LogTooLargeError) {
        logger.warn({ connectionId: connection.id, err }, '[ai-bots] log file too large');
        return res.status(413).json({ error: 'too_large', message: err.message });
      }
      return res.status(400).json({ error: 'unreadable_body' });
    }

    // A capped or locked file is answered with 200 too, so the sender doesn't
    // retry what won't be read.
    const result = worker
      ? await ingestBotRequests(connection, parsed.requests)
      : await ingestLogFile(connection, hash, parsed);
    return res.json({ ...result, records: parsed.records });
  } catch (error) {
    // A plan that ended within the minutes `sender` remembers raises it here
    // (planGuard.js): asked again, unremembered, it is answered as `sender`
    // would. Anything else, a failed read too, is a 500 the sender retries.
    if (error instanceof PlanLimitError) {
      try {
        if (!(await isOrgActive(connection.organizationId))) return res.json(NOT_STORED);
      } catch (err) {
        logger.error({ err }, 'bot ingest plan check failed');
        return res.status(500).json({ error: 'ingest_failed' });
      }
      logger.error({ err: error }, 'bot ingest refused for an organization on a plan');
      return res.status(500).json({ error: 'ingest_failed' });
    }
    // Mounted before the request-id middleware: there is no req.log here.
    logger.error({ err: error }, 'bot ingest error');
    return res.status(500).json({ error: 'ingest_failed' });
  }
});

export default router;
