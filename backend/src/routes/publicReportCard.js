import express, { Router } from 'express';
import rateLimit from 'express-rate-limit';
import logger from '../lib/logger.js';
import { reportCardLimits, reportCardOrigins } from '../lib/report-card/config.js';
import { submitReportCardRequest } from '../lib/report-card/intake.js';
import { anonymousIpKey } from '../middleware/rateLimiter.js';

/**
 * POST /public/report-card: the free AI visibility report card's form on
 * www.getcito.com (REPORT-CARD §8). Public, so mounted before the
 * dashboard's CORS, body parsers and sign-in: it answers only the origins
 * in REPORT_CARD_ORIGINS (www.getcito.com and getcito.com by default),
 * reads at most 16 KB, and takes REPORT_CARD_IP_HOURLY requests an hour
 * from one address. The bot check and the rest are lib/report-card/intake.js.
 */

const router = Router();

const body = express.json({ limit: '16kb', type: ['application/json', 'text/plain'] });

/** The form's origin, when it is one the form may post from. */
function allowedOrigin(req) {
  const origin = req.headers.origin;
  return origin && reportCardOrigins().includes(origin) ? origin : null;
}

function corsHeaders(req, res, next) {
  const origin = allowedOrigin(req);
  res.vary('Origin');
  if (origin) {
    res.set({
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    });
  }
  next();
}

/** A browser on another site may not post; a request with no origin goes on to the bot check. */
function refuseOtherOrigins(req, res, next) {
  if (req.headers.origin && !allowedOrigin(req)) {
    return res.status(403).json({ code: 'forbidden' });
  }
  return next();
}

export const reportCardLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: () => reportCardLimits().ipHourly,
  keyGenerator: (req) => anonymousIpKey(req.ip),
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ code: 'rate_limited' }),
});

router.options('/', corsHeaders, refuseOtherOrigins, (req, res) => res.status(204).end());

router.post('/', corsHeaders, refuseOtherOrigins, reportCardLimiter, body, async (req, res) => {
  try {
    const { status, body: answer } = await submitReportCardRequest(req.body, { ip: req.ip });
    if (status >= 500 || answer.code === 'bot_check') {
      logger.warn({ code: answer.code, domain: answer.domain }, '[report-card] request refused');
    }
    return res.status(status).json(answer);
  } catch (err) {
    logger.error({ err }, '[report-card] request failed');
    return res.status(500).json({ code: 'error' });
  }
});

// A body that isn't JSON, or is too large.
router.use((err, req, res, next) => {
  if (err?.type === 'entity.parse.failed' || err?.type === 'entity.too.large') {
    return res.status(422).json({ code: 'invalid', fields: {} });
  }
  return next(err);
});

export default router;
