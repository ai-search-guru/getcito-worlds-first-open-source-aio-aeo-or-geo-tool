import logger from '../logger.js';

/**
 * The form's bot check (REPORT-CARD §3): Cloudflare Turnstile's token,
 * verified with TURNSTILE_SECRET_KEY. Without a key, development lets the
 * request through and says so in the log; a cloud server without one
 * refuses, so a missing key never opens the form to bots.
 */

export const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * Whether the token passes: 'pass', 'fail', or 'unconfigured' (no key on a
 * cloud server).
 *
 * @param {string|undefined} token
 * @param {string|undefined} ip the caller's address, which Turnstile checks against
 */
export async function verifyBotToken(token, ip, { env = process.env, fetchImpl = fetch } = {}) {
  const secret = env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    if (env.IS_CLOUD === 'true' || env.NODE_ENV === 'production') return 'unconfigured';
    logger.warn('[report-card] TURNSTILE_SECRET_KEY is not set: the bot check is skipped');
    return 'pass';
  }
  if (typeof token !== 'string' || !token || token.length > 2048) return 'fail';
  try {
    const res = await fetchImpl(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret, response: token, ...(ip ? { remoteip: ip } : {}) }),
      signal: AbortSignal.timeout(8000),
    });
    const data = await res.json().catch(() => null);
    return data?.success === true ? 'pass' : 'fail';
  } catch (err) {
    logger.warn({ err: err?.name ?? err }, '[report-card] Turnstile did not answer');
    return 'fail';
  }
}
