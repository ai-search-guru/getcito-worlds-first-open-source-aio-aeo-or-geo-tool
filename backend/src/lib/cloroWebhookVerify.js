import crypto from 'crypto';

const DEFAULT_TOLERANCE_SECONDS = 5 * 60;

/**
 * Verify a signed Cloro webhook delivery (HMAC-SHA256 over `${timestamp}.${rawBody}`).
 *
 * Cloro ships three headers on signed deliveries (https://docs.cloro.dev/guides/webhooks):
 *   X-Cloro-Signature  — `v1=<hex hmac>`
 *   X-Cloro-Timestamp  — unix seconds at send time
 *   X-Cloro-Webhook-Id — unique delivery id (dedup; not part of the signature)
 *
 * The `whsec_…` secret is used as-is (no prefix stripping, no base64 decoding),
 * matching Cloro's own reference implementation.
 *
 * Pure function — no env access, clock injectable via `nowMs` — so it stays
 * trivially unit-testable.
 *
 * @param {object} params
 * @param {Buffer|string} params.rawBody          Exact request body bytes (pre-JSON-parse)
 * @param {string|undefined} params.signatureHeader  X-Cloro-Signature value
 * @param {string|undefined} params.timestampHeader  X-Cloro-Timestamp value
 * @param {string} params.secret                  Signing secret from the Cloro dashboard
 * @param {number} [params.toleranceSeconds]      Replay window (default 5 minutes)
 * @param {number} [params.nowMs]                 Clock override for tests
 * @returns {{ ok: true } | { ok: false, status: number, reason: string }}
 */
export function verifyCloroWebhook({
  rawBody,
  signatureHeader,
  timestampHeader,
  secret,
  toleranceSeconds = DEFAULT_TOLERANCE_SECONDS,
  nowMs = Date.now(),
}) {
  if (!signatureHeader || !timestampHeader) {
    return { ok: false, status: 401, reason: 'missing signature headers' };
  }

  const timestamp = Number(timestampHeader);
  if (!Number.isFinite(timestamp)) {
    return { ok: false, status: 400, reason: 'invalid timestamp' };
  }

  if (Math.abs(nowMs / 1000 - timestamp) > toleranceSeconds) {
    return { ok: false, status: 400, reason: 'stale timestamp' };
  }

  const provided = String(signatureHeader).replace(/^v1=/, '');
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.`)
    .update(rawBody)
    .digest('hex');

  // timingSafeEqual throws on length mismatch, so gate on length first.
  // The length check itself leaks nothing useful (hex digest length is public).
  const providedBuf = Buffer.from(provided, 'utf8');
  const expectedBuf = Buffer.from(expected, 'utf8');
  if (
    providedBuf.length !== expectedBuf.length ||
    !crypto.timingSafeEqual(providedBuf, expectedBuf)
  ) {
    return { ok: false, status: 401, reason: 'signature mismatch' };
  }

  return { ok: true };
}
