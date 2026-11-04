import { logger } from './logger.js';

/**
 * Send one email through the Resend HTTP API (RESEND_API_KEY,
 * RESEND_FROM_EMAIL) and say what became of it:
 *   - 'sent': Resend accepted it;
 *   - 'refused': Resend answered with an error, so nothing went out;
 *   - 'unknown': no answer (the 15 s timeout, a dropped connection), and
 *     Resend may have sent it all the same;
 *   - 'skipped': not configured or no recipients. Missing config is a silent
 *     no-op, so self-host and misconfigured environments never fail a caller.
 * `replyTo`, when given, is where a reply goes instead of the sender.
 */
export async function deliverEmail({ to, subject, html, headers, replyTo }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from || !to.length) return 'skipped';

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to,
        subject,
        html,
        ...(headers ? { headers } : {}),
        ...(replyTo ? { reply_to: replyTo } : {}),
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      logger.warn({ status: res.status, body: body.slice(0, 500) }, 'resend send failed');
      return 'refused';
    }
    return 'sent';
  } catch (err) {
    logger.warn({ err }, 'resend send errored');
    return 'unknown';
  }
}

/** deliverEmail as a yes or no: true when Resend accepted it. */
export async function sendEmail(message) {
  return (await deliverEmail(message)) === 'sent';
}
