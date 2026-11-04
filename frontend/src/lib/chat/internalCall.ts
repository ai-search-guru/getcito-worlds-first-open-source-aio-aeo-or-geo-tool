import crypto from 'node:crypto';
import { NextResponse } from 'next/server';

/**
 * Chat's internal endpoints (/api/internal/chat/…), called by the API
 * server's cron and hooks, never by a browser: the agents' triggers and
 * sweep (W2-16). Off with the new Chat (CHAT_AGENTIC unset): not found,
 * before the secret is read. On, the caller sends
 * `Authorization: Bearer ${CHAT_INTERNAL_SECRET}`, compared in constant time
 * as the server's webhookSecretsMatch does; a missing or wrong secret, or
 * none configured here, is 401. Server only.
 */

/** Whether `provided` is the configured secret: equal lengths compared in constant time. */
export function internalSecretMatches(
  expected: string | undefined,
  provided: string | null | undefined,
): boolean {
  if (typeof expected !== 'string' || !expected || typeof provided !== 'string' || !provided) {
    return false;
  }
  const want = Buffer.from(expected, 'utf8');
  const got = Buffer.from(provided, 'utf8');
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}

/** The answer to give an internal call that may not go on, or null when it may. */
export function internalCallRefusal(req: Request): NextResponse | null {
  if (process.env.CHAT_AGENTIC !== 'true') {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  }
  const auth = req.headers.get('authorization');
  const secret = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!internalSecretMatches(process.env.CHAT_INTERNAL_SECRET, secret)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  return null;
}
